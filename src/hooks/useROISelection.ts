import { useState, useCallback, useRef } from 'react';
import { clientToCanvas } from '@/utils/canvasCoords';

export interface ROI {
  x: number;
  y: number;
  w: number;
  h: number;
}

// 이보다 짧게 끌면 "톡 누름"으로 본다 (캔버스 픽셀)
const TAP_MAX_DRAG = 6;
// 톡 누르면 그 점을 가운데로 한 정사각형 네모를 만든다. 크기는 화면 짧은 변의 10%.
// 폰 화면에서 구슬처럼 작은 물체는 손가락으로 둘레를 끌기 어렵다.
const TAP_BOX_FRACTION = 0.1;

export const useROISelection = (
  canvasRef: React.RefObject<HTMLCanvasElement>,
  // 네모를 다 그렸을 때(손을 뗐을 때) 한 번 불린다. 넘기면 그린 네모는 바로 비운다
  // (저장된 네모로 표시가 넘어가므로).
  onComplete?: (roi: ROI) => void
) => {
  const [roi, setRoi] = useState<ROI | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const startPoint = useRef<{ x: number; y: number } | null>(null);
  const roiRef = useRef<ROI | null>(null);
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  const updateRoi = useCallback((next: ROI | null) => {
    roiRef.current = next;
    setRoi(next);
  }, []);

  const getCanvasCoordinates = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return null;

    let clientX: number, clientY: number;

    if ('touches' in e) {
      if (e.touches.length === 0) return null;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }

    return clientToCanvas(canvasRef.current, clientX, clientY);
  }, [canvasRef]);

  const handlePointerDown = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    e.preventDefault();
    const coords = getCanvasCoordinates(e);
    if (coords) {
      setIsDrawing(true);
      startPoint.current = coords;
      updateRoi(null);
    }
  }, [getCanvasCoordinates, updateRoi]);

  const handlePointerMove = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint.current) return;

    e.preventDefault();
    const coords = getCanvasCoordinates(e);
    if (!coords) return;

    const x = Math.min(startPoint.current.x, coords.x);
    const y = Math.min(startPoint.current.y, coords.y);
    const w = Math.abs(coords.x - startPoint.current.x);
    const h = Math.abs(coords.y - startPoint.current.y);

    updateRoi({ x, y, w, h });
  }, [isDrawing, getCanvasCoordinates, updateRoi]);

  const handlePointerUp = useCallback(() => {
    if (!isDrawing) return;
    setIsDrawing(false);

    let final = roiRef.current;
    const start = startPoint.current;
    const canvas = canvasRef.current;
    startPoint.current = null;

    // 거의 끌지 않았으면 누른 점을 가운데로 한 네모를 만든다
    if (start && canvas && (!final || (final.w < TAP_MAX_DRAG && final.h < TAP_MAX_DRAG))) {
      const size = Math.round(Math.min(canvas.width, canvas.height) * TAP_BOX_FRACTION);
      final = {
        x: Math.min(Math.max(0, start.x - size / 2), canvas.width - size),
        y: Math.min(Math.max(0, start.y - size / 2), canvas.height - size),
        w: size,
        h: size
      };
    }

    if (!final) return;
    if (onCompleteRef.current) {
      onCompleteRef.current(final);
      updateRoi(null);
    } else {
      updateRoi(final);
    }
  }, [isDrawing, canvasRef, updateRoi]);

  const clearROI = useCallback(() => {
    updateRoi(null);
    setIsDrawing(false);
    startPoint.current = null;
  }, [updateRoi]);

  return {
    roi,
    isDrawing,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    clearROI
  };
};
