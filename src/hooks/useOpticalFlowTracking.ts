import { useState, useCallback } from 'react';

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

interface GrayImage {
  data: Float32Array;
  width: number;
  height: number;
}

interface MatchResult {
  x: number;
  y: number;
  score: number;
}

// ZNCC(Zero-mean Normalized Cross-Correlation) 점수가 이 값 이상이면 정상 추적으로 판정한다
const ACCEPT_THRESHOLD = 0.5;
// 정상 판정에는 못 미치더라도, 훨씬 넓은 영역에서 재탐색(복구 시도)했을 때 이 값 이상이면 복구 성공으로 판정한다
const RECOVERY_THRESHOLD = 0.35;
// 프레임 간 이동을 감안한 기본 탐색 반경에 더해주는 여유(px)
const SEARCH_MARGIN = 24;
// 연속 실패 시 탐색 반경을 넓히는 배율 (실패 횟수만큼 거듭제곱)
const SEARCH_GROWTH_PER_FAILURE = 1.8;
// 탐색 반경 상한 (물체 크기 대비 배수)
const MAX_SEARCH_RADIUS_MULTIPLIER = 6;
// 고신뢰 매칭이 이만큼 연속되면 템플릿을 현재 모습으로 살짝 갱신한다 (조명/각도 변화 대응)
const TEMPLATE_REFRESH_INTERVAL = 8;
const TEMPLATE_REFRESH_BLEND = 0.15;
// 이 값보다 초기 ROI의 명암 분산이 작으면(=무늬가 거의 없으면) 애초에 추적이 불가능하다고 판단한다
const MIN_TEMPLATE_VARIANCE = 4;
// 다운샘플 후 목표로 하는 템플릿 한 변의 픽셀 수 (탐색 1단계 속도용)
const COARSE_TARGET_SIZE = 24;

