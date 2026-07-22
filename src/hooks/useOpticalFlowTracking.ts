import { useState, useCallback } from 'react';
import jsfeat from 'jsfeat';

export interface TrackedROI {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

interface Point {
  x: number;
  y: number;
}

// 추적된 특징점 수가 기준치의 이 비율 밑으로 떨어지면 실패로 판정한다
const FAILURE_RATIO = 0.3;
// 실패로 판정되기 전, 이 비율 밑으로 떨어지면 미리 특징점을 재검출해 세트를 보충한다
const REPLENISH_RATIO = 0.6;
// ROI 중심을 신뢰성 있게 계산할 수 있는 최소 특징점 수
const MIN_ABSOLUTE_POINTS = 12;

export const useOpticalFlowTracking = () => {
  const [isTracking, setIsTracking] = useState(false);
  const [progress, setProgress] = useState(0);

  // Lucas-Kanade Optical Flow를 사용한 특징점 추적
  // frames: 추출된 프레임의 canvas 배열 (다시 인코딩/디코딩하지 않고 getImageData로 직접 픽셀 접근)
  const trackObjectAcrossFrames = useCallback(async (
    frames: HTMLCanvasElement[],
    initialROI: { x: number; y: number; w: number; h: number },
    startFrameIndex: number,
    onProgress: (current: number, total: number) => void
  ): Promise<Map<number, TrackedROI>> => {
    setIsTracking(true);
    setProgress(0);

    const trackedROIs = new Map<number, TrackedROI>();

    try {
      // Validate inputs
      if (!initialROI || typeof initialROI.x !== 'number' || typeof initialROI.y !== 'number' ||
          typeof initialROI.w !== 'number' || typeof initialROI.h !== 'number') {
        throw new Error('유효하지 않은 ROI 데이터입니다.');
      }

      if (!frames || frames.length === 0) {
        throw new Error('프레임 데이터가 없습니다.');
      }

      if (startFrameIndex < 0 || startFrameIndex >= frames.length) {
        throw new Error('유효하지 않은 시작 프레임 인덱스입니다.');
      }

      // 초기 프레임에서 특징점 추출
      const startFrame = getImageData(frames[startFrameIndex]);
      const initialPoints = detectKeyPoints(startFrame, initialROI);

      if (initialPoints.length === 0) {
        throw new Error('초기 ROI에서 특징점을 찾을 수 없습니다. ROI를 좀 더 크게 선택하거나 특징이 뚜렷한 영역을 선택해주세요.');
      }

      console.log(`초기 특징점 ${initialPoints.length}개 감지됨`);

      // 초기 ROI 저장
      trackedROIs.set(startFrameIndex, {
        x: initialROI.x,
        y: initialROI.y,
        w: initialROI.w,
        h: initialROI.h,
        confidence: 1.0
      });

      // 정방향 추적 (시작 프레임 -> 마지막 프레임)
      trackSequence({
        frames,
        indices: rangeAsc(startFrameIndex + 1, frames.length),
        anchorIndex: startFrameIndex,
        anchorFrame: startFrame,
        anchorPoints: initialPoints,
        initialROI,
        trackedROIs,
        onStep: (done) => {
          onProgress(done, frames.length);
          setProgress(Math.round((done / frames.length) * 50));
        }
      });

      // 역방향 추적 (시작 프레임 -> 첫 프레임)
      trackSequence({
        frames,
        indices: rangeDesc(startFrameIndex - 1, -1),
        anchorIndex: startFrameIndex,
        anchorFrame: startFrame,
        anchorPoints: initialPoints,
        initialROI,
        trackedROIs,
        onStep: (done) => {
          onProgress(done, frames.length);
          setProgress(50 + Math.round((done / frames.length) * 50));
        }
      });

      return trackedROIs;
    } catch (err) {
      console.error('트래킹 내부 오류 상세:', err, err instanceof Error ? err.stack : '');
      throw err;
    } finally {
      setIsTracking(false);
      setProgress(0);
    }
  }, []);

  return {
    isTracking,
    progress,
    trackObjectAcrossFrames
  };
};

function rangeAsc(start: number, endExclusive: number): number[] {
  const out: number[] = [];
  for (let i = start; i < endExclusive; i++) out.push(i);
  return out;
}

function rangeDesc(start: number, endExclusive: number): number[] {
  const out: number[] = [];
  for (let i = start; i > endExclusive; i--) out.push(i);
  return out;
}

function centerOf(roi: { x: number; y: number; w: number; h: number }): Point {
  return { x: roi.x + roi.w / 2, y: roi.y + roi.h / 2 };
}

// 등속 운동을 가정해 다음 위치를 외삽한다 (직전 두 위치의 이동량을 그대로 한 번 더 적용)
function predictCenter(prev: Point | null, last: Point): Point {
  if (!prev) return last;
  return { x: last.x + (last.x - prev.x), y: last.y + (last.y - prev.y) };
}

// 예측 중심 주변을 (원래 ROI 크기 * expand)만큼 확장한 탐색 영역으로 변환 (이미지 경계 안으로 클램프)
function regionAround(
  center: Point,
  w: number,
  h: number,
  imageWidth: number,
  imageHeight: number,
  expand: number
): { x: number; y: number; w: number; h: number } {
  const rw = Math.min(imageWidth, w * expand);
  const rh = Math.min(imageHeight, h * expand);
  const x = Math.max(0, Math.min(imageWidth - rw, center.x - rw / 2));
  const y = Math.max(0, Math.min(imageHeight - rh, center.y - rh / 2));
  return { x, y, w: rw, h: rh };
}

// 한 방향(정방향 또는 역방향)의 프레임 시퀀스를 순서대로 추적한다.
// 단순히 이전 프레임의 특징점을 다음 프레임으로 넘기기만 하면, 물체가 이동하며
// 원래 특징점 중 일부가 ROI 밖으로 벗어나거나 소실되어 프레임이 진행될수록
// 추적 가능한 점의 수가 계속 줄어든다(관찰된 "프레임 14 이후 점점 감소" 현상의 원인).
// 이를 막기 위해:
//  1) 추적이 성공한 프레임이라도 점 수가 기준치의 REPLENISH_RATIO 밑으로 떨어지면
//     현재 위치에서 즉시 특징점을 다시 검출해 세트를 새로고침한다(재검출 기준점도 갱신).
//  2) 완전히 실패(FAILURE_RATIO 미만)해도 즉시 포기하지 않고, 직전 이동 방향으로
//     다음 위치를 예측한 뒤 그 주변을 넓혀 재검출을 시도해 추적을 복구한다.
function trackSequence(params: {
  frames: HTMLCanvasElement[];
  indices: number[];
  anchorIndex: number;
  anchorFrame: ImageData;
  anchorPoints: Point[];
  initialROI: { x: number; y: number; w: number; h: number };
  trackedROIs: Map<number, TrackedROI>;
  onStep: (stepNumber: number) => void;
}): void {
  const { frames, indices, initialROI, trackedROIs, onStep } = params;

  let prevFrame = params.anchorFrame;
  let prevPoints = params.anchorPoints;
  let trackingBaseCount = params.anchorPoints.length;
  let lastIndex = params.anchorIndex;

  let prevCenter: Point | null = null;
  let lastCenter: Point = centerOf(initialROI);

  for (let step = 0; step < indices.length; step++) {
    const i = indices[step];
    const currFrame = getImageData(frames[i]);
    let trackedPoints = trackPoints(prevFrame, currFrame, prevPoints);

    const minValidPoints = Math.max(MIN_ABSOLUTE_POINTS, trackingBaseCount * FAILURE_RATIO);

    if (trackedPoints.length >= minValidPoints) {
      // 추적 성공
      const roi = calculateROIFromPoints(trackedPoints, initialROI.w, initialROI.h);
      const confidence = Math.min(trackedPoints.length / trackingBaseCount, 1.0);

      trackedROIs.set(i, { x: roi.x, y: roi.y, w: roi.w, h: roi.h, confidence });
      console.log(`프레임 ${i}: ${trackedPoints.length}개 특징점 추적 (신뢰도: ${(confidence * 100).toFixed(1)}%)`);

      prevCenter = lastCenter;
      lastCenter = centerOf(roi);

      // 점 수가 줄어들기 시작하면(완전히 실패하기 전에) 현재 위치에서 미리 재검출해 보충한다
      const replenishThreshold = trackingBaseCount * REPLENISH_RATIO;
      if (trackedPoints.length < replenishThreshold) {
        const fresh = detectKeyPoints(currFrame, roi);
        if (fresh.length > trackedPoints.length) {
          console.log(`프레임 ${i}: 특징점 재검출로 ${trackedPoints.length}개 -> ${fresh.length}개 보충`);
          trackedPoints = fresh;
          trackingBaseCount = fresh.length;
        }
      }

      prevFrame = currFrame;
      prevPoints = trackedPoints;
      lastIndex = i;
    } else {
      // 추적 실패 - 등속 예측 위치 주변에서 특징점 재검출을 시도해 복구를 시도한다
      const predictedCenter = predictCenter(prevCenter, lastCenter);
      const searchROI = regionAround(
        predictedCenter, initialROI.w, initialROI.h, currFrame.width, currFrame.height, 1.8
      );
      const recovered = detectKeyPoints(currFrame, searchROI);

      if (recovered.length >= MIN_ABSOLUTE_POINTS) {
        const roi = calculateROIFromPoints(recovered, initialROI.w, initialROI.h);
        trackedROIs.set(i, { x: roi.x, y: roi.y, w: roi.w, h: roi.h, confidence: 0.5 });
        console.log(`프레임 ${i}: 추적 실패 후 재검출로 복구됨 (${recovered.length}개, 예측 위치 기반)`);

        prevCenter = lastCenter;
        lastCenter = centerOf(roi);
        prevFrame = currFrame;
        prevPoints = recovered;
        trackingBaseCount = recovered.length;
        lastIndex = i;
      } else {
        // 복구도 실패 - 마지막으로 알려진 위치를 유지하고 신뢰도 0으로 표시
        const prevROI = trackedROIs.get(lastIndex) ?? initialROI;
        trackedROIs.set(i, { x: prevROI.x, y: prevROI.y, w: prevROI.w, h: prevROI.h, confidence: 0 });
        console.log(`프레임 ${i}: 추적 실패 (${trackedPoints.length}개 특징점만 감지, 복구도 실패)`);
        // prevFrame/prevPoints는 마지막 성공 지점 그대로 유지해 다음 프레임에서 다시 시도한다
      }
    }

    onStep(step + 1);
  }
}

// ROI 내부에서 Good Features to Track (Shi-Tomasi) 코너 감지
function detectKeyPoints(
  imageData: ImageData,
  roi: { x: number; y: number; w: number; h: number }
): Point[] {
  const { width, height, data } = imageData;

  // Grayscale 변환
  const gray = new jsfeat.matrix_t(width, height, jsfeat.U8_t | jsfeat.C1_t);
  jsfeat.imgproc.grayscale(data, width, height, gray);

  // jsfeat.yape06.detect는 ROI가 아니라 이미지 전체에서 코너를 찾으며, 개수를 제한하는
  // 파라미터가 없다(세 번째 인자는 최대 개수가 아니라 가장자리 여백이다). 내부적으로
  // points[i].x = ... 처럼 기존 keypoint_t 객체에 직접 대입하기 때문에, 실제 검출된
  // 코너 수보다 배열이 작으면 "undefined 프로퍼티 설정" 오류로 크래시한다. 실사 영상은
  // 디테일이 많아 수천 개 이상의 코너가 잡힐 수 있어 고정된 크기로는 안전을 보장할 수
  // 없으므로, 접근하는 인덱스에 맞춰 필요한 만큼 자동으로 늘어나는 배열을 사용한다.
  const cornerCache = new Map<number, jsfeat.keypoint_t>();
  const corners = new Proxy([] as jsfeat.keypoint_t[], {
    get(target, prop) {
      if (typeof prop === 'string' && /^\d+$/.test(prop)) {
        const idx = Number(prop);
        let kp = cornerCache.get(idx);
        if (!kp) {
          kp = new jsfeat.keypoint_t();
          cornerCache.set(idx, kp);
        }
        return kp;
      }
      return (target as any)[prop];
    }
  });

  // ROI 영역에서만 코너 검출
  const x = Math.max(0, Math.floor(roi.x));
  const y = Math.max(0, Math.floor(roi.y));
  const w = Math.min(width - x, Math.ceil(roi.w));
  const h = Math.min(height - y, Math.ceil(roi.h));

  // YAPE06 코너 검출기 사용 (민감도 조정)
  jsfeat.yape06.laplacian_threshold = 20; // 더 낮춰서 더 많은 특징점 감지
  jsfeat.yape06.min_eigen_value_threshold = 15; // 더 낮춰서 더 많은 특징점 감지

  // 세 번째 인자는 최대 개수가 아니라 이미지 가장자리 여백(border)이다. 기본값 5를 사용한다.
  const detectedCount = jsfeat.yape06.detect(gray, corners, 5);

  // ROI 내부의 코너만 필터링 (실제로 검출된 개수만큼만 순회)
  const points: Point[] = [];
  for (let i = 0; i < detectedCount; i++) {
    const corner = corners[i];
    if (corner.x >= x && corner.x < x + w &&
        corner.y >= y && corner.y < y + h) {
      points.push({ x: corner.x, y: corner.y });
    }
  }

  return points;
}

// Lucas-Kanade Optical Flow로 특징점 추적
function trackPoints(
  prevImageData: ImageData,
  currImageData: ImageData,
  prevPoints: Point[]
): Point[] {
  const { width, height } = prevImageData;

  // Grayscale 변환
  const prevGray = new jsfeat.matrix_t(width, height, jsfeat.U8_t | jsfeat.C1_t);
  const currGray = new jsfeat.matrix_t(width, height, jsfeat.U8_t | jsfeat.C1_t);

  jsfeat.imgproc.grayscale(prevImageData.data, width, height, prevGray);
  jsfeat.imgproc.grayscale(currImageData.data, width, height, currGray);

  // 피라미드 생성 (멀티스케일 추적)
  const prevPyr = new jsfeat.pyramid_t(3);
  const currPyr = new jsfeat.pyramid_t(3);
  prevPyr.allocate(width, height, jsfeat.U8_t | jsfeat.C1_t);
  currPyr.allocate(width, height, jsfeat.U8_t | jsfeat.C1_t);

  // skip_first_level을 true로 주면 피라미드 0번 레벨(원본 해상도)에 실제 그레이스케일
  // 데이터가 복사되지 않고 0으로 남는다. optical_flow_lk.track은 최종 정밀 추적을
  // level===0에서 수행하는데, 여기서 이미지가 전부 0이면 경사(gradient)가 0이 되어
  // 구조 텐서(A11,A12,A22)가 0 → D<FLT_EPSILON → 모든 특징점이 실패 처리된다.
  // (크래시 없이 100% 추적 실패로 나타났던 원인) 반드시 false로 호출해 0번 레벨을 채운다.
  prevPyr.build(prevGray, false);
  currPyr.build(currGray, false);

  // 특징점 배열 준비
  const pointCount = prevPoints.length;
  const prevXY = new Float32Array(pointCount * 2);
  const currXY = new Float32Array(pointCount * 2);
  const status = new Uint8Array(pointCount);

  for (let i = 0; i < pointCount; i++) {
    prevXY[i * 2] = prevPoints[i].x;
    prevXY[i * 2 + 1] = prevPoints[i].y;
  }

  // Lucas-Kanade Optical Flow 추적 (파라미터 최적화)
  jsfeat.optical_flow_lk.track(
    prevPyr,
    currPyr,
    prevXY,
    currXY,
    pointCount,
    20, // window size - 약간 줄여서 빠른 움직임에 대응
    30, // max iterations
    status,
    0.01, // epsilon
    0.001 // min eigen value
  );

  // 성공적으로 추적된 특징점만 반환
  const trackedPoints: Point[] = [];
  for (let i = 0; i < pointCount; i++) {
    if (status[i] === 1) {
      const x = currXY[i * 2];
      const y = currXY[i * 2 + 1];

      // 유효한 좌표인지 확인
      if (x >= 0 && x < width && y >= 0 && y < height) {
        trackedPoints.push({ x, y });
      }
    }
  }

  return trackedPoints;
}

// 추적된 특징점들로부터 ROI 계산
function calculateROIFromPoints(
  points: Point[],
  originalWidth: number,
  originalHeight: number
): { x: number; y: number; w: number; h: number } {
  if (points.length === 0) {
    return { x: 0, y: 0, w: originalWidth, h: originalHeight };
  }

  // 특징점들의 중심 계산
  let sumX = 0;
  let sumY = 0;

  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
  }

  const centerX = sumX / points.length;
  const centerY = sumY / points.length;

  // ROI 중심을 특징점 중심으로 이동
  const x = Math.max(0, centerX - originalWidth / 2);
  const y = Math.max(0, centerY - originalHeight / 2);

  return {
    x,
    y,
    w: originalWidth,
    h: originalHeight
  };
}

// canvas에서 직접 ImageData 추출 (dataURL 인코딩/디코딩 왕복 제거로 속도 개선)
function getImageData(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2D 컨텍스트를 가져올 수 없습니다.');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
