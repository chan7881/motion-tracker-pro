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
  // false: 처음·끝이라 앞뒤를 고루 갖춘 창으로 가속도를 구할 수 없는 장면.
  // ax·ay 값은 있지만(등가속도면 정확) 그래프·통계·CSV에는 쓰지 않는다
  accelValid: boolean;
  time: number;
}

export interface ROIData {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence?: number;
}

// 속도를 구할 때 한 번에 맞추는 점의 개수 (가운데 점 기준 앞뒤 2개씩)
export const DEFAULT_FIT_POINTS = 5;

// 가속도는 위치를 두 번 미분한 값이라 추적 잡음이 (장면 간격)² 에 반비례해 커진다.
// 60 fps에서 5점(0.07초)으로 맞추면 1 px 안팎의 흔들림만으로도 가속도가 실제 값의
// 몇 배씩 오르내린다(실제 쇠구슬 영상: 실제 −320 px/s², 장면별 −1261 ~ +474).
// 그래서 가속도는 적어도 이 시간 폭(초)에 걸친 점들로 맞춘다.
const ACCEL_FIT_SECONDS = 0.2;

// 가속도를 맞출 점의 개수: 최소 fitPoints개, 장면이 촘촘하면 ACCEL_FIT_SECONDS를 덮도록 늘린다(홀수)
export function accelFitPoints(fps: number, fitPoints: number = DEFAULT_FIT_POINTS): number {
  const half = Math.round((ACCEL_FIT_SECONDS * fps) / 2);
  return Math.max(fitPoints, 2 * half + 1);
}

// 기준선의 픽셀 길이와 사용자가 입력한 실제 길이(m)로부터 pixelsPerMeter 값을 계산
export function computePixelsPerMeter(pixelDistance: number, realWorldMeters: number): number | null {
  if (!pixelDistance || pixelDistance <= 0 || !realWorldMeters || realWorldMeters <= 0) {
    return null;
  }
  return pixelDistance / realWorldMeters;
}