export const useOpticalFlowTracking = () => {
  const [isTracking, setIsTracking] = useState(false);
  const [progress, setProgress] = useState(0);

  // 정규화 상호상관(ZNCC) 템플릿 매칭을 사용한 물체 추적.
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

      const roiW = Math.max(4, Math.round(initialROI.w));
      const roiH = Math.max(4, Math.round(initialROI.h));

      // 초기 프레임에서 추적 대상 템플릿(패치) 추출
      const startGray = toGrayImage(getImageData(frames[startFrameIndex]));
      const initialTemplate = extractPatch(startGray, Math.round(initialROI.x), Math.round(initialROI.y), roiW, roiH);

      if (varianceOf(initialTemplate) < MIN_TEMPLATE_VARIANCE) {
        throw new Error('초기 ROI 안에 뚜렷한 무늬가 없어 추적할 수 없습니다. 물체의 경계나 무늬가 포함되도록 ROI를 좀 더 크게 선택해주세요.');
      }

      console.log(`템플릿 매칭 추적 시작 (ROI ${roiW}x${roiH})`);

      const startCenter = centerOf(initialROI);

      trackedROIs.set(startFrameIndex, {
        x: initialROI.x,
        y: initialROI.y,
        w: roiW,
        h: roiH,
        confidence: 1.0
      });

      // 정방향 추적 (시작 프레임 -> 마지막 프레임)
      trackSequence({
        frames,
        indices: rangeAsc(startFrameIndex + 1, frames.length),
        template: initialTemplate,
        roiW,
        roiH,
        startCenter,
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
        template: initialTemplate,
        roiW,
        roiH,
        startCenter,
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

// 한 방향(정방향 또는 역방향)의 프레임 시퀀스를 순서대로 추적한다.
// 이전 방식(코너 특징점 + 옵티컬 플로우)은 프레임을 넘어갈 때마다 오차가 누적되고,
// 표면이 매끈해 코너가 적은 물체(공, 마커 등)에서는 애초에 특징점을 찾지 못해 자주
// 실패했다. 대신 최초 ROI를 "템플릿"으로 고정해두고, 매 프레임 예측 위치 주변에서
// 그 템플릿과 가장 비슷한 위치를 정규화 상호상관(ZNCC)으로 직접 찾는다. 프레임마다
// 항상 같은 기준 템플릿과 비교하므로 오차가 누적되지 않고, 코너 유무와 무관하게
// 동작한다.
function trackSequence(params: {
  frames: HTMLCanvasElement[];
  indices: number[];
  template: Float32Array;
  roiW: number;
  roiH: number;
  startCenter: Point;
  trackedROIs: Map<number, TrackedROI>;
  onStep: (stepNumber: number) => void;
}): void {
  const { frames, indices, roiW, roiH, trackedROIs, onStep } = params;

  let template = params.template;
  let prevCenter: Point | null = null;
  let lastCenter: Point = params.startCenter;
  let failStreak = 0;
  let successSinceRefresh = 0;

  for (let step = 0; step < indices.length; step++) {
    const i = indices[step];
    const gray = toGrayImage(getImageData(frames[i]));

    const predicted = predictCenter(prevCenter, lastCenter);
    const baseRadius = Math.max(roiW, roiH) / 2 + SEARCH_MARGIN;
    const maxRadius = Math.max(roiW, roiH) * MAX_SEARCH_RADIUS_MULTIPLIER;
    const radius = Math.min(maxRadius, baseRadius * Math.pow(SEARCH_GROWTH_PER_FAILURE, failStreak));

    const match = matchTemplate(gray, template, roiW, roiH, predicted.x, predicted.y, radius);

    if (match.score >= ACCEPT_THRESHOLD) {
      const confidence = Math.max(0, Math.min(1, match.score));
      trackedROIs.set(i, { x: match.x, y: match.y, w: roiW, h: roiH, confidence });
      console.log(`프레임 ${i}: 매칭 성공 (점수 ${match.score.toFixed(2)})`);

      prevCenter = lastCenter;
      lastCenter = { x: match.x + roiW / 2, y: match.y + roiH / 2 };
      failStreak = 0;
      successSinceRefresh++;

      // 조명/각도 변화에 서서히 적응하도록, 매우 확실한 매칭이 일정 프레임 이어지면
      // 템플릿을 현재 모습 쪽으로 살짝만 섞어준다(blend). 매 프레임 갱신하면 오차가
      // 누적(drift)되므로 간격을 두고 고신뢰 매칭일 때만 수행한다.
      if (match.score > 0.75 && successSinceRefresh >= TEMPLATE_REFRESH_INTERVAL) {
        const currentPatch = extractPatch(gray, Math.round(match.x), Math.round(match.y), roiW, roiH);
        template = blendTemplate(template, currentPatch, TEMPLATE_REFRESH_BLEND);
        successSinceRefresh = 0;
      }
    } else {
      // 기본 반경에서 실패 - 훨씬 넓은 영역에서 낮은 기준으로 재탐색해 복구를 시도한다
      const recoveryRadius = Math.min(Math.max(gray.width, gray.height), maxRadius * 1.5);
      const recovered = matchTemplate(gray, template, roiW, roiH, predicted.x, predicted.y, recoveryRadius);

      if (recovered.score >= RECOVERY_THRESHOLD) {
        trackedROIs.set(i, { x: recovered.x, y: recovered.y, w: roiW, h: roiH, confidence: 0.5 });
        console.log(`프레임 ${i}: 넓은 영역 재탐색으로 복구됨 (점수 ${recovered.score.toFixed(2)})`);

        prevCenter = lastCenter;
        lastCenter = { x: recovered.x + roiW / 2, y: recovered.y + roiH / 2 };
        failStreak = 0;
        successSinceRefresh = 0;
      } else {
        // 복구도 실패 - 마지막으로 알려진 위치를 유지하고 신뢰도 0으로 표시한다.
        // lastCenter는 성공한 프레임에서만 갱신되므로 자동으로 "마지막 성공 지점"이 된다.
        trackedROIs.set(i, { x: lastCenter.x - roiW / 2, y: lastCenter.y - roiH / 2, w: roiW, h: roiH, confidence: 0 });
        console.log(`프레임 ${i}: 추적 실패 (최고 점수 ${match.score.toFixed(2)}, 복구도 실패)`);
        failStreak++;
      }
    }

    onStep(step + 1);
  }
}

// 템플릿(고정 크기 w*h 패치)을 탐색 중심 주변 반경 내에서 정규화 상호상관(ZNCC)으로 찾는다.
// 1단계로 다운샘플된 저해상도에서 대략적인 위치를 빠르게 찾고, 2단계로 그 주변만
// 원본 해상도에서 정밀 탐색해 속도와 정확도를 함께 확보한다(coarse-to-fine).
function matchTemplate(
  frame: GrayImage,
  template: Float32Array,
  templateW: number,
  templateH: number,
  searchCenterX: number,
  searchCenterY: number,
  searchRadius: number
): MatchResult {
  const r = Math.max(0, Math.round(searchRadius));
  const searchX = Math.round(searchCenterX - templateW / 2) - r;
  const searchY = Math.round(searchCenterY - templateH / 2) - r;
  const searchW = templateW + r * 2;
  const searchH = templateH + r * 2;

  const maxDim = Math.max(templateW, templateH);
  const factor = Math.max(1, Math.round(maxDim / COARSE_TARGET_SIZE));

  if (factor === 1 || searchW <= templateW + 2 || searchH <= templateH + 2) {
    // 템플릿이 이미 작거나 탐색 범위가 좁으면 다운샘플 단계 없이 바로 전수 탐색한다
    return exhaustiveSearch(frame, template, templateW, templateH, searchX, searchY, searchW, searchH);
  }

  // 1단계: 다운샘플된 템플릿/탐색 영역에서 대략적인 위치를 빠르게 찾는다
  const coarseTemplate = downsamplePatch(template, templateW, templateH, factor);
  const coarseSearch = downsampleRegion(frame, searchX, searchY, searchW, searchH, factor);
  const coarse = exhaustiveSearchInArray(
    coarseSearch.data, coarseSearch.width, coarseSearch.height,
    coarseTemplate.data, coarseTemplate.width, coarseTemplate.height
  );

  const approxX = searchX + coarse.x * factor;
  const approxY = searchY + coarse.y * factor;

  // 2단계: 대략적인 위치 주변만 원본 해상도에서 정밀 탐색한다
  const refineMargin = factor;
  const refineX = approxX - refineMargin;
  const refineY = approxY - refineMargin;
  const refineW = templateW + refineMargin * 2;
  const refineH = templateH + refineMargin * 2;

  return exhaustiveSearch(frame, template, templateW, templateH, refineX, refineY, refineW, refineH);
}

// 이미지 경계를 벗어나면 가장자리 값으로 클램프하며 전수 탐색한다 (원본 해상도용)
function exhaustiveSearch(
  frame: GrayImage,
  template: Float32Array,
  templateW: number,
  templateH: number,
  originX: number,
  originY: number,
  regionW: number,
  regionH: number
): MatchResult {
  let bestScore = -Infinity;
  let bestX = originX;
  let bestY = originY;

  const maxDx = Math.max(0, regionW - templateW);
  const maxDy = Math.max(0, regionH - templateH);

  for (let dy = 0; dy <= maxDy; dy++) {
    for (let dx = 0; dx <= maxDx; dx++) {
      const x = originX + dx;
      const y = originY + dy;
      const patch = extractPatch(frame, x, y, templateW, templateH);
      const score = zncc(template, patch);
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }
  }

  return { x: bestX, y: bestY, score: bestScore };
}

// 이미 메모리에 있는(다운샘플된) 배열 안에서 전수 탐색한다 (좌표는 배열 내부 인덱스)
function exhaustiveSearchInArray(
  region: Float32Array, regionW: number, regionH: number,
  template: Float32Array, templateW: number, templateH: number
): { x: number; y: number; score: number } {
  let bestScore = -Infinity;
  let bestX = 0;
  let bestY = 0;

  const maxX = Math.max(0, regionW - templateW);
  const maxY = Math.max(0, regionH - templateH);

  for (let y = 0; y <= maxY; y++) {
    for (let x = 0; x <= maxX; x++) {
      const patch = extractSubArray(region, regionW, x, y, templateW, templateH);
      const score = zncc(template, patch);
      if (score > bestScore) {
        bestScore = score;
        bestX = x;
        bestY = y;
      }
    }
  }

  return { x: bestX, y: bestY, score: bestScore };
}

// 그레이스케일 이미지에서 (x,y) 위치 기준 w*h 패치를 추출한다. 경계를 벗어나면 가장자리로 클램프한다.
function extractPatch(img: GrayImage, x: number, y: number, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const sy = Math.min(img.height - 1, Math.max(0, y + j));
    const rowOffset = sy * img.width;
    for (let i = 0; i < w; i++) {
      const sx = Math.min(img.width - 1, Math.max(0, x + i));
      out[j * w + i] = img.data[rowOffset + sx];
    }
  }
  return out;
}

function extractSubArray(src: Float32Array, srcW: number, x: number, y: number, w: number, h: number): Float32Array {
  const out = new Float32Array(w * h);
  for (let j = 0; j < h; j++) {
    const rowOffset = (y + j) * srcW + x;
    for (let i = 0; i < w; i++) {
      out[j * w + i] = src[rowOffset + i];
    }
  }
  return out;
}

// 정규화 상호상관(ZNCC): 밝기/대비 차이에 강건하며 -1(정반대) ~ 1(완전 일치) 범위를 갖는다
function zncc(a: Float32Array, b: Float32Array): number {
  const n = a.length;
  let meanA = 0;
  let meanB = 0;
  for (let i = 0; i < n; i++) {
    meanA += a[i];
    meanB += b[i];
  }
  meanA /= n;
  meanB /= n;

  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const da = a[i] - meanA;
    const db = b[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }

  const den = Math.sqrt(denA * denB);
  return den < 1e-6 ? 0 : num / den;
}

function varianceOf(patch: Float32Array): number {
  const n = patch.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += patch[i];
  mean /= n;

  let variance = 0;
  for (let i = 0; i < n; i++) {
    const d = patch[i] - mean;
    variance += d * d;
  }
  return variance / n;
}

function blendTemplate(template: Float32Array, fresh: Float32Array, rate: number): Float32Array {
  const out = new Float32Array(template.length);
  for (let i = 0; i < template.length; i++) {
    out[i] = template[i] * (1 - rate) + fresh[i] * rate;
  }
  return out;
}

// w*h 크기의 이미 메모리에 있는 패치를 factor배 다운샘플(박스 평균)한다
function downsamplePatch(src: Float32Array, w: number, h: number, factor: number): { data: Float32Array; width: number; height: number } {
  const dw = Math.max(1, Math.floor(w / factor));
  const dh = Math.max(1, Math.floor(h / factor));
  const out = new Float32Array(dw * dh);

  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      let sum = 0;
      let count = 0;
      for (let fy = 0; fy < factor; fy++) {
        const sy = dy * factor + fy;
        if (sy >= h) continue;
        for (let fx = 0; fx < factor; fx++) {
          const sx = dx * factor + fx;
          if (sx >= w) continue;
          sum += src[sy * w + sx];
          count++;
        }
      }
      out[dy * dw + dx] = count > 0 ? sum / count : 0;
    }
  }

  return { data: out, width: dw, height: dh };
}

