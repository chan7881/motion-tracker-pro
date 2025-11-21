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
  time: number;
}

export interface ROIData {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function analyzeMotion(
  frameROIs: Map<number, ROIData>,
  fps: number,
  pixelsPerMeter: number = 100 // Default: 100 pixels = 1 meter
): MotionData[] {
  const motionData: MotionData[] = [];
  const sortedFrames = Array.from(frameROIs.keys()).sort((a, b) => a - b);
  
  if (sortedFrames.length < 2) return motionData;
  
  const dt = 1 / fps; // Time between frames
  
  for (let i = 0; i < sortedFrames.length; i++) {
    const frameIndex = sortedFrames[i];
    const roi = frameROIs.get(frameIndex)!;
    
    // Center of ROI
    const x = (roi.x + roi.w / 2) / pixelsPerMeter;
    const y = (roi.y + roi.h / 2) / pixelsPerMeter;
    const time = frameIndex * dt;
    
    let vx = 0, vy = 0, speed = 0;
    let ax = 0, ay = 0, acceleration = 0;
    
    // Calculate velocity using central difference when possible
    if (i > 0 && i < sortedFrames.length - 1) {
      const prevFrame = sortedFrames[i - 1];
      const nextFrame = sortedFrames[i + 1];
      const prevROI = frameROIs.get(prevFrame)!;
      const nextROI = frameROIs.get(nextFrame)!;
      
      const x_prev = (prevROI.x + prevROI.w / 2) / pixelsPerMeter;
      const y_prev = (prevROI.y + prevROI.h / 2) / pixelsPerMeter;
      const x_next = (nextROI.x + nextROI.w / 2) / pixelsPerMeter;
      const y_next = (nextROI.y + nextROI.h / 2) / pixelsPerMeter;
      
      const dt_total = (nextFrame - prevFrame) * dt;
      vx = (x_next - x_prev) / dt_total;
      vy = (y_next - y_prev) / dt_total;
    } else if (i > 0) {
      // Forward difference for last frame
      const prevFrame = sortedFrames[i - 1];
      const prevROI = frameROIs.get(prevFrame)!;
      const x_prev = (prevROI.x + prevROI.w / 2) / pixelsPerMeter;
      const y_prev = (prevROI.y + prevROI.h / 2) / pixelsPerMeter;
      
      vx = (x - x_prev) / dt;
      vy = (y - y_prev) / dt;
    } else if (i < sortedFrames.length - 1) {
      // Backward difference for first frame
      const nextFrame = sortedFrames[i + 1];
      const nextROI = frameROIs.get(nextFrame)!;
      const x_next = (nextROI.x + nextROI.w / 2) / pixelsPerMeter;
      const y_next = (nextROI.y + nextROI.h / 2) / pixelsPerMeter;
      
      vx = (x_next - x) / dt;
      vy = (y_next - y) / dt;
    }
    
    speed = Math.sqrt(vx * vx + vy * vy);
    
    // Calculate acceleration
    if (i > 0) {
      const prevMotion = motionData[i - 1];
      ax = (vx - prevMotion.vx) / dt;
      ay = (vy - prevMotion.vy) / dt;
      acceleration = Math.sqrt(ax * ax + ay * ay);
    }
    
    motionData.push({
      frame: frameIndex,
      x,
      y,
      vx,
      vy,
      speed,
      ax,
      ay,
      acceleration,
      time
    });
  }
  
  return motionData;
}

export function smoothMotionData(data: MotionData[], windowSize: number = 3): MotionData[] {
  if (data.length < windowSize) return data;
  
  const smoothed: MotionData[] = [];
  const halfWindow = Math.floor(windowSize / 2);
  
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - halfWindow);
    const end = Math.min(data.length, i + halfWindow + 1);
    const window = data.slice(start, end);
    
    const avg = {
      frame: data[i].frame,
      time: data[i].time,
      x: window.reduce((sum, d) => sum + d.x, 0) / window.length,
      y: window.reduce((sum, d) => sum + d.y, 0) / window.length,
      vx: window.reduce((sum, d) => sum + d.vx, 0) / window.length,
      vy: window.reduce((sum, d) => sum + d.vy, 0) / window.length,
      speed: window.reduce((sum, d) => sum + d.speed, 0) / window.length,
      ax: window.reduce((sum, d) => sum + d.ax, 0) / window.length,
      ay: window.reduce((sum, d) => sum + d.ay, 0) / window.length,
      acceleration: window.reduce((sum, d) => sum + d.acceleration, 0) / window.length,
    };
    
    smoothed.push(avg);
  }
  
  return smoothed;
}
