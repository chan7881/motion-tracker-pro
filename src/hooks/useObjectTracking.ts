import { useState, useCallback } from 'react';
import * as ort from 'onnxruntime-web';

export interface TrackedROI {
  x: number;
  y: number;
  w: number;
  h: number;
  confidence: number;
}

export const useObjectTracking = () => {
  const [isTracking, setIsTracking] = useState(false);
  const [session, setSession] = useState<ort.InferenceSession | null>(null);
  const [progress, setProgress] = useState(0);

  const loadModel = useCallback(async () => {
    try {
      // Configure WASM paths for onnxruntime-web
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/';
      
      const modelSession = await ort.InferenceSession.create('/yolov8n.onnx', {
        executionProviders: ['wasm'],
      });
      setSession(modelSession);
      return modelSession;
    } catch (error) {
      console.error('Failed to load YOLO model:', error);
      throw error;
    }
  }, []);

  const detectObject = useCallback(async (
    imageData: ImageData,
    targetROI: { x: number; y: number; w: number; h: number }
  ): Promise<TrackedROI | null> => {
    if (!session) {
      const newSession = await loadModel();
      if (!newSession) return null;
    }

    try {
      // Preprocess image for YOLO (640x640, normalized)
      const inputTensor = preprocessImage(imageData, targetROI);
      
      // Run inference
      const feeds = { images: inputTensor };
      const results = await session!.run(feeds);
      
      // Post-process results to find best matching detection near target ROI
      const detection = postprocessResults(results, targetROI, imageData.width, imageData.height);
      
      return detection;
    } catch (error) {
      console.error('Detection error:', error);
      return null;
    }
  }, [session, loadModel]);

  const trackObjectAcrossFrames = useCallback(async (
    frames: string[],
    initialROI: { x: number; y: number; w: number; h: number },
    startFrameIndex: number,
    onProgress: (current: number, total: number) => void
  ): Promise<Map<number, TrackedROI>> => {
    setIsTracking(true);
    setProgress(0);
    
    const trackedROIs = new Map<number, TrackedROI>();
    let currentROI = initialROI;

    try {
      // Ensure model is loaded
      if (!session) {
        await loadModel();
      }

      // Track forward from start frame
      for (let i = startFrameIndex; i < frames.length; i++) {
        const imageData = await loadImageData(frames[i]);
        const detection = await detectObject(imageData, currentROI);
        
        if (detection) {
          trackedROIs.set(i, detection);
          currentROI = detection; // Update search region for next frame
        } else {
          // If detection fails, keep previous ROI
          trackedROIs.set(i, { ...currentROI, confidence: 0 });
        }
        
        onProgress(i + 1, frames.length);
        setProgress(Math.round(((i + 1) / frames.length) * 100));
      }

      // Track backward from start frame
      currentROI = initialROI;
      for (let i = startFrameIndex - 1; i >= 0; i--) {
        const imageData = await loadImageData(frames[i]);
        const detection = await detectObject(imageData, currentROI);
        
        if (detection) {
          trackedROIs.set(i, detection);
          currentROI = detection;
        } else {
          trackedROIs.set(i, { ...currentROI, confidence: 0 });
        }
        
        onProgress(frames.length - i, frames.length);
      }

      return trackedROIs;
    } finally {
      setIsTracking(false);
      setProgress(0);
    }
  }, [session, loadModel, detectObject]);

  return {
    isTracking,
    progress,
    trackObjectAcrossFrames,
    loadModel
  };
};

// Helper functions
function preprocessImage(
  imageData: ImageData,
  roi: { x: number; y: number; w: number; h: number }
): ort.Tensor {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  
  // Extract ROI region with some padding
  const padding = 50;
  const x = Math.max(0, roi.x - padding);
  const y = Math.max(0, roi.y - padding);
  const w = Math.min(imageData.width - x, roi.w + padding * 2);
  const h = Math.min(imageData.height - y, roi.h + padding * 2);
  
  canvas.width = 640;
  canvas.height = 640;
  
  // Draw and resize ROI region
  const tempCanvas = document.createElement('canvas');
  tempCanvas.width = w;
  tempCanvas.height = h;
  const tempCtx = tempCanvas.getContext('2d')!;
  tempCtx.putImageData(imageData, -x, -y, x, y, w, h);
  
  ctx.drawImage(tempCanvas, 0, 0, 640, 640);
  
  const resizedData = ctx.getImageData(0, 0, 640, 640);
  
  // Convert to float32 tensor [1, 3, 640, 640] normalized
  const float32Data = new Float32Array(3 * 640 * 640);
  
  for (let i = 0; i < 640 * 640; i++) {
    float32Data[i] = resizedData.data[i * 4] / 255.0; // R
    float32Data[640 * 640 + i] = resizedData.data[i * 4 + 1] / 255.0; // G
    float32Data[640 * 640 * 2 + i] = resizedData.data[i * 4 + 2] / 255.0; // B
  }
  
  return new ort.Tensor('float32', float32Data, [1, 3, 640, 640]);
}

function postprocessResults(
  results: any,
  targetROI: { x: number; y: number; w: number; h: number },
  originalWidth: number,
  originalHeight: number
): TrackedROI | null {
  // YOLOv8 output format: [1, 84, 8400] - 8400 proposals with 84 values each
  // First 4 are bbox coords, rest are class scores
  const output = results[Object.keys(results)[0]];
  const data = output.data;
  
  let bestDetection: TrackedROI | null = null;
  let bestScore = 0;
  
  const targetCenterX = targetROI.x + targetROI.w / 2;
  const targetCenterY = targetROI.y + targetROI.h / 2;
  
  // Process detections
  for (let i = 0; i < 8400; i++) {
    const offset = i;
    const x = data[offset];
    const y = data[8400 + offset];
    const w = data[16800 + offset];
    const h = data[25200 + offset];
    
    // Get max class score
    let maxScore = 0;
    for (let c = 4; c < 84; c++) {
      const score = data[c * 8400 + offset];
      if (score > maxScore) maxScore = score;
    }
    
    if (maxScore > 0.25) {
      // Calculate distance from target ROI center
      const detCenterX = x * originalWidth / 640;
      const detCenterY = y * originalHeight / 640;
      const distance = Math.sqrt(
        Math.pow(detCenterX - targetCenterX, 2) + 
        Math.pow(detCenterY - targetCenterY, 2)
      );
      
      // Prefer detections close to target with high confidence
      const score = maxScore / (1 + distance / 100);
      
      if (score > bestScore) {
        bestScore = score;
        bestDetection = {
          x: (x - w / 2) * originalWidth / 640,
          y: (y - h / 2) * originalHeight / 640,
          w: w * originalWidth / 640,
          h: h * originalHeight / 640,
          confidence: maxScore
        };
      }
    }
  }
  
  return bestDetection;
}

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