// 원본 이미지의 (x,y,w,h) 영역을 factor배 다운샘플(박스 평균)한다. 경계를 벗어나면 가장자리로 클램프한다.
function downsampleRegion(img: GrayImage, x: number, y: number, w: number, h: number, factor: number): { data: Float32Array; width: number; height: number } {
  const dw = Math.max(1, Math.floor(w / factor));
  const dh = Math.max(1, Math.floor(h / factor));
  const out = new Float32Array(dw * dh);

  for (let dy = 0; dy < dh; dy++) {
    for (let dx = 0; dx < dw; dx++) {
      let sum = 0;
      let count = 0;
      for (let fy = 0; fy < factor; fy++) {
        const sy = Math.min(img.height - 1, Math.max(0, y + dy * factor + fy));
        for (let fx = 0; fx < factor; fx++) {
          const sx = Math.min(img.width - 1, Math.max(0, x + dx * factor + fx));
          sum += img.data[sy * img.width + sx];
          count++;
        }
      }
      out[dy * dw + dx] = count > 0 ? sum / count : 0;
    }
  }

  return { data: out, width: dw, height: dh };
}

// 그레이스케일 변환 (표준 휘도 가중치)
function toGrayImage(imageData: ImageData): GrayImage {
  const { width, height, data } = imageData;
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; p < gray.length; i += 4, p++) {
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return { data: gray, width, height };
}

// canvas에서 직접 ImageData 추출 (dataURL 인코딩/디코딩 왕복 제거로 속도 개선)
function getImageData(canvas: HTMLCanvasElement): ImageData {
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2D 컨텍스트를 가져올 수 없습니다.');
  return ctx.getImageData(0, 0, canvas.width, canvas.height);
}
