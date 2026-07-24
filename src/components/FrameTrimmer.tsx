import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Scissors, RotateCcw } from 'lucide-react';
import { ExtractedFrame } from '@/hooks/useVideoFrame';

interface FrameTrimmerProps {
  frames: ExtractedFrame[];
  fps: number;
  currentFrameIndex: number;
  onSeek: (index: number) => void;
  onApply: (startIndex: number, endIndex: number) => void;
  onSkip: () => void;
}

const FILMSTRIP_HEIGHT = 56;
const MAX_THUMBNAILS = 40;

// 프레임 추출 직후, 영상 편집기처럼 좌/우 핸들을 끌어서 앞뒤 불필요한 구간을 잘라내는 UI.
// 실제로 프레임 배열을 자르는 시점(cropFrames 호출)은 부모(Index.tsx)의 "구간 적용" 클릭 때이며,
// 여기서는 선택 구간([start, end])만 로컬 상태로 관리한다.
export const FrameTrimmer = ({ frames, fps, currentFrameIndex, onSeek, onApply, onSkip }: FrameTrimmerProps) => {
  const lastIndex = Math.max(0, frames.length - 1);
  const [range, setRange] = useState<[number, number]>([0, lastIndex]);
  const filmstripRef = useRef<HTMLCanvasElement>(null);
  const startPreviewRef = useRef<HTMLCanvasElement>(null);
  const endPreviewRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const [start, end] = range;
  const selectedCount = end - start + 1;
  const selectedSeconds = selectedCount / fps;
  const totalSeconds = frames.length / fps;

  // 필름스트립: 프레임이 많을 때(수백 개) 전부 그리면 느리므로, 균등 간격으로 최대
  // MAX_THUMBNAILS 장만 샘플링해 하나의 캔버스에 이어 붙여 그린다.
  useEffect(() => {
    const canvas = filmstripRef.current;
    if (!canvas || frames.length === 0) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const width = canvas.clientWidth || canvas.width;
    canvas.width = width;
    canvas.height = FILMSTRIP_HEIGHT;

    const n = Math.min(MAX_THUMBNAILS, frames.length);
    const slotW = width / n;

    ctx.clearRect(0, 0, width, FILMSTRIP_HEIGHT);
    for (let i = 0; i < n; i++) {
      const frameIdx = Math.min(frames.length - 1, Math.round((i * (frames.length - 1)) / Math.max(1, n - 1)));
      const src = frames[frameIdx].canvas;
      const srcAspect = src.width / src.height;
      let drawW = slotW;
      let drawH = FILMSTRIP_HEIGHT;
      if (srcAspect > slotW / FILMSTRIP_HEIGHT) {
        drawH = slotW / srcAspect;
      } else {
        drawW = FILMSTRIP_HEIGHT * srcAspect;
      }
      const dx = i * slotW + (slotW - drawW) / 2;
      const dy = (FILMSTRIP_HEIGHT - drawH) / 2;
      ctx.drawImage(src, dx, dy, drawW, drawH);
    }
  }, [frames]);

  // 시작/끝 프레임 미리보기
  const drawPreview = useCallback((canvasEl: HTMLCanvasElement | null, frameIdx: number) => {
    if (!canvasEl || !frames[frameIdx]) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    const src = frames[frameIdx].canvas;
    canvasEl.width = src.width;
    canvasEl.height = src.height;
    ctx.drawImage(src, 0, 0);
  }, [frames]);

  useEffect(() => drawPreview(startPreviewRef.current, start), [drawPreview, start]);
  useEffect(() => drawPreview(endPreviewRef.current, end), [drawPreview, end]);

  const handleRangeChange = (v: number[]) => {
    const s = Math.min(v[0], v[1]);
    const e = Math.max(v[0], v[1]);
    setRange([s, e]);
  };

  const setStartToCurrent = () => {
    setRange(([, e]) => [Math.min(currentFrameIndex, e), e]);
  };

  const setEndToCurrent = () => {
    setRange(([s]) => [s, Math.max(currentFrameIndex, s)]);
  };

  const handleFilmstripClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!containerRef.current || frames.length === 0) return;
    const rect = containerRef.current.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    const idx = Math.round(ratio * lastIndex);
    onSeek(idx);
  };

  const resetRange = () => setRange([0, lastIndex]);

  const startPct = frames.length > 0 ? (start / frames.length) * 100 : 0;
  const endPct = frames.length > 0 ? ((end + 1) / frames.length) * 100 : 100;

  if (frames.length === 0) return null;

  return (
    <div className="space-y-3 pt-3 border-t border-border">
      <div className="flex items-center justify-between">
        <p className="text-sm font-medium flex items-center gap-1.5">
          <Scissors className="w-3.5 h-3.5" />
          영상 구간 자르기
        </p>
        <button
          onClick={resetRange}
          className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
        >
          <RotateCcw className="w-3 h-3" />
          전체로 초기화
        </button>
      </div>
      <p className="text-xs text-muted-foreground">
        핸들을 끌어 분석에 사용할 구간만 남겨주세요 (앞뒤 불필요한 장면 제거)
      </p>

      <div ref={containerRef} className="relative" onClick={handleFilmstripClick}>
        <canvas
          ref={filmstripRef}
          className="w-full rounded border border-border cursor-pointer"
          style={{ height: FILMSTRIP_HEIGHT }}
        />
        {/* 잘려나갈 구간을 어둡게 표시 */}
        <div
          className="absolute top-0 bottom-0 left-0 bg-black/60 rounded-l pointer-events-none"
          style={{ width: `${startPct}%` }}
        />
        <div
          className="absolute top-0 bottom-0 right-0 bg-black/60 rounded-r pointer-events-none"
          style={{ width: `${100 - endPct}%` }}
        />
      </div>

      <Slider
        min={0}
        max={lastIndex}
        step={1}
        value={range}
        onValueChange={handleRangeChange}
      />

      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <canvas ref={startPreviewRef} className="w-full rounded border border-border bg-black" />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">시작: #{start + 1}</p>
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={setStartToCurrent}>
              현재 장면으로
            </Button>
          </div>
        </div>
        <div className="space-y-1">
          <canvas ref={endPreviewRef} className="w-full rounded border border-border bg-black" />
          <div className="flex items-center justify-between">
            <p className="text-xs text-muted-foreground">끝: #{end + 1}</p>
            <Button size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={setEndToCurrent}>
              현재 장면으로
            </Button>
          </div>
        </div>
      </div>

      <p className="text-xs text-muted-foreground">
        선택 구간: {selectedCount}개 장면 ({selectedSeconds.toFixed(1)}s / 전체 {totalSeconds.toFixed(1)}s)
      </p>

      <div className="flex gap-2">
        <Button
          onClick={onSkip}
          variant="outline"
          className="flex-1"
        >
          자르지 않고 계속
        </Button>
        <Button
          onClick={() => onApply(start, end)}
          disabled={start === 0 && end === lastIndex}
          className="flex-1 bg-gradient-primary hover:opacity-90"
        >
          <Scissors className="w-4 h-4 mr-2" />
          적용하고 계속
        </Button>
      </div>
    </div>
  );
};
