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

            // Forward tracking (시작 프레임부터 끝까지)
            let prevFrame = startFrame;
                                                            let prevPoints = initialPoints;

            for (let i = startFrameIndex + 1; i < frames.length; i++) {
                      const currFrame = getImageData(frames[i]);

                                                              // Optical Flow로 특징점 추적
                                                              const trackedPoints = trackPoints(prevFrame, currFrame, prevPoints);

                                                              if (trackedPoints.length >= initialPoints.length * 0.3) {
                                                                          // 최소 30% 이상의 특징점이 추적되어야 유효
                        const roi = calculateROIFromPoints(trackedPoints, initialROI.w, initialROI.h);
                                                                          const confidence = Math.min(trackedPoints.length / initialPoints.length, 1.0);

                        trackedROIs.set(i, {
                                      x: roi.x,
                                      y: roi.y,
                                      w: roi.w,
                                      h: roi.h,
                                      confidence
                        });

                        prevFrame = currFrame;
                                                                          prevPoints = trackedPoints;

                        console.log(`프레임 ${i}: ${trackedPoints.length}개 특징점 추적 (신뢰도: ${(confidence * 100).toFixed(1)}%)`);
                                                              } else {
                                                                          // 추적 실패 시 이전 ROI 사용 (신뢰도 0)
                        const prevROI = trackedROIs.get(i - 1);
                                                                          if (prevROI) {
                                                                                        trackedROIs.set(i, {
                                                                                                        x: prevROI.x,
                                                                                                        y: prevROI.y,
                                                                                                        w: prevROI.w,
                                                                                                        h: prevROI.h,
                                                                                                        confidence: 0
                                                                                          });
                                                                          } else {
                                                                                        // 이전 ROI도 없으면 초기 ROI 사용
                                                                            trackedROIs.set(i, {
                                                                                            x: initialROI.x,
                                                                                            y: initialROI.y,
                                                                                            w: initialROI.w,
                                                                                            h: initialROI.h,
                                                                                            confidence: 0
                                                                            });
                                                                          }

                        console.log(`프레임 ${i}: 추적 실패 (${trackedPoints.length}개 특징점만 감지)`);
                                                              }

                                                              onProgress(i - startFrameIndex + 1, frames.length);
                      setProgress(Math.round(((i - startFrameIndex + 1) / frames.length) * 50));
            }

            // Backward tracking (시작 프레임부터 처음까지)
            prevFrame = startFrame;
                                                            prevPoints = initialPoints;

            for (let i = startFrameIndex - 1; i >= 0; i--) {
                      const currFrame = getImageData(frames[i]);

                                                              // Optical Flow로 특징점 추적 (역방향)
                                                              const trackedPoints = trackPoints(prevFrame, currFrame, prevPoints);

                                                              if (trackedPoints.length >= initialPoints.length * 0.3) {
                                                                          // 최소 30% 이상의 특징점이 추적되어야 유효
                        const roi = calculateROIFromPoints(trackedPoints, initialROI.w, initialROI.h);
                                                                          const confidence = Math.min(trackedPoints.length / initialPoints.length, 1.0);

                        trackedROIs.set(i, {
                                      x: roi.x,
                                      y: roi.y,
                                      w: roi.w,
                                      h: roi.h,
                                      confidence
                        });

                        prevFrame = currFrame;
                                                                          prevPoints = trackedPoints;

                        console.log(`프레임 ${i}: ${trackedPoints.length}개 특징점 추적 (신뢰도: ${(confidence * 100).toFixed(1)}%)`);
                                                              } else {
                                                                          // 추적 실패 시 다음 ROI 사용 (신뢰도 0)
                        const nextROI = trackedROIs.get(i + 1);
                                                                          if (nextROI) {
                                                                                        trackedROIs.set(i, {
                                                                                                        x: nextROI.x,
                                                                                                        y: nextROI.y,
                                                                                                        w: nextROI.w,
                                                                                                        h: nextROI.h,
                                                                                                        confidence: 0
                                                                                          });
                                                                          } else {
                                                                                        // 다음 ROI도 없으면 초기 ROI 사용
                                                                            trackedROIs.set(i, {
                                                                                            x: initialROI.x,
                                                                                            y: initialROI.y,
                                                                                            w: initialROI.w,
                                                                                            h: initialROI.h,
                                                                                            confidence: 0
                                                                            });
                                                                          }

                        console.log(`프레임 ${i}: 추적 실패 (${trackedPoints.length}개 특징점만 감지)`);
                                                              }

                                                              onProgress(startFrameIndex - i, frames.length);
                      setProgress(50 + Math.round(((startFrameIndex - i) / frames.length) * 50));
            }

            return trackedROIs;
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

// ROI 내부에서 Good Features to Track (Shi-Tomasi) 코너 감지
function detectKeyPoints(
    imageData: ImageData,
    roi: { x: number; y: number; w: number; h: number }
  ): Point[] {
    const { width, height, data } = imageData;

  // Grayscale 변환
  const gray = new jsfeat.matrix_t(width, height, jsfeat.U8_t | jsfeat.C1_t);
    jsfeat.imgproc.grayscale(data, width, height, gray);

  // 코너 검출을 위한 설정




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
    

  // ROI 내부의 코너만 필터링
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

  prevPyr.build(prevGray, true);
    currPyr.build(currGray, true);

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