// 좌표계: 화면(캔버스)은 y가 아래로 커지지만, 분석 결과는 교과서처럼 "왼쪽 아래 모서리가
// 원점, 오른쪽이 +x, 위쪽이 +y"로 바꿔서 낸다. 그래야 위로 던진 공의 위치 그래프가
// 위로 볼록하게 나오고, 떨어지는 물체의 vy·ay가 음수(아래 방향)로 나온다.
//
// 속도·가속도: 이웃한 점 몇 개(fitPoints)에 2차식 x(t) = c0 + c1·τ + c2·τ² (τ = t - t_i)을
// 최소제곱으로 맞춰 v = c1, a = 2·c2 로 구한다. 가속도가 일정한 운동이면 처음·끝 장면과
// 건너뛴 장면이 있어도 정확히 맞고, 점을 여러 개 쓰므로 추적 잡음이 줄어든다.
// 가속도는 잡음에 훨씬 민감하므로 더 넓은 창(accelFitPoints)으로 따로 맞춘다.
export function analyzeMotion(
  frameROIs: Map<number, ROIData>,
  fps: number,
  pixelsPerMeter: number | null = null, // null: 크기 보정 없음 -> 결과를 픽셀 단위로 유지
  frameHeight: number = 0, // 화면 높이(px). y를 위쪽이 +가 되도록 뒤집는 데 쓴다
  fitPoints: number = DEFAULT_FIT_POINTS
): MotionData[] {
  // 추적이 완전히 실패한(confidence === 0) 프레임은 제외한다. 이런 프레임은 물체가 실제로
  // 이동했는데도 "마지막으로 성공한 위치"에 고정된 값이라, 그대로 쓰면 가짜 정지 구간이
  // 생긴다. 각 점의 실제 시각으로 맞추므로 중간 프레임을 건너뛰어도 물리량은 정확하다.
  const samples = Array.from(frameROIs.entries())
    .filter(([, roi]) => roi && roi.confidence !== 0 &&
      Number.isFinite(roi.x) && Number.isFinite(roi.y) &&
      Number.isFinite(roi.w) && Number.isFinite(roi.h))
    .sort((a, b) => a[0] - b[0]);

  if (samples.length < 2 || !(fps > 0)) return [];

  // 보정 값이 없으면 픽셀 원본값을 그대로 사용한다 (단위: px, px/s, px/s²)
  const pixelsPerUnit = pixelsPerMeter && pixelsPerMeter > 0 ? pixelsPerMeter : 1;

  const t = samples.map(([frame]) => frame / fps);
  const xs = samples.map(([, r]) => (r.x + r.w / 2) / pixelsPerUnit);
  const ys = samples.map(([, r]) => (frameHeight - (r.y + r.h / 2)) / pixelsPerUnit);

  const n = samples.length;
  const velocityWindow = Math.max(2, Math.min(fitPoints, n));
  const accelWindow = Math.max(2, Math.min(accelFitPoints(fps, fitPoints), n));

  // i번째 점 둘레 size개 점에 2차식을 맞춘다. 가운데에 i를 두되, 처음·끝 근처에서는
  // 창을 안쪽으로 밀어 개수를 유지한다
  const fitAround = (i: number, size: number) => {
    let start = i - Math.floor((size - 1) / 2);
    start = Math.max(0, Math.min(start, n - size));
    const idx = Array.from({ length: size }, (_, k) => start + k);
    const tau = idx.map((j) => t[j] - t[i]);
    return {
      x: fitDerivatives(tau, idx.map((j) => xs[j])),
      y: fitDerivatives(tau, idx.map((j) => ys[j]))
    };
  };

  return samples.map(([frame], i) => {
    const v = fitAround(i, velocityWindow);
    const a = accelWindow === velocityWindow ? v : fitAround(i, accelWindow);
    // 처음·끝 근처는 창을 안쪽으로 밀어 쓰므로 여러 장면이 같은 창 = 같은 가속도가 된다.
    // 그대로 그리면 끝이 평평해져 「그동안 가속도가 일정했다」로 읽히고, 창을 줄이면 잡음이
    // 커진다. 앞뒤를 고루 갖춘 창이 들어가는 장면만 믿을 수 있는 가속도로 표시한다.
    const accelValid = accelWindow >= 3 &&
      i - Math.floor((accelWindow - 1) / 2) >= 0 &&
      i + Math.floor(accelWindow / 2) <= n - 1;

    return {
      frame,
      time: t[i],
      x: xs[i],
      y: ys[i],
      vx: v.x.v,
      vy: v.y.v,
      speed: Math.hypot(v.x.v, v.y.v),
      ax: a.x.a,
      ay: a.y.a,
      acceleration: Math.hypot(a.x.a, a.y.a),
      accelValid
    };
  });
}

// τ(기준 시각으로부터의 시간)와 값 목록에 2차식을 최소제곱으로 맞춰 τ=0에서의
// 1차 도함수(속도)와 2차 도함수(가속도)를 돌려준다. 점이 2개뿐이면 직선으로 맞춘다.
function fitDerivatives(tau: number[], values: number[]): { v: number; a: number } {
  const m = tau.length;

  if (m < 3) {
    const dt = tau[1] - tau[0];
    return { v: dt !== 0 ? (values[1] - values[0]) / dt : 0, a: 0 };
  }

  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0;
  let r0 = 0, r1 = 0, r2 = 0;
  for (let k = 0; k < m; k++) {
    const u = tau[k];
    const u2 = u * u;
    s0 += 1; s1 += u; s2 += u2; s3 += u2 * u; s4 += u2 * u2;
    r0 += values[k]; r1 += values[k] * u; r2 += values[k] * u2;
  }

  // 정규방정식 [s0 s1 s2; s1 s2 s3; s2 s3 s4]·[c0 c1 c2] = [r0 r1 r2] 을 크라메르 공식으로 푼다
  const det = det3(s0, s1, s2, s1, s2, s3, s2, s3, s4);
  if (Math.abs(det) < 1e-18) return { v: 0, a: 0 };

  const c1 = det3(s0, r0, s2, s1, r1, s3, s2, r2, s4) / det;
  const c2 = det3(s0, s1, r0, s1, s2, r1, s2, s3, r2) / det;
  return { v: c1, a: 2 * c2 };
}

function det3(
  a: number, b: number, c: number,
  d: number, e: number, f: number,
  g: number, h: number, k: number
): number {
  return a * (e * k - f * h) - b * (d * k - f * g) + c * (d * h - e * g);
}
