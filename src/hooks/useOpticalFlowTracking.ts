import { useState, useCallback } from 'react';
import jsfeat from 'jsfeat';

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

export const useOpticalFlowTracking = () => {
  const [isTracking, setIsTracking] = useState(false);
  const [progress, setProgress] = useState(0);

  // Lucas-Kanade Optical Flow를 사용한 특징점 추적
  const trackObjectAcrossFrames = useCallback(async (
    frames: string[],
    initialROI: { x: number; y: number; w: number; h: number },
    startFrameIndex: number,
    onProgress: (current: number, total: number) => void
  ): Promise<Map<number, TrackedROI>> => {
    setIsTracking(true);
    setProgress(0);
    
    const trackedROIs = new Map<number, TrackedROI>();

    try {
      // 초기 프레임에서 특징점 추출
      const startFrame = await loadImageData(frames[startFrameIndex]);
      const initialPoints = detectKeyPoints(startFrame, initialROI);
      
      if (initialPoints.length === 0) {
        throw new Error('초기 ROI에서 특징점을 찾을 수 없습니다.');
      }

      // 초기 ROI 저장
      trackedROIs.set(startFrameIndex, {
        ...initialROI,
        confidence: 1.0
      });

      // Forward tracking (시작 프레임부터 끝까지)
      let prevFrame = startFrame;
      let prevPoints = initialPoints;
      
      for (let i = startFrameIndex + 1; i < frames.length; i++) {
        const currFrame = await loadImageData(frames[i]);
        
        // Optical Flow로 특징점 추적
        const trackedPoints = trackPoints(prevFrame, currFrame, prevPoints);
        
        if (trackedPoints.length > 0) {
          const roi = calculateROIFromPoints(trackedPoints, initialROI.w, initialROI.h);
          const confidence = trackedPoints.length / initialPoints.length;
          
          trackedROIs.set(i, {
            ...roi,
            confidence: Math.min(confidence, 1.0)
          });
          
          prevFrame = currFrame;
          prevPoints = trackedPoints;
        } else {
          // 추적 실패 시 이전 ROI 사용
          const prevROI = trackedROIs.get(i - 1)!;
          trackedROIs.set(i, {
            ...prevROI,
            confidence: 0
          });
        }
        
        onProgress(i - startFrameIndex + 1, frames.length);
        setProgress(Math.round(((i - startFrameIndex + 1) / frames.length) * 50));
      }

      // Backward tracking (시작 프레임부터 처음까지)
      prevFrame = startFrame;
      prevPoints = initialPoints;
      
      for (let i = startFrameIndex - 1; i >= 0; i--) {
        const currFrame = await loadImageData(frames[i]);
        
        // Optical Flow로 특징점 추적 (역방향)
        const trackedPoints = trackPoints(prevFrame, currFrame, prevPoints);
        
        if (trackedPoints.length > 0) {
          const roi = calculateROIFromPoints(trackedPoints, initialROI.w, initialROI.h);
          const confidence = trackedPoints.length / initialPoints.length;
          
          trackedROIs.set(i, {
            ...roi,
            confidence: Math.min(confidence, 1.0)
          });
          
          prevFrame = currFrame;
          prevPoints = trackedPoints;
        } else {
          const nextROI = trackedROIs.get(i + 1)!;
          trackedROIs.set(i, {
            ...nextROI,
            confidence: 0
          });
        }
        
        onProgress(startFrameIndex - i, frames.length);
        setProgress(50 + Math.round(((startFrameIndex - i) / frames.length) * 50));
      }

      return trackedROIs;
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

// ROI 내부에서 Good Features to Track (Shi-Tomasi) 코너 감지
function detectKeyPoints(
  imageData: ImageData,
  roi: { x: number; y: number; w: number; h: number }
): Point[] {
  const { width, height, data } = imageData;
  
  // Grayscale 변환
  const gray = new jsfeat.matrix_t(width, height, jsfeat.U8_t | jsfeat.C1_t);
  jsfeat.imgproc.grayscale(data, width, height, gray);
  
  // 코너 검출을 위한 설정
  const corners: jsfeat.keypoint_t[] = [];
  const maxCorners = 100; // ROI 내 최대 특징점 수
  
  // ROI 영역에서만 코너 검출
  const x = Math.max(0, Math.floor(roi.x));
  const y = Math.max(0, Math.floor(roi.y));
  const w = Math.min(width - x, Math.ceil(roi.w));
  const h = Math.min(height - y, Math.ceil(roi.h));
  
  // YAPE06 코너 검출기 사용
  jsfeat.yape06.laplacian_threshold = 30;
  jsfeat.yape06.min_eigen_value_threshold = 25;
  
  jsfeat.yape06.detect(gray, corners, maxCorners);
  
  // ROI 내부의 코너만 필터링
  const points: Point[] = [];
  for (let i = 0; i < corners.length; i++) {
    const corner = corners[i];
    if (corner.x >= x && corner.x < x + w && 
        corner.y >= y && corner.y < y + h) {
      points.push({ x: corner.x, y: corner.y });
    }
  }
  
  return points;
}

// Lucas-Kanade Optical Flow로 특징점 추적
function trackPoints(
  prevImageData: ImageData,
  currImageData: ImageData,
  prevPoints: Point[]
): Point[] {
  const { width, height } = prevImageData;
  
  // Grayscale 변환
  const prevGray = new jsfeat.matrix_t(width, height, jsfeat.U8_t | jsfeat.C1_t);
  const currGray = new jsfeat.matrix_t(width, height, jsfeat.U8_t | jsfeat.C1_t);
  
  jsfeat.imgproc.grayscale(prevImageData.data, width, height, prevGray);
  jsfeat.imgproc.grayscale(currImageData.data, width, height, currGray);
  
  // 피라미드 생성 (멀티스케일 추적)
  const prevPyr = new jsfeat.pyramid_t(3);
  const currPyr = new jsfeat.pyramid_t(3);
  prevPyr.allocate(width, height, jsfeat.U8_t | jsfeat.C1_t);
  currPyr.allocate(width, height, jsfeat.U8_t | jsfeat.C1_t);
  
  prevPyr.build(prevGray, true);
  currPyr.build(currGray, true);
  
  // 특징점 배열 준비
  const pointCount = prevPoints.length;
  const prevXY = new Float32Array(pointCount * 2);
  const currXY = new Float32Array(pointCount * 2);
  const status = new Uint8Array(pointCount);
  
  for (let i = 0; i < pointCount; i++) {
    prevXY[i * 2] = prevPoints[i].x;
    prevXY[i * 2 + 1] = prevPoints[i].y;
  }
  
  // Lucas-Kanade Optical Flow 추적
  jsfeat.optical_flow_lk.track(
    prevPyr,
    currPyr,
    prevXY,
    currXY,
    pointCount,
    30, // window size
    30, // max iterations
    status,
    0.01, // epsilon
    0.001 // min eigen value
  );
  
  // 성공적으로 추적된 특징점만 반환
  const trackedPoints: Point[] = [];
  for (let i = 0; i < pointCount; i++) {
    if (status[i] === 1) {
      const x = currXY[i * 2];
      const y = currXY[i * 2 + 1];
      
      // 유효한 좌표인지 확인
      if (x >= 0 && x < width && y >= 0 && y < height) {
        trackedPoints.push({ x, y });
      }
    }
  }
  
  return trackedPoints;
}

// 추적된 특징점들로부터 ROI 계산
function calculateROIFromPoints(
  points: Point[],
  originalWidth: number,
  originalHeight: number
): { x: number; y: number; w: number; h: number } {
  if (points.length === 0) {
    return { x: 0, y: 0, w: originalWidth, h: originalHeight };
  }
  
  // 특징점들의 중심 계산
  let sumX = 0;
  let sumY = 0;
  
  for (const point of points) {
    sumX += point.x;
    sumY += point.y;
  }
  
  const centerX = sumX / points.length;
  const centerY = sumY / points.length;
  
  // ROI 중심을 특징점 중심으로 이동
  const x = Math.max(0, centerX - originalWidth / 2);
  const y = Math.max(0, centerY - originalHeight / 2);
  
  return {
    x,
    y,
    w: originalWidth,
    h: originalHeight
  };
}

// 이미지 데이터 로드 헬퍼 함수
async function loadImageData(dataUrl: string): Promise<ImageData> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0);
      resolve(ctx.getImageData(0, 0, img.width, img.height));
    };
    img.onerror = reject;
    img.src = dataUrl;
  });
}
