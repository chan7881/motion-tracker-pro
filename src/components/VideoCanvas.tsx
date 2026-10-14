import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from 'react';
import { Film } from 'lucide-react';
import { ROI } from '@/hooks/useROISelection';
import { CalibrationLine } from '@/hooks/useScaleCalibration';
import { ExtractedFrame } from '@/hooks/useVideoFrame';

export interface TrailPoint {
  x: number;
  y: number;
  confidence: number;
}

interface VideoCanvasProps {
  videoUrl: string | null;
  currentFrame: ExtractedFrame | null;
  roi: ROI | null;
  roiConfidence?: number;
  calibrationLine?: CalibrationLine | null;
  calibrationLabel?: string | null;
  trail?: TrailPoint[];
  onPointerDown?: (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => void;
  onPointerMove?: (e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => void;
  onPointerUp?: () => void;
  showVideo?: boolean;
}

export interface VideoCanvasHandle {
  getVideoElement: () => HTMLVideoElement | null;
  getCanvasElement: () => HTMLCanvasElement | null;
}

// 영상 위에 그리는 표시 색. 화면 테마와 상관없이 영상 위에서 잘 보이는 색으로 고정한다.
export const MANUAL_ROI_COLOR = '#3b82f6';   // 직접 지정한 네모
export const CALIBRATION_COLOR = '#f97316';  // 크기 보정 기준선

// 추적 신뢰도에 따른 표시 색상 (초록: 높음, 노랑: 보통, 빨강: 낮음/실패)
export function confidenceColor(confidence: number | undefined): string {
  if (confidence === undefined) return MANUAL_ROI_COLOR;
  if (confidence >= 0.7) return '#22c55e';
  if (confidence >= 0.3) return '#eab308';
  return '#ef4444';
}

// 색만으로 구분하지 않도록 네모 테두리 모양도 신뢰도에 따라 바꾼다
// (직접 지정·높음: 실선, 보통: 긴 점선, 낮음/실패: 짧은 점선)
export function confidenceDash(confidence: number | undefined): number[] {
  if (confidence === undefined || confidence >= 0.7) return [];
  if (confidence >= 0.3) return [8, 5];
  return [3, 4];
}

// 화면 틀은 영상의 가로세로 비율을 따른다. 고정 16:9 틀에 세로 영상을 넣으면 폭이 3분의 1로
// 줄어 작은 물체를 손가락으로 지정할 수 없다. 대신 높이는 화면의 60%까지로 묶어 아래 버튼이 보이게 한다.
const MAX_VIEW_HEIGHT_VH = 60;

export function frameBoxStyle(width: number, height: number): React.CSSProperties {
  const ratio = width > 0 && height > 0 ? width / height : 16 / 9;
  return {
    aspectRatio: `${width || 16} / ${height || 9}`,
    width: `min(100%, ${(MAX_VIEW_HEIGHT_VH * ratio).toFixed(2)}vh)`
  };
}

export const VideoCanvas = forwardRef<VideoCanvasHandle, VideoCanvasProps>(({
  videoUrl,
  currentFrame,
  roi,
  roiConfidence,
  calibrationLine,
  calibrationLabel,
  trail,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  showVideo = true
}, ref) => {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [videoSize, setVideoSize] = useState<{ w: number; h: number }>({ w: 16, h: 9 });

  useImperativeHandle(ref, () => ({
    getVideoElement: () => videoRef.current,
    getCanvasElement: () => canvasRef.current
  }));

  // 현재 장면(또는 영상)과 그 위의 표시(경로, 네모, 기준선)를 그린다
  useEffect(() => {
    if (!canvasRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const draw = () => {
      // 추출된 장면과 캔버스 크기를 맞춰야 네모·기준선 좌표가 추적에 쓰는 픽셀 좌표와 일치한다
      if (currentFrame && (canvas.width !== currentFrame.canvas.width || canvas.height !== currentFrame.canvas.height)) {
        canvas.width = currentFrame.canvas.width;
        canvas.height = currentFrame.canvas.height;
      }

      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (currentFrame) {
        ctx.drawImage(currentFrame.canvas, 0, 0, canvas.width, canvas.height);
      } else if (videoRef.current && showVideo && videoUrl && videoRef.current.readyState >= 2) {
        ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
      }

      // 지금까지 추적된 물체의 이동 경로
      if (trail && trail.length > 1) {
        ctx.lineWidth = 2;
        for (let i = 1; i < trail.length; i++) {
          ctx.strokeStyle = confidenceColor(trail[i].confidence);
          ctx.beginPath();
          ctx.moveTo(trail[i - 1].x, trail[i - 1].y);
          ctx.lineTo(trail[i].x, trail[i].y);
          ctx.stroke();
        }
        for (const point of trail) {
          ctx.fillStyle = confidenceColor(point.confidence);
          ctx.beginPath();
          ctx.arc(point.x, point.y, 3, 0, 2 * Math.PI);
          ctx.fill();
        }
      }

      if (roi && roi.w > 0 && roi.h > 0) {
        const color = confidenceColor(roiConfidence);
        ctx.strokeStyle = color;
        ctx.lineWidth = 3;
        ctx.setLineDash(confidenceDash(roiConfidence));
        ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
        ctx.setLineDash([]);

        ctx.fillStyle = color + '1a';
        ctx.fillRect(roi.x, roi.y, roi.w, roi.h);

        const centerX = roi.x + roi.w / 2;
        const centerY = roi.y + roi.h / 2;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(centerX - 10, centerY);
        ctx.lineTo(centerX + 10, centerY);
        ctx.moveTo(centerX, centerY - 10);
        ctx.lineTo(centerX, centerY + 10);
        ctx.stroke();
      }

      if (calibrationLine) {
        ctx.strokeStyle = CALIBRATION_COLOR;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(calibrationLine.x1, calibrationLine.y1);
        ctx.lineTo(calibrationLine.x2, calibrationLine.y2);
        ctx.stroke();

        ctx.fillStyle = CALIBRATION_COLOR;
        for (const p of [{ x: calibrationLine.x1, y: calibrationLine.y1 }, { x: calibrationLine.x2, y: calibrationLine.y2 }]) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
          ctx.fill();
        }

        if (calibrationLabel) {
          const midX = (calibrationLine.x1 + calibrationLine.x2) / 2;
          const midY = (calibrationLine.y1 + calibrationLine.y2) / 2;
          ctx.font = `bold ${Math.max(16, Math.round(canvas.height / 20))}px sans-serif`;
          ctx.fillText(calibrationLabel, midX + 8, midY - 8);
        }
      }
    };

    draw();

    // 영상을 재생하는 동안 계속 다시 그린다
    let animationId = 0;
    if (showVideo && !currentFrame && videoRef.current && videoUrl) {
      const animate = () => {
        draw();
        animationId = requestAnimationFrame(animate);
      };
      animate();
    }

    return () => {
      if (animationId) cancelAnimationFrame(animationId);
    };
  }, [currentFrame, roi, roiConfidence, calibrationLine, calibrationLabel, trail, showVideo, videoUrl]);

  // 영상 정보를 읽으면 캔버스 크기와 화면 틀 비율을 영상에 맞춘다
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !canvasRef.current) return;

    const handleLoadedMetadata = () => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      canvas.width = video.videoWidth || 640;
      canvas.height = video.videoHeight || 480;
      setVideoSize({ w: canvas.width, h: canvas.height });
    };

    video.addEventListener('loadedmetadata', handleLoadedMetadata);
    if (video.readyState >= 1) handleLoadedMetadata();

    return () => {
      video.removeEventListener('loadedmetadata', handleLoadedMetadata);
    };
  }, [videoUrl]);

  const boxSize = currentFrame
    ? { w: currentFrame.canvas.width, h: currentFrame.canvas.height }
    : videoSize;

  if (!videoUrl && !currentFrame) {
    return (
      <div className="w-full aspect-video rounded-lg border-2 border-dashed border-border bg-muted/50 flex flex-col items-center justify-center gap-2 text-muted-foreground">
        <Film className="w-8 h-8" aria-hidden="true" />
        <p className="text-sm">영상을 올리면 여기에 보여요</p>
      </div>
    );
  }

  return (
    <div className="relative mx-auto bg-black rounded-lg overflow-hidden" style={frameBoxStyle(boxSize.w, boxSize.h)}>
      {videoUrl && (
        <video
          ref={videoRef}
          src={videoUrl}
          className={`absolute inset-0 w-full h-full object-contain ${showVideo && !currentFrame ? 'block' : 'hidden'}`}
          playsInline
          muted
          controls={showVideo && !currentFrame}
        />
      )}
      <canvas
        ref={canvasRef}
        className="absolute inset-0 w-full h-full object-contain cursor-crosshair touch-none"
        onMouseDown={onPointerDown}
        onMouseMove={onPointerMove}
        onMouseUp={onPointerUp}
        onMouseLeave={onPointerUp}
        onTouchStart={onPointerDown}
        onTouchMove={onPointerMove}
        onTouchEnd={onPointerUp}
        width={640}
        height={480}
      />
    </div>
  );
});

VideoCanvas.displayName = 'VideoCanvas';
