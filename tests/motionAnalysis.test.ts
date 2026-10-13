// 실행: npm test  (Node 22의 --experimental-strip-types로 TS를 그대로 돌린다)
//
// 이론값은 analyzeMotion을 쓰지 않고 등가속도 운동 공식에서 직접 구한다.
//   x(t) = x0 + vx0·t + ½·ax·t²,  v(t) = v0 + a·t
// 가짜 영상 좌표(화면 y는 아래로 +)를 만들어 넣고, 결과가 "위쪽이 +"인 교과서 좌표로
// 부호까지 맞게 나오는지 본다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeMotion, accelFitPoints, type ROIData } from '../src/utils/motionAnalysis.ts';

const H = 720;          // 화면 높이(px)
const PPM = 100;        // 1 m = 100 px
const FPS = 10;
const G = 9.8;
const ROI = 20;         // ROI 한 변(px). 중심 = x + ROI/2

function close(actual: number, expected: number, label: string, tol = 1e-6) {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: 기대 ${expected}, 실제 ${actual} (차이 ${actual - expected})`);
}

// 화면 좌표의 물체 중심(cx, cy)으로 ROI를 만든다
function roiAt(cx: number, cy: number, confidence = 1): ROIData {
  return { x: cx - ROI / 2, y: cy - ROI / 2, w: ROI, h: ROI, confidence };
}

// 수평으로 2 m/s, 수직으로 2 m/s 위로 던진 공 (교과서 좌표, 출발점 = 화면 (100px, 600px))
const VX0 = 2, VY0 = 2;
function thrown(t: number) {
  const xm = 1 + VX0 * t;                       // m, 왼쪽 모서리 기준
  const ym = (H - 600) / PPM + VY0 * t - 0.5 * G * t * t; // m, 아래 모서리 기준, 위가 +
  return { xm, ym, cx: xm * PPM, cy: H - ym * PPM };
}

function buildThrownAt(frames: number[], fps: number) {
  const m = new Map<number, ROIData>();
  for (const f of frames) {
    const p = thrown(f / fps);
    m.set(f, roiAt(p.cx, p.cy));
  }
  return m;
}

function buildThrown(frames: number[], failed: number[] = []) {
  const m = new Map<number, ROIData>();
  for (const f of frames) {
    const p = thrown(f / FPS);
    m.set(f, failed.includes(f) ? roiAt(123, 456, 0) : roiAt(p.cx, p.cy));
  }
  return m;
}

const ALL = Array.from({ length: 9 }, (_, i) => i);

test('던진 공: 모든 장면(처음·끝 포함)에서 위치·속도·가속도가 이론값과 같다', () => {
  const out = analyzeMotion(buildThrown(ALL), FPS, PPM, H);
  assert.equal(out.length, ALL.length);

  for (const d of out) {
    const t = d.frame / FPS;
    const p = thrown(t);
    close(d.time, t, `t(${d.frame})`);
    close(d.x, p.xm, `x(${d.frame})`);
    close(d.y, p.ym, `y(${d.frame})`);
    close(d.vx, VX0, `vx(${d.frame})`);
    close(d.vy, VY0 - G * t, `vy(${d.frame})`);
    close(d.ax, 0, `ax(${d.frame})`);
    close(d.ay, -G, `ay(${d.frame})`);
    close(d.acceleration, G, `|a|(${d.frame})`);
    close(d.speed, Math.hypot(VX0, VY0 - G * t), `속력(${d.frame})`);
  }
});

test('방향: 위가 +이므로 중력 가속도는 아래(음수), 올라가는 동안 vy>0, 내려오는 동안 vy<0', () => {
  const out = analyzeMotion(buildThrown(ALL), FPS, PPM, H);
  for (const d of out) {
    assert.ok(d.ay < 0, `ay(${d.frame}) = ${d.ay} 는 음수여야 한다`);
    const t = d.frame / FPS;
    if (t < VY0 / G - 1e-9) assert.ok(d.vy > 0, `t=${t} 올라가는 중 vy=${d.vy}`);
    if (t > VY0 / G + 1e-9) assert.ok(d.vy < 0, `t=${t} 내려오는 중 vy=${d.vy}`);
  }
  // 가장 높은 곳(t = 0.2 s, frame 2)에서 y가 가장 크다 — 위로 볼록한 그래프
  const top = out.reduce((a, b) => (b.y > a.y ? b : a));
  assert.equal(top.frame, 2);
});

test('추적 실패(confidence 0) 장면은 빼고, 남은 장면의 실제 시각으로 계산한다', () => {
  const failed = [1, 4, 5, 8];
  const out = analyzeMotion(buildThrown(ALL, failed), FPS, PPM, H);
  assert.deepEqual(out.map((d) => d.frame), ALL.filter((f) => !failed.includes(f)));
  for (const d of out) {
    const t = d.frame / FPS;
    close(d.vy, VY0 - G * t, `vy(${d.frame})`);
    close(d.ay, -G, `ay(${d.frame})`);
    close(d.vx, VX0, `vx(${d.frame})`);
  }
});

test('크기 보정을 안 하면 px 단위, y는 화면 아래 모서리에서 위로 잰다', () => {
  const out = analyzeMotion(buildThrown(ALL), FPS, null, H);
  for (const d of out) {
    const t = d.frame / FPS;
    const p = thrown(t);
    close(d.x, p.cx, `x(${d.frame})`, 1e-4);
    close(d.y, H - p.cy, `y(${d.frame})`, 1e-4);
    close(d.ay, -G * PPM, `ay(${d.frame})`, 1e-4);
  }
});

test('점이 3개뿐이어도 등가속도는 정확하다', () => {
  const out = analyzeMotion(buildThrown([0, 1, 2]), FPS, PPM, H);
  for (const d of out) close(d.ay, -G, `ay(${d.frame})`);
});

test('점이 2개면 평균 속도, 가속도는 0', () => {
  const out = analyzeMotion(buildThrown([0, 3]), FPS, PPM, H);
  const expectedVy = (thrown(0.3).ym - thrown(0).ym) / 0.3;
  for (const d of out) {
    close(d.vy, expectedVy, `vy(${d.frame})`);
    close(d.ay, 0, `ay(${d.frame})`);
  }
});

test('점이 1개 이하면 빈 결과', () => {
  assert.deepEqual(analyzeMotion(buildThrown([4]), FPS, PPM, H), []);
  assert.deepEqual(analyzeMotion(buildThrown([0, 1], [0]), FPS, PPM, H), []);
});

test('가속도가 변하는 운동(단진동)도 가운데 장면에서는 이론값과 거의 같다', () => {
  // x = A·sin(ωt) → v = Aω·cos(ωt), a = −Aω²·sin(ωt). 처음·끝 몇 장면은 창이 한쪽으로 밀려 제외
  // (속도 창 5점 → 앞뒤 2장면, 가속도 창은 30 fps에서 7점 → 앞뒤 3장면)
  const A = 1, w = 2 * Math.PI * 0.5, fps = 30;
  const m = new Map<number, ROIData>();
  for (let f = 0; f < 60; f++) m.set(f, roiAt(300 + A * PPM * Math.sin(w * (f / fps)), 300));
  const out = analyzeMotion(m, fps, PPM, H);
  for (const d of out.filter((d) => d.frame >= 2 && d.frame <= 57)) {
    close(d.vx, A * w * Math.cos(w * d.time), `vx(${d.frame})`, 0.01 * A * w);
  }
  for (const d of out.filter((d) => d.frame >= 3 && d.frame <= 56)) {
    close(d.ax, -A * w * w * Math.sin(w * d.time), `ax(${d.frame})`, 0.01 * A * w * w);
  }
});

test('가속도 창: 10 fps 이하는 5점, 장면이 촘촘하면 약 0.2초를 덮도록 늘린다', () => {
  assert.equal(accelFitPoints(10), 5);
  assert.equal(accelFitPoints(30), 7);
  assert.equal(accelFitPoints(60), 13);
  assert.equal(accelFitPoints(120), 25);
});

test('60 fps에서 ±0.5 px 추적 잡음이 있어도 장면마다 가속도가 이론값 근처에 머문다', () => {
  // 실제 영상의 추적 흔들림은 0.5 px 안팎이다. 5점으로 두 번 미분하면 이것만으로도
  // 가속도가 장면마다 수 m/s²씩 튀어 그래프가 잡음이 된다.
  const fps = 60;
  const m = new Map<number, ROIData>();
  for (let f = 0; f < 60; f++) {
    const t = f / fps;
    const cy = 100 + 0.5 * G * PPM * t * t;              // 떨어지는 공 (화면 아래로)
    const noise = (((f * 7919) % 11) / 5 - 1) / 2;       // -0.5 ~ +0.5 px
    m.set(f, roiAt(300, cy + noise));
  }
  const out = analyzeMotion(m, fps, PPM, H).filter((d) => d.accelValid);
  assert.equal(out.length, 48);
  for (const d of out) {
    assert.ok(Math.abs(d.ay - -G) < 2.5, `ay(${d.frame}) = ${d.ay.toFixed(2)}, 기대 ${-G} ± 2.5`);
  }
});

test('가속도는 앞뒤를 고루 갖춘 창이 들어가는 장면만 유효(처음·끝은 같은 창을 나눠 써 평평해지므로)', () => {
  const valid = (frames: number[], fps: number) =>
    analyzeMotion(buildThrownAt(frames, fps), fps, PPM, H).filter((d) => d.accelValid).map((d) => d.frame);
  const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, k) => a + k);
  // 10 fps: 창 5점 → 처음·끝 2장면 제외
  assert.deepEqual(valid(range(0, 8), 10), range(2, 6));
  // 60 fps: 창 13점 → 처음·끝 6장면(0.1초) 제외
  assert.deepEqual(valid(range(0, 59), 60), range(6, 53));
  // 점이 3개면 가운데만, 2개면 없음
  assert.deepEqual(valid([0, 1, 2], 10), [1]);
  assert.deepEqual(valid([0, 3], 10), []);
  // 유효한 장면끼리는 같은 창을 쓰지 않는다: 이웃한 두 장면의 가속도가 정확히 같으면 안 된다
  const m = new Map<number, ROIData>();
  for (let f = 0; f < 60; f++) {
    const t = f / 60;
    m.set(f, roiAt(300, 100 + 0.5 * G * PPM * t * t + (((f * 7919) % 11) / 5 - 1) / 2));
  }
  const ok = analyzeMotion(m, 60, PPM, H).filter((d) => d.accelValid);
  for (let k = 1; k < ok.length; k++) assert.notEqual(ok[k].ay, ok[k - 1].ay, `장면 ${ok[k].frame}`);
});

test('60 fps에서도 등가속도는 모든 장면(처음·끝 포함)에서 정확하다', () => {
  const fps = 60;
  const m = new Map<number, ROIData>();
  for (let f = 0; f < 40; f++) {
    const p = thrown(f / fps);
    m.set(f, roiAt(p.cx, p.cy));
  }
  for (const d of analyzeMotion(m, fps, PPM, H)) {
    close(d.ay, -G, `ay(${d.frame})`, 1e-4);
    close(d.vy, VY0 - G * d.time, `vy(${d.frame})`, 1e-4);
  }
});

test('잡음이 섞여도 가속도 평균은 이론값 근처 (5점 맞춤)', () => {
  // 결정적 잡음 ±1px
  const m = new Map<number, ROIData>();
  for (let f = 0; f < 30; f++) {
    const t = f / 30;
    const cy = 100 + 0.5 * G * PPM * t * t;          // 떨어지는 공 (화면 아래로)
    const noise = ((f * 7919) % 11) / 5 - 1;          // -1 ~ +1 px
    m.set(f, roiAt(300, cy + noise));
  }
  const out = analyzeMotion(m, 30, PPM, H);
  const mean = out.reduce((s, d) => s + d.ay, 0) / out.length;
  assert.ok(Math.abs(mean - -G) < 1.0, `평균 ay = ${mean}, 기대 ${-G}`);
});
