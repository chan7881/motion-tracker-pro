import { useState, useCallback, useRef } from 'react';
import { clientToCanvas } from '@/utils/canvasCoords';

export interface CalibrationLine {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export const useScaleCalibration = (canvasRef: React.RefObject<HTMLCanvasElement>) => {
  const [line, setLine] = useState<CalibrationLine | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const startPoint = useRef<{ x: number; y: number } | null>(null);

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
      setLine({ x1: coords.x, y1: coords.y, x2: coords.x, y2: coords.y });
    }
  }, [getCanvasCoordinates]);

  const handlePointerMove = useCallback((e: React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPoint.current) return;

    e.preventDefault();
    const coords = getCanvasCoordinates(e);
    if (!coords) return;

    setLine({
      x1: startPoint.current.x,
      y1: startPoint.current.y,
      x2: coords.x,
      y2: coords.y
    });
  }, [isDrawing, getCanvasCoordinates]);

  const handlePointerUp = useCallback(() => {
    if (isDrawing) {
      setIsDrawing(false);
      startPoint.current = null;
    }
  }, [isDrawing]);

  const clearLine = useCallback(() => {
    setLine(null);
    setIsDrawing(false);
    startPoint.current = null;
  }, []);

  const pixelDistance = line
    ? Math.hypot(line.x2 - line.x1, line.y2 - line.y1)
    : 0;

  return {
    line,
    isDrawing,
    pixelDistance,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    clearLine
  };
};
