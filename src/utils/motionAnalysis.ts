export interface MotionData {
  frame: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  ax: number;
  ay: number;
  acceleration: number;
  time: number;
}

export interface ROIData {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence?: number;
}

// 기준선의 픽셀 길이와 사용자가 입력한 실제 길이(m)로부터 pixelsPerMeter 값을 계산
export function computePixelsPerMeter(pixelDistance: number, realWorldMeters: number): number | null {
  if (!pixelDistance || pixelDistance <= 0 || !realWorldMeters || realWorldMeters <= 0) {
    return null;
  }
  return pixelDistance / realWorldMeters;
}

export function analyzeMotion(
  frameROIs: Map<number, ROIData>,
  fps: number,
  pixelsPerMeter: number | null = null // null: 크기 보정 없음 -> 결과를 픽셀 단위로 유지
): MotionData[] {
  const motionData: MotionData[] = [];
  // 추적이 완전히 실패한(confidence === 0) 프레임은 제외한다. 이런 프레임은 물체가 실제로
  // 이동했는데도 "마지막으로 성공한 위치"에 고정된 값이라, 그대로 쓰면 속도/가속도 그래프에
  // 가짜 정지 구간과 튀는 값이 생긴다. 인접한 유효 프레임 사이의 시간 간격(dt_total)으로
  // 계산하므로 중간 프레임을 건너뛰어도 물리량 자체는 정확하다.
  const sortedFrames = Array.from(frameROIs.entries())
    .filter(([, roi]) => roi.confidence !== 0)
    .map(([frameIndex]) => frameIndex)
    .sort((a, b) => a - b);

  if (sortedFrames.length < 2) return motionData;

  // 보정 값이 없으면 나눗셈 없이 픽셀 원본값을 그대로 사용한다 (단위: px, px/s, px/s²)
  const unitsPerPixel = pixelsPerMeter && pixelsPerMeter > 0 ? pixelsPerMeter : 1;
  const dt = 1 / fps; // Time between frames

  for (let i = 0; i < sortedFrames.length; i++) {
    const frameIndex = sortedFrames[i];
    const roi = frameROIs.get(frameIndex);

    // Skip if ROI is undefined
    if (!roi || typeof roi.x !== 'number' || typeof roi.y !== 'number' ||
        typeof roi.w !== 'number' || typeof roi.h !== 'number') {
      console.warn(`프레임 ${frameIndex}: 유효하지 않은 ROI 데이터`);
      continue;
    }

    // Center of ROI
    const x = (roi.x + roi.w / 2) / unitsPerPixel;
    const y = (roi.y + roi.h / 2) / unitsPerPixel;
    const time = frameIndex * dt;

    let vx = 0, vy = 0, speed = 0;
    let ax = 0, ay = 0, acceleration = 0;

    // Calculate velocity using central difference when possible
    if (i > 0 && i < sortedFrames.length - 1) {
      const prevFrame = sortedFrames[i - 1];
      const nextFrame = sortedFrames[i + 1];
      const prevROI = frameROIs.get(prevFrame);
      const nextROI = frameROIs.get(nextFrame);

      if (!prevROI || !nextROI) {
        // Skip velocity calculation if prev or next ROI is missing
        continue;
      }

      const x_prev = (prevROI.x + prevROI.w / 2) / unitsPerPixel;
      const y_prev = (prevROI.y + prevROI.h / 2) / unitsPerPixel;
      const x_next = (nextROI.x + nextROI.w / 2) / unitsPerPixel;
      const y_next = (nextROI.y + nextROI.h / 2) / unitsPerPixel;

      const dt_total = (nextFrame - prevFrame) * dt;
      vx = (x_next - x_prev) / dt_total;
      vy = (y_next - y_prev) / dt_total;
    } else if (i > 0) {
      // Forward difference for last frame
      const prevFrame = sortedFrames[i - 1];
      const prevROI = frameROIs.get(prevFrame);

      if (prevROI) {
        const x_prev = (prevROI.x + prevROI.w / 2) / unitsPerPixel;
        const y_prev = (prevROI.y + prevROI.h / 2) / unitsPerPixel;

        vx = (x - x_prev) / dt;
        vy = (y - y_prev) / dt;
      }
    } else if (i < sortedFrames.length - 1) {
      // Backward difference for first frame
      const nextFrame = sortedFrames[i + 1];
      const nextROI = frameROIs.get(nextFrame);

      if (nextROI) {
        const x_next = (nextROI.x + nextROI.w / 2) / unitsPerPixel;
        const y_next = (nextROI.y + nextROI.h / 2) / unitsPerPixel;

        vx = (x_next - x) / dt;
        vy = (y_next - y) / dt;
      }
    }

    speed = Math.sqrt(vx * vx + vy * vy);

    // Calculate acceleration
    if (i > 0) {
      const prevMotion = motionData[i - 1];
      ax = (vx - prevMotion.vx) / dt;
      ay = (vy - prevMotion.vy) / dt;
      acceleration = Math.sqrt(ax * ax + ay * ay);
    }

    motionData.push({
      frame: frameIndex,
      x,
      y,
      vx,
      vy,
      speed,
      ax,
      ay,
      acceleration,
      time
    });
  }

  return motionData;
}

export function smoothMotionData(data: MotionData[], windowSize: number = 3): MotionData[] {
  if (data.length < windowSize) return data;

  const smoothed: MotionData[] = [];
  const halfWindow = Math.floor(windowSize / 2);

  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - halfWindow);
    const end = Math.min(data.length, i + halfWindow + 1);
    const window = data.slice(start, end);

    const avg = {
      frame: data[i].frame,
      time: data[i].time,
      x: window.reduce((sum, d) => sum + d.x, 0) / window.length,
      y: window.reduce((sum, d) => sum + d.y, 0) / window.length,
      vx: window.reduce((sum, d) => sum + d.vx, 0) / window.length,
      vy: window.reduce((sum, d) => sum + d.vy, 0) / window.length,
      speed: window.reduce((sum, d) => sum + d.speed, 0) / window.length,
      ax: window.reduce((sum, d) => sum + d.ax, 0) / window.length,
      ay: window.reduce((sum, d) => sum + d.ay, 0) / window.length,
      acceleration: window.reduce((sum, d) => sum + d.acceleration, 0) / window.length,
    };

    smoothed.push(avg);
  }

  return smoothed;
}
