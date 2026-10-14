// 장면 추출 탐색 시각이 영상 장면 경계에 걸리지 않는지 확인한다.
// 경계에 걸리면 앞/뒤 장면 중 어느 것이 잡힐지 반올림에 달려 장면 간격이 들쭉날쭉해진다.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sampleTime } from '../src/utils/frameTiming.ts';

// 휴대폰·카메라 영상에 흔한 FPS와, 앱에서 고를 수 있는 추출 FPS(버튼 + 흔한 직접 입력값)
const VIDEO_FPS = [24, 25, 30, 48, 50, 60, 120, 240];
const EXTRACT_FPS = [1, 2, 5, 6, 10, 12, 15, 20, 24, 25, 30, 40, 48, 50, 60];

// 아이폰은 장면 시각을 ms 단위로 반올림해 보고한다(최대 0.5 ms 어긋남) → 경계에서 0.5 ms보다 멀어야 한다
const MIN_GAP_S = 0.00055;

test('영상 FPS가 추출 FPS의 정수배이면, 탐색 시각이 항상 장면 경계에서 0.5 ms보다 멀다', () => {
  for (const F of VIDEO_FPS) {
    for (const f of EXTRACT_FPS) {
      if (F % f !== 0) continue; // 정수배가 아니면 장면이 원래 고르게 있지 않다
      for (let k = 0; k < 200; k++) {
        const t = sampleTime(k, f);
        const pos = t * F;                        // 영상 장면 단위 위치
        const gap = Math.min(pos - Math.floor(pos), Math.ceil(pos) - pos) / F;
        assert.ok(gap >= MIN_GAP_S, `영상 ${F} fps, 추출 ${f} fps, k=${k}: 경계까지 ${(gap * 1000).toFixed(2)} ms`);
      }
    }
  }
});

test('정수배이면 뽑힌 영상 장면 번호의 간격이 모두 같다 (F/f 장씩)', () => {
  for (const F of VIDEO_FPS) {
    for (const f of EXTRACT_FPS) {
      if (F % f !== 0) continue;
      const picked = Array.from({ length: 100 }, (_, k) => Math.floor(sampleTime(k, f) * F + 1e-9));
      for (let k = 1; k < picked.length; k++) {
        assert.equal(picked[k] - picked[k - 1], F / f, `영상 ${F}, 추출 ${f}, k=${k}`);
      }
    }
  }
});

test('탐색 시각은 그 장면 구간 [k/f, (k+1)/f) 안에 있다', () => {
  for (const f of EXTRACT_FPS) {
    for (let k = 0; k < 50; k++) {
      const t = sampleTime(k, f);
      assert.ok(t >= k / f && t < (k + 1) / f, `추출 ${f}, k=${k}: ${t}`);
    }
  }
});
