import { useState, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { VideoCanvas, VideoCanvasHandle } from '@/components/VideoCanvas';
import { useVideoFrame } from '@/hooks/useVideoFrame';
import { useROISelection } from '@/hooks/useROISelection';
import { useObjectTracking } from '@/hooks/useObjectTracking';
import { useToast } from '@/hooks/use-toast';
import { analyzeMotion, smoothMotionData, MotionData } from '@/utils/motionAnalysis';
import { Upload, Camera, Play, ChevronLeft, ChevronRight, Target, BarChart3, CheckCircle, Download, Video } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

const Index = () => {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState('upload');
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [fps, setFps] = useState(10);
  const [frameROIs, setFrameROIs] = useState<Map<number, any>>(new Map());
  const [motionData, setMotionData] = useState<MotionData[]>([]);
  const [activeChart, setActiveChart] = useState<'position' | 'velocity' | 'acceleration'>('position');
  const [videoWithROI, setVideoWithROI] = useState<string | null>(null);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);
  
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoCanvasRef = useRef<VideoCanvasHandle>(null);
  
  const { extractedFrames, isExtracting, progress, extractFrames, reset } = useVideoFrame();
  const { isTracking, progress: trackingProgress, trackObjectAcrossFrames } = useObjectTracking();
  
  // Create a ref object that dynamically gets the canvas from VideoCanvas
  const canvasRefForROI = useRef<HTMLCanvasElement | null>(null);
  const canvasRefGetter = {
    get current() {
      return videoCanvasRef.current?.getCanvasElement() || null;
    }
  };
  
  const { roi, handlePointerDown, handlePointerMove, handlePointerUp, clearROI } = useROISelection(
    canvasRefGetter as React.RefObject<HTMLCanvasElement>
  );

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('video/')) {
      toast({
        title: "Invalid file type",
        description: "Please upload a video file",
        variant: "destructive"
      });
      return;
    }

    // Revoke previous URL
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }

    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    reset();
    setCurrentFrameIndex(0);
    setFrameROIs(new Map());
    setVideoWithROI(null);
    
    toast({
      title: "Video loaded",
      description: `${file.name} has been loaded successfully`
    });
    
    // Auto-advance to extract tab
    setCurrentTab('extract');
  }, [videoUrl, reset, toast]);

  const handleExtractFrames = useCallback(async () => {
    const videoElement = videoCanvasRef.current?.getVideoElement();
    if (!videoElement) {
      toast({
        title: "No video",
        description: "Please upload a video first",
        variant: "destructive"
      });
      return;
    }

    try {
      await extractFrames(videoElement, fps);
      toast({
        title: "Frames extracted",
        description: `Successfully extracted ${Math.floor(videoElement.duration * fps)} frames`
      });
      
      // Auto-advance to ROI selection tab
      setCurrentTab('roi');
    } catch (error) {
      toast({
        title: "Extraction failed",
        description: error instanceof Error ? error.message : "Failed to extract frames",
        variant: "destructive"
      });
    }
  }, [extractFrames, fps, toast]);

  const handleStartCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        video: { 
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        } 
      });
      
      // Revoke previous URL if exists
      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }
      
      // Create a MediaStream URL
      const video = document.createElement('video');
      video.srcObject = stream;
      video.playsInline = true;
      video.muted = true;
      
      // Wait for video to be ready
      await new Promise((resolve) => {
        video.onloadedmetadata = () => {
          video.play();
          resolve(null);
        };
      });
      
      // Create blob URL from stream for compatibility
      const mediaRecorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      
      mediaRecorder.ondataavailable = (e) => chunks.push(e.data);
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        setVideoUrl(url);
      };
      
      // Record for a short time to create a playable video
      mediaRecorder.start();
      
      // For now, just set the stream directly
      // Create a temporary object URL that references the stream
      const tempUrl = URL.createObjectURL(new Blob([JSON.stringify({ stream: 'active' })], { type: 'text/plain' }));
      setVideoUrl(tempUrl);
      
      // Set the video element's srcObject directly
      if (videoCanvasRef.current) {
        const videoElement = videoCanvasRef.current.getVideoElement();
        if (videoElement) {
          videoElement.srcObject = stream;
          videoElement.play();
        }
      }
      
      reset();
      setCurrentFrameIndex(0);
      setFrameROIs(new Map());
      setVideoWithROI(null);
      
      toast({
        title: "카메라 시작됨",
        description: "카메라가 성공적으로 연결되었습니다"
      });
      
      // Auto-advance to extract tab
      setCurrentTab('extract');
    } catch (error) {
      toast({
        title: "카메라 오류",
        description: "카메라에 접근할 수 없습니다. 권한을 확인해주세요.",
        variant: "destructive"
      });
    }
  }, [videoUrl, reset, toast]);

  const handlePrevFrame = useCallback(() => {
    if (currentFrameIndex > 0) {
      clearROI(); // Clear current ROI when changing frames
      setCurrentFrameIndex(prev => prev - 1);
    }
  }, [currentFrameIndex, clearROI]);

  const handleNextFrame = useCallback(() => {
    if (currentFrameIndex < extractedFrames.length - 1) {
      clearROI(); // Clear current ROI when changing frames
      setCurrentFrameIndex(prev => prev + 1);
    }
  }, [currentFrameIndex, extractedFrames.length, clearROI]);

  const handleSaveROI = useCallback(() => {
    if (roi) {
      setFrameROIs(prev => new Map(prev).set(currentFrameIndex, roi));
      clearROI(); // Clear after saving
      toast({
        title: "ROI 저장됨",
        description: `프레임 ${currentFrameIndex + 1}의 ROI가 저장되었습니다`
      });
    }
  }, [roi, currentFrameIndex, toast, clearROI]);

  const handleCompleteROISelection = useCallback(async () => {
    if (frameROIs.size === 0) {
      toast({
        title: "ROI 없음",
        description: "먼저 최소 한 프레임에 ROI를 선택해주세요",
        variant: "destructive"
      });
      return;
    }

    // Find first frame with ROI
    const firstFrameWithROI = Math.min(...Array.from(frameROIs.keys()));
    const initialROI = frameROIs.get(firstFrameWithROI);

    if (!initialROI) return;

    try {
      // Convert canvas frames to data URLs
      const frameDataUrls = extractedFrames.map(frame => frame.canvas.toDataURL());
      
      const trackedROIs = await trackObjectAcrossFrames(
        frameDataUrls,
        initialROI,
        firstFrameWithROI,
        (current, total) => {
          // Progress callback
        }
      );

      // Merge tracked ROIs with existing ROIs (prefer existing)
      const mergedROIs = new Map(trackedROIs);
      frameROIs.forEach((roi, frameIndex) => {
        mergedROIs.set(frameIndex, roi);
      });

      setFrameROIs(mergedROIs);

      // Analyze motion
      const motion = analyzeMotion(mergedROIs, fps);
      const smoothedMotion = smoothMotionData(motion, 3);
      setMotionData(smoothedMotion);

      // Generate video with ROI
      await generateVideoWithROI(mergedROIs);

      setCurrentTab('analyze');
      
      toast({
        title: "추적 완료",
        description: `${mergedROIs.size}개 프레임에서 물체를 추적하고 운동을 분석했습니다`
      });
    } catch (error) {
      toast({
        title: "추적 실패",
        description: error instanceof Error ? error.message : "물체 추적에 실패했습니다",
        variant: "destructive"
      });
    }
  }, [frameROIs, extractedFrames, currentFrameIndex, fps, trackObjectAcrossFrames, toast]);

  const generateVideoWithROI = useCallback(async (rois: Map<number, any>) => {
    if (extractedFrames.length === 0) return;

    setIsGeneratingVideo(true);
    
    try {
      // Create a canvas for video generation
      const canvas = document.createElement('canvas');
      const firstFrame = extractedFrames[0].canvas;
      canvas.width = firstFrame.width;
      canvas.height = firstFrame.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Failed to get canvas context');

      // Create video stream from canvas
      const stream = canvas.captureStream(fps);
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'video/webm;codecs=vp9',
        videoBitsPerSecond: 2500000
      });

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: 'video/webm' });
        const url = URL.createObjectURL(blob);
        setVideoWithROI(url);
        setIsGeneratingVideo(false);
      };

      mediaRecorder.start();

      // Draw each frame with ROI
      for (let i = 0; i < extractedFrames.length; i++) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(extractedFrames[i].canvas, 0, 0);

        // Draw ROI if exists
        const roi = rois.get(i);
        if (roi) {
          ctx.strokeStyle = '#00ff00';
          ctx.lineWidth = 3;
          ctx.strokeRect(roi.x, roi.y, roi.w, roi.h);
          
          // Draw center point
          const centerX = roi.x + roi.w / 2;
          const centerY = roi.y + roi.h / 2;
          ctx.fillStyle = '#00ff00';
          ctx.beginPath();
          ctx.arc(centerX, centerY, 5, 0, 2 * Math.PI);
          ctx.fill();
          
          // Draw frame number
          ctx.fillStyle = '#00ff00';
          ctx.font = '16px Arial';
          ctx.fillText(`Frame ${i + 1}`, roi.x, roi.y - 5);
        }

        // Wait for frame duration
        await new Promise(resolve => setTimeout(resolve, 1000 / fps));
      }

      mediaRecorder.stop();
    } catch (error) {
      setIsGeneratingVideo(false);
      toast({
        title: "영상 생성 실패",
        description: error instanceof Error ? error.message : "영상을 생성할 수 없습니다",
        variant: "destructive"
      });
    }
  }, [extractedFrames, fps, toast]);

  const downloadVideoWithROI = useCallback(() => {
    if (!videoWithROI) return;
    
    const a = document.createElement('a');
    a.href = videoWithROI;
    a.download = `motion-tracking-${Date.now()}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    toast({
      title: "다운로드 시작",
      description: "ROI가 표시된 영상 다운로드가 시작되었습니다"
    });
  }, [videoWithROI, toast]);

  const downloadCSV = useCallback(() => {
    if (motionData.length === 0) return;

    // Create CSV content
    const headers = ['Time (s)', 'X (m)', 'Y (m)', 'Vx (m/s)', 'Vy (m/s)', 'Speed (m/s)', 'Ax (m/s²)', 'Ay (m/s²)', 'Acceleration (m/s²)'];
    const rows = motionData.map(d => [
      d.time.toFixed(4),
      d.x.toFixed(4),
      d.y.toFixed(4),
      d.vx.toFixed(4),
      d.vy.toFixed(4),
      d.speed.toFixed(4),
      d.ax.toFixed(4),
      d.ay.toFixed(4),
      d.acceleration.toFixed(4)
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');

    // Create blob and download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `motion-analysis-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    toast({
      title: "CSV 다운로드",
      description: "분석 결과가 CSV 파일로 다운로드되었습니다"
    });
  }, [motionData, toast]);

  const currentFrame = extractedFrames[currentFrameIndex] || null;
  const showVideo = currentTab === 'upload' || (currentTab === 'extract' && extractedFrames.length === 0);

  // Prepare chart data
  const chartData = motionData.map(d => ({
    time: Number(d.time.toFixed(3)),
    x: Number(d.x.toFixed(3)),
    y: Number(d.y.toFixed(3)),
    vx: Number(d.vx.toFixed(3)),
    vy: Number(d.vy.toFixed(3)),
    speed: Number(d.speed.toFixed(3)),
    ax: Number(d.ax.toFixed(3)),
    ay: Number(d.ay.toFixed(3)),
    acceleration: Number(d.acceleration.toFixed(3))
  }));

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-4 max-w-6xl">
        <header className="mb-8 text-center">
          <h1 className="text-4xl font-bold bg-gradient-primary bg-clip-text text-transparent mb-2">
            Motion Tracker
          </h1>
          <p className="text-muted-foreground">
            동영상에서 물체를 지정해 운동을 분석합니다 (모바일 지원)
          </p>
        </header>

        <Tabs value={currentTab} onValueChange={setCurrentTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-4 bg-card">
            <TabsTrigger value="upload" className="data-[state=active]:bg-gradient-primary data-[state=active]:text-primary-foreground">
              <Upload className="w-4 h-4 mr-2" />
              1. 촬영
            </TabsTrigger>
            <TabsTrigger value="extract" className="data-[state=active]:bg-gradient-primary data-[state=active]:text-primary-foreground">
              <Play className="w-4 h-4 mr-2" />
              2. 프레임 추출
            </TabsTrigger>
            <TabsTrigger value="roi" className="data-[state=active]:bg-gradient-primary data-[state=active]:text-primary-foreground">
              <Target className="w-4 h-4 mr-2" />
              3. ROI 선택
            </TabsTrigger>
            <TabsTrigger value="analyze" className="data-[state=active]:bg-gradient-primary data-[state=active]:text-primary-foreground">
              <BarChart3 className="w-4 h-4 mr-2" />
              4. 결과
            </TabsTrigger>
          </TabsList>

          <div className="grid md:grid-cols-3 gap-6">
            <Card className="md:col-span-2 p-6 bg-card border-border">
              {currentTab === 'analyze' && videoWithROI ? (
                <div className="w-full aspect-video bg-black rounded-lg overflow-hidden">
                  <video
                    src={videoWithROI}
                    controls
                    loop
                    className="w-full h-full object-contain"
                  />
                </div>
              ) : (
                <VideoCanvas
                  ref={videoCanvasRef}
                  videoUrl={videoUrl}
                  currentFrame={currentFrame}
                  roi={currentTab === 'roi' ? roi : frameROIs.get(currentFrameIndex) || null}
                  onPointerDown={currentTab === 'roi' ? handlePointerDown : undefined}
                  onPointerMove={currentTab === 'roi' ? handlePointerMove : undefined}
                  onPointerUp={currentTab === 'roi' ? handlePointerUp : undefined}
                  showVideo={showVideo}
                />
              )}
            </Card>

            <Card className="p-6 bg-card border-border space-y-4">
              <TabsContent value="upload" className="mt-0 space-y-4">
                <div>
                  <Label htmlFor="video-upload" className="text-lg font-semibold mb-3 block">
                    비디오 업로드
                  </Label>
                  <input
                    ref={fileInputRef}
                    id="video-upload"
                    type="file"
                    accept="video/*"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                  <Button
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full bg-gradient-primary hover:opacity-90"
                    size="lg"
                  >
                    <Upload className="w-4 h-4 mr-2" />
                    파일 선택
                  </Button>
                </div>

                <div className="relative">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-border" />
                  </div>
                  <div className="relative flex justify-center text-xs uppercase">
                    <span className="bg-card px-2 text-muted-foreground">또는</span>
                  </div>
                </div>

                <Button
                  onClick={handleStartCamera}
                  variant="outline"
                  className="w-full"
                  size="lg"
                >
                  <Camera className="w-4 h-4 mr-2" />
                  카메라 켜기
                </Button>

                <p className="text-sm text-muted-foreground text-center mt-4">
                  카메라로 촬영하거나 비디오 파일을 업로드하세요
                </p>
              </TabsContent>

              <TabsContent value="extract" className="mt-0 space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="fps">프레임레이트 (FPS)</Label>
                  <Input
                    id="fps"
                    type="number"
                    min="1"
                    max="60"
                    value={fps}
                    onChange={(e) => setFps(Number(e.target.value))}
                    className="bg-secondary"
                  />
                </div>

                <Button
                  onClick={handleExtractFrames}
                  disabled={!videoUrl || isExtracting}
                  className="w-full bg-gradient-primary hover:opacity-90"
                  size="lg"
                >
                  {isExtracting ? '추출 중...' : '프레임 추출 시작'}
                </Button>

                {isExtracting && (
                  <div className="space-y-2">
                    <Progress value={progress} className="w-full" />
                    <p className="text-sm text-center text-muted-foreground">{progress}%</p>
                  </div>
                )}

                {extractedFrames.length > 0 && (
                  <div className="space-y-3">
                    <p className="text-sm font-medium">
                      {extractedFrames.length}개 프레임 추출 완료
                    </p>
                    
                    <div className="flex items-center gap-2">
                      <Button
                        onClick={handlePrevFrame}
                        disabled={currentFrameIndex === 0}
                        variant="outline"
                        size="sm"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      
                      <div className="flex-1 text-center text-sm">
                        Frame {currentFrameIndex + 1} / {extractedFrames.length}
                      </div>
                      
                      <Button
                        onClick={handleNextFrame}
                        disabled={currentFrameIndex >= extractedFrames.length - 1}
                        variant="outline"
                        size="sm"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="roi" className="mt-0 space-y-4">
                {extractedFrames.length > 0 ? (
                  <>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">ROI 선택</p>
                      <p className="text-xs text-muted-foreground">
                        캔버스를 드래그하여 관심 영역을 선택하세요
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        onClick={handlePrevFrame}
                        disabled={currentFrameIndex === 0}
                        variant="outline"
                        size="sm"
                      >
                        <ChevronLeft className="w-4 h-4" />
                      </Button>
                      
                      <div className="flex-1 text-center text-sm">
                        Frame {currentFrameIndex + 1} / {extractedFrames.length}
                      </div>
                      
                      <Button
                        onClick={handleNextFrame}
                        disabled={currentFrameIndex >= extractedFrames.length - 1}
                        variant="outline"
                        size="sm"
                      >
                        <ChevronRight className="w-4 h-4" />
                      </Button>
                    </div>

                    {roi && (
                      <Button
                        onClick={handleSaveROI}
                        className="w-full bg-gradient-primary hover:opacity-90"
                      >
                        <Target className="w-4 h-4 mr-2" />
                        ROI 저장
                      </Button>
                    )}

                    <Button
                      onClick={clearROI}
                      variant="outline"
                      className="w-full"
                    >
                      ROI 초기화
                    </Button>

                    <div className="pt-4 border-t border-border space-y-3">
                      <p className="text-xs text-muted-foreground">
                        저장된 ROI: {frameROIs.size} / {extractedFrames.length}
                      </p>
                      
                      <Button
                        onClick={handleCompleteROISelection}
                        disabled={frameROIs.size === 0 || isTracking}
                        className="w-full bg-gradient-primary hover:opacity-90"
                        size="lg"
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        {isTracking ? `추적 중... ${trackingProgress}%` : 'ROI 선택 완료'}
                      </Button>
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    먼저 프레임을 추출해주세요
                  </p>
                )}
              </TabsContent>

              <TabsContent value="analyze" className="mt-0 space-y-4">
                {motionData.length > 0 ? (
                  <>
                    <Tabs value={activeChart} onValueChange={(v) => setActiveChart(v as any)} className="w-full">
                      <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="position">위치</TabsTrigger>
                        <TabsTrigger value="velocity">속도</TabsTrigger>
                        <TabsTrigger value="acceleration">가속도</TabsTrigger>
                      </TabsList>

                      <TabsContent value="position" className="space-y-2">
                        <div className="h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="time" label={{ value: '시간 (s)', position: 'insideBottom', offset: -5 }} />
                              <YAxis label={{ value: '위치 (m)', angle: -90, position: 'insideLeft' }} />
                              <Tooltip />
                              <Legend />
                              <Line type="monotone" dataKey="x" stroke="hsl(var(--primary))" name="X 위치" />
                              <Line type="monotone" dataKey="y" stroke="hsl(var(--secondary))" name="Y 위치" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </TabsContent>

                      <TabsContent value="velocity" className="space-y-2">
                        <div className="h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="time" label={{ value: '시간 (s)', position: 'insideBottom', offset: -5 }} />
                              <YAxis label={{ value: '속도 (m/s)', angle: -90, position: 'insideLeft' }} />
                              <Tooltip />
                              <Legend />
                              <Line type="monotone" dataKey="speed" stroke="hsl(var(--primary))" name="속력" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </TabsContent>

                      <TabsContent value="acceleration" className="space-y-2">
                        <div className="h-48">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="time" label={{ value: '시간 (s)', position: 'insideBottom', offset: -5 }} />
                              <YAxis label={{ value: '가속도 (m/s²)', angle: -90, position: 'insideLeft' }} />
                              <Tooltip />
                              <Legend />
                              <Line type="monotone" dataKey="acceleration" stroke="hsl(var(--primary))" name="가속도" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </TabsContent>
                    </Tabs>

                    <div className="pt-4 border-t border-border space-y-2">
                      <p className="text-sm font-medium">분석 통계</p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="p-2 bg-secondary rounded">
                          <p className="text-muted-foreground">추적 프레임</p>
                          <p className="font-semibold">{frameROIs.size}개</p>
                        </div>
                        <div className="p-2 bg-secondary rounded">
                          <p className="text-muted-foreground">분석 시간</p>
                          <p className="font-semibold">{(motionData[motionData.length - 1]?.time || 0).toFixed(2)}s</p>
                        </div>
                        <div className="p-2 bg-secondary rounded">
                          <p className="text-muted-foreground">최대 속력</p>
                          <p className="font-semibold">{Math.max(...motionData.map(d => d.speed)).toFixed(2)} m/s</p>
                        </div>
                        <div className="p-2 bg-secondary rounded">
                          <p className="text-muted-foreground">최대 가속도</p>
                          <p className="font-semibold">{Math.max(...motionData.map(d => d.acceleration)).toFixed(2)} m/s²</p>
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-border space-y-2">
                      <p className="text-sm font-medium">다운로드</p>
                      
                      <Button
                        onClick={downloadCSV}
                        className="w-full bg-gradient-primary hover:opacity-90"
                        size="lg"
                      >
                        <Download className="w-4 h-4 mr-2" />
                        CSV 파일 다운로드
                      </Button>

                      {isGeneratingVideo ? (
                        <Button disabled className="w-full" size="lg">
                          <Video className="w-4 h-4 mr-2 animate-spin" />
                          영상 생성 중...
                        </Button>
                      ) : videoWithROI ? (
                        <Button
                          onClick={downloadVideoWithROI}
                          variant="outline"
                          className="w-full"
                          size="lg"
                        >
                          <Video className="w-4 h-4 mr-2" />
                          ROI 영상 다운로드
                        </Button>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      ROI 선택을 완료하면 분석 결과가 표시됩니다
                    </p>
                    {frameROIs.size > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {frameROIs.size}개 프레임에 ROI가 지정되었습니다
                      </p>
                    )}
                  </div>
                )}
              </TabsContent>
            </Card>
          </div>
        </Tabs>
      </div>
    </div>
  );
};

export default Index;
