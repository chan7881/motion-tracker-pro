import { useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
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

// 추적 신뢰도에 따른 표시 색상 (초록: 높음, 노랑: 보통, 빨강: 낮음/실패)
export function confidenceColor(confidence: number | undefined): string {
      if (confidence === undefined) return '#06b6d4'; // 사용자가 직접 지정한 ROI (기본 청록색)
  if (confidence >= 0.7) return '#22c55e';
      if (confidence >= 0.3) return '#eab308';
      return '#ef4444';
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

                                                                             useImperativeHandle(ref, () => ({
                                                                                     getVideoElement: () => videoRef.current,
                                                                                     getCanvasElement: () => canvasRef.current
                                                                             }));

                                                                             // Draw current frame or video
                                                                             useEffect(() => {
                                                                                     if (!canvasRef.current) return;

                                                                                           const canvas = canvasRef.current;
                                                                                     const ctx = canvas.getContext('2d');
                                                                                     if (!ctx) return;

                                                                                           const draw = () => {
                                                                                                     // Clear canvas
                                                                                                     ctx.clearRect(0, 0, canvas.width, canvas.height);

                                                                                                     // Draw video or frame
                                                                                                     if (currentFrame) {
                                                                                                                 // Draw extracted frame
                                                                                                       ctx.drawImage(currentFrame.canvas, 0, 0, canvas.width, canvas.height);
                                                                                                         } else if (videoRef.current && showVideo && videoUrl) {
                                                                                                                 // Draw video
                                                                                                       if (videoRef.current.readyState >= 2) {
                                                                                                                     ctx.drawImage(videoRef.current, 0, 0, canvas.width, canvas.height);
                                                                                                           }
                                                                                                         }

                                                                                                     // Draw motion trail (지금까지 추적된 물체의 이동 경로)
                                                                                                     if (trail && trail.length > 1) {
                                                                                                                 for (let i = 1; i < trail.length; i++) {
                                                                                                                               const prev = trail[i - 1];
                                                                                                                               const curr = trail[i];
                                                                                                                               ctx.strokeStyle = confidenceColor(curr.confidence);
                                                                                                                               ctx.lineWidth = 2;
                                                                                                                               ctx.beginPath();
                                                                                                                               ctx.moveTo(prev.x, prev.y);
                                                                                                                               ctx.lineTo(curr.x, curr.y);
                                                                                                                               ctx.stroke();
                                                                                                                     }
                                                                                                                 for (const point of trail) {
                                                                                                                               ctx.fillStyle = confidenceColor(point.confidence);
                                                                                                                               ctx.beginPath();
                                                                                                                               ctx.arc(point.x, point.y, 3, 0, 2 * Math.PI);
                                                                                                                               ctx.fill();
                                                                                                                     }
                                                                                                         }

                                                                                                     // Draw ROI
                                                                                                     if (roi && roi.w > 0 && roi.h > 0) {
                                                                                                                 const color = confidenceColor(roiConfidence);
                                                                                                                 ctx.strokeStyle = color;
                                                                                                                 ctx.lineWidth = 3;
                                                                                                                 ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
                                                                                                         
                                                                                                       // Semi-transparent fill
                                                                                                       ctx.fillStyle = color + '1a';
                                                                                                                 ctx.fillRect(roi.x, roi.y, roi.w, roi.h);
                                                                                                         
                                                                                                       // Crosshair at center
                                                                                                       const centerX = roi.x + roi.w / 2;
                                                                                                                 const centerY = roi.y + roi.h / 2;
                                                                                                                 ctx.strokeStyle = color;
                                                                                                                 ctx.lineWidth = 2;
                                                                                                                 ctx.beginPath();
                                                                                                                 ctx.moveTo(centerX - 10, centerY);
                                                                                                                 ctx.lineTo(centerX + 10, centerY);
                                                                                                                 ctx.moveTo(centerX, centerY - 10);
                                                                                                                 ctx.lineTo(centerX, centerY + 10);
                                                                                                                 ctx.stroke();
                                                                                                         }

                                                                                                     // Draw calibration line (실측 스케일 보정용 기준선)
                                                                                                     if (calibrationLine) {
                                                                                                                 ctx.strokeStyle = '#f97316';
                                                                                                                 ctx.lineWidth = 3;
                                                                                                                 ctx.beginPath();
                                                                                                                 ctx.moveTo(calibrationLine.x1, calibrationLine.y1);
                                                                                                                 ctx.lineTo(calibrationLine.x2, calibrationLine.y2);
                                                                                                                 ctx.stroke();
                                                                                                         
                                                                                                       // 양 끝점 표시
                                                                                                       for (const p of [{ x: calibrationLine.x1, y: calibrationLine.y1 }, { x: calibrationLine.x2, y: calibrationLine.y2 }]) {
                                                                                                                     ctx.fillStyle = '#f97316';
                                                                                                                     ctx.beginPath();
                                                                                                                     ctx.arc(p.x, p.y, 5, 0, 2 * Math.PI);
                                                                                                                     ctx.fill();
                                                                                                           }
                                                                                                         
                                                                                                       if (calibrationLabel) {
                                                                                                                     const midX = (calibrationLine.x1 + calibrationLine.x2) / 2;
                                                                                                                     const midY = (calibrationLine.y1 + calibrationLine.y2) / 2;
                                                                                                                     ctx.font = 'bold 16px sans-serif';
                                                                                                                     ctx.fillStyle = '#f97316';
                                                                                                                     ctx.fillText(calibrationLabel, midX + 8, midY - 8);
                                                                                                           }
                                                                                                         }
                                                                                           };

                                                                                           draw();

                                                                                           // Redraw on video play
                                                                                           let animationId: number;
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

                                                                             // Set canvas size when video loads
                                                                             useEffect(() => {
                                                                                     const video = videoRef.current;
                                                                                     if (!video || !canvasRef.current) return;

                                                                                           const handleLoadedMetadata = () => {
                                                                                                     const canvas = canvasRef.current;
                                                                                                     if (!canvas) return;

                                                                                                     canvas.width = video.videoWidth || 640;
                                                                                                     canvas.height = video.videoHeight || 480;
                                                                                           };

                                                                                           video.addEventListener('loadedmetadata', handleLoadedMetadata);

                                                                                           if (video.readyState >= 1) {
                                                                                                     handleLoadedMetadata();
                                                                                           }

                                                                                           return () => {
                                                                                                     video.removeEventListener('loadedmetadata', handleLoadedMetadata);
                                                                                           };
                                                                             }, [videoUrl]);

                                                                             return (
                                                                                     <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
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
