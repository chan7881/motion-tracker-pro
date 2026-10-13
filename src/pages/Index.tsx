import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { VideoCanvas, VideoCanvasHandle, confidenceColor, TrailPoint } from '@/components/VideoCanvas';
import { FrameTrimmer } from '@/components/FrameTrimmer';
import { HelpGuide, HelpButton, useAutoShowHelp } from '@/components/HelpGuide';
import { useVideoFrame } from '@/hooks/useVideoFrame';
import { useROISelection, ROI } from '@/hooks/useROISelection';
import { useScaleCalibration } from '@/hooks/useScaleCalibration';
import { useOpticalFlowTracking } from '@/hooks/useOpticalFlowTracking';
import { useToast } from '@/hooks/use-toast';
import { analyzeMotion, computePixelsPerMeter, MotionData } from '@/utils/motionAnalysis';
import {
  Upload, Camera, Play, ChevronLeft, ChevronRight, Target, BarChart3,
  CheckCircle, Download, Video, Ruler, Square
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

type FrameROI = ROI & { confidence?: number };

// 폰(390px)에서도 다섯 단계 이름이 겹치지 않게: 좁은 화면은 아이콘을 숨기고 두 줄까지 허용
const STEP_TAB_CLASS = 'data-[state=active]:bg-gradient-primary data-[state=active]:text-primary-foreground min-h-11 h-auto px-1 sm:px-4 text-xs sm:text-sm leading-tight whitespace-normal break-keep sm:whitespace-nowrap';
const STEP_ICON_CLASS = 'hidden sm:block w-4 h-4 mr-2 shrink-0';

// 그래프 축 이름이 폰에서 잘리거나 눈금 숫자와 겹치지 않도록 여백과 정렬을 한곳에서 정한다
const CHART_MARGIN = { top: 10, right: 10, bottom: 20, left: 16 };
const X_AXIS_LABEL = { value: '시간 (s)', position: 'insideBottom' as const, offset: -12 };
const yAxisLabel = (value: string) => ({
  value,
  angle: -90,
  position: 'insideLeft' as const,
  style: { textAnchor: 'middle' as const }
});
// 툴팁: 흰 바탕에서 잘 읽히는 글자색, 시간과 값에 단위를 붙인다
const tooltipProps = (unit: string) => ({
  labelFormatter: (t: number) => `${t} s`,
  formatter: (v: number, name: string) => [`${v} ${unit}`, name] as [string, string],
  labelStyle: { color: '#111827', fontWeight: 600 }
});

const Index = () => {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState('upload');
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [fps, setFps] = useState(10);
  const [frameROIs, setFrameROIs] = useState<Map<number, FrameROI>>(new Map());
  const [manualFrames, setManualFrames] = useState<Set<number>>(new Set());
  const [motionData, setMotionData] = useState<MotionData[]>([]);
  const [activeChart, setActiveChart] = useState<'position' | 'velocity' | 'acceleration'>('position');
  const [videoWithROI, setVideoWithROI] = useState<string | null>(null);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);

  // 실측 스케일 보정
  const [pixelsPerMeter, setPixelsPerMeter] = useState<number | null>(null);
  const [realLengthInput, setRealLengthInput] = useState('');

  // 카메라 촬영
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);

  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const videoCanvasRef = useRef<VideoCanvasHandle>(null);
  const cameraPreviewRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<BlobPart[]>([]);
  const videoWithROIRef = useRef<string | null>(null);
  const videoExtRef = useRef<'webm' | 'mp4'>('webm');
  // 경로 영상 생성 작업 번호. 새 추적·초기화가 일어나면 번호가 바뀌어, 늦게 끝난 옛 작업이
  // 새 결과를 덮어쓰지 못하게 한다.
  const videoJobRef = useRef(0);

  const { extractedFrames, frameFps, isExtracting, progress, extractFrames, cropFrames, reset } = useVideoFrame();
  // 시간 계산은 입력칸 값이 아니라 실제로 추출에 쓴 FPS로 한다 (추출 뒤 입력칸을 바꿔도 결과가 틀어지지 않게)
  const analysisFps = frameFps ?? fps;
  const { isTracking, progress: trackingProgress, trackObjectAcrossFrames } = useOpticalFlowTracking();
  const { open: helpOpen, setOpen: setHelpOpen } = useAutoShowHelp();

  // Create a ref object that dynamically gets the canvas from VideoCanvas
  const canvasRefGetter = {
    get current() {
      return videoCanvasRef.current?.getCanvasElement() || null;
    }
  };

  const { roi, handlePointerDown, handlePointerMove, handlePointerUp, clearROI } = useROISelection(
    canvasRefGetter as React.RefObject<HTMLCanvasElement>
  );

  const {
    line: calibrationLine,
    pixelDistance: calPixelDistance,
    handlePointerDown: calHandlePointerDown,
    handlePointerMove: calHandlePointerMove,
    handlePointerUp: calHandlePointerUp,
    clearLine: clearCalibrationLine
  } = useScaleCalibration(canvasRefGetter as React.RefObject<HTMLCanvasElement>);

  // 카메라 스트림은 컴포넌트가 사라질 때 반드시 정리
  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);

  useEffect(() => {
    if (isCameraActive && streamRef.current && cameraPreviewRef.current) {
      cameraPreviewRef.current.srcObject = streamRef.current;
    }
  }, [isCameraActive]);

  useEffect(() => {
    if (!isRecording) return;
    const id = setInterval(() => setRecordingSeconds((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [isRecording]);

  const replaceVideoWithROI = useCallback((url: string | null) => {
    if (videoWithROIRef.current) URL.revokeObjectURL(videoWithROIRef.current);
    videoWithROIRef.current = url;
    setVideoWithROI(url);
  }, []);

  // 장면 번호가 바뀌는 일(새 영상, 다시 추출, 구간 자르기) 뒤에는 이전 ROI·추적·분석 결과가
  // 다른 장면을 가리키게 되므로 모두 비운다.
  const clearTrackingResults = useCallback(() => {
    videoJobRef.current++;
    setIsGeneratingVideo(false);
    setCurrentFrameIndex(0);
    setFrameROIs(new Map());
    setManualFrames(new Set());
    setMotionData([]);
    replaceVideoWithROI(null);
    clearROI();
  }, [clearROI, replaceVideoWithROI]);

  const resetForNewVideo = useCallback(() => {
    reset();
    clearTrackingResults();
    setPixelsPerMeter(null);
    setRealLengthInput('');
    clearCalibrationLine();
  }, [reset, clearTrackingResults, clearCalibrationLine]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // 브라우저/OS가 MIME 타입을 못 알아내는 경우가 있다 (예: 일부 환경에서 .mov가
    // video/quicktime이 아니라 application/octet-stream으로 보고됨). 이런 경우를 위해
    // 확장자도 함께 확인한다.
    const isVideoMime = file.type.startsWith('video/');
    const isVideoExtension = /\.(mp4|mov|webm|avi|mkv|m4v|3gp|ogv)$/i.test(file.name);
    if (!isVideoMime && !isVideoExtension) {
      toast({
        title: '잘못된 파일 형식',
        description: '동영상 파일을 올려주세요',
        variant: 'destructive'
      });
      return;
    }

    // Revoke previous URL
    if (videoUrl) {
      URL.revokeObjectURL(videoUrl);
    }

    const url = URL.createObjectURL(file);
    setVideoUrl(url);
    resetForNewVideo();

    toast({
      title: '영상 업로드 완료',
      description: `${file.name} 파일을 불러왔습니다`
    });

    // Auto-advance to extract tab
    setCurrentTab('extract');
  }, [videoUrl, resetForNewVideo, toast]);

  const handleExtractFrames = useCallback(async () => {
    const videoElement = videoCanvasRef.current?.getVideoElement();
    if (!videoElement) {
      toast({
        title: '영상 없음',
        description: '먼저 영상을 올려주세요',
        variant: 'destructive'
      });
      return;
    }

    try {
      clearTrackingResults();
      const { count, duplicateCount } = await extractFrames(videoElement, fps);
      if (count > 0 && duplicateCount / count > 0.2) {
        toast({
          title: '같은 장면이 여러 번 추출됐어요',
          description: `${count}개 중 ${duplicateCount}개가 바로 앞 장면과 똑같아요. 프레임레이트(FPS)가 영상보다 높을 수 있어요. 휴대폰 영상은 보통 30이니 30 이하로 낮춰 다시 추출해 보세요.`,
          variant: 'destructive',
          duration: 12000 // 문장이 길어 기본 5초로는 다 읽기 어렵다
        });
      } else {
        toast({
          title: '프레임 추출 완료',
          description: `${count}개의 장면을 추출했습니다. 필요하면 구간을 잘라주세요.`
        });
      }

      // 크기 보정으로 자동 이동하지 않고 이 탭에 남아 구간 자르기(트림) UI를 보여준다
    } catch (error) {
      toast({
        title: '추출 실패',
        description: error instanceof Error ? error.message : '프레임을 추출하지 못했습니다',
        variant: 'destructive'
      });
    }
  }, [extractFrames, fps, toast, clearTrackingResults]);

  const handleApplyCrop = useCallback((startIndex: number, endIndex: number) => {
    cropFrames(startIndex, endIndex);
    clearTrackingResults();
    toast({
      title: '구간 적용 완료',
      description: `${endIndex - startIndex + 1}개 장면만 남기고 잘랐습니다`
    });
    setCurrentTab('calibrate');
  }, [cropFrames, clearTrackingResults, toast]);

  const handleSkipCrop = useCallback(() => {
    setCurrentTab('calibrate');
  }, []);

  const stopCameraStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setIsCameraActive(false);
    setIsRecording(false);
  }, []);

  const handleStartCamera = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: 'environment',
          width: { ideal: 1280 },
          height: { ideal: 720 }
        },
        audio: false
      });

      streamRef.current = stream;
      setIsCameraActive(true);

      toast({
        title: '카메라 켜짐',
        description: '준비되면 촬영 시작 버튼을 눌러주세요'
      });
    } catch (error) {
      toast({
        title: '카메라 오류',
        description: '카메라에 접근할 수 없습니다. 권한을 확인해주세요.',
        variant: 'destructive'
      });
    }
  }, [toast]);

  const handleCancelCamera = useCallback(() => {
    stopCameraStream();
  }, [stopCameraStream]);

  const handleStartRecording = useCallback(() => {
    if (!streamRef.current) return;

    const mimeCandidates = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm', 'video/mp4'];
    const mimeType = mimeCandidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
    const recorder = mimeType
      ? new MediaRecorder(streamRef.current, { mimeType })
      : new MediaRecorder(streamRef.current);

    recordedChunksRef.current = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunksRef.current.push(e.data);
    };

    recorder.onstop = () => {
      const blob = new Blob(recordedChunksRef.current, { type: recorder.mimeType || 'video/webm' });
      const url = URL.createObjectURL(blob);

      stopCameraStream();

      if (videoUrl) {
        URL.revokeObjectURL(videoUrl);
      }

      setVideoUrl(url);
      resetForNewVideo();

      toast({
        title: '촬영 완료',
        description: '녹화된 영상이 저장되었습니다'
      });

      setCurrentTab('extract');
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
    setRecordingSeconds(0);
  }, [videoUrl, resetForNewVideo, toast, stopCameraStream]);

  const handleStopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
  }, []);

  const jumpToFrame = useCallback((index: number) => {
    clearROI();
    setCurrentFrameIndex(index);
  }, [clearROI]);

  const handlePrevFrame = useCallback(() => {
    if (currentFrameIndex > 0) {
      jumpToFrame(currentFrameIndex - 1);
    }
  }, [currentFrameIndex, jumpToFrame]);

  const handleNextFrame = useCallback(() => {
    if (currentFrameIndex < extractedFrames.length - 1) {
      jumpToFrame(currentFrameIndex + 1);
    }
  }, [currentFrameIndex, extractedFrames.length, jumpToFrame]);

  const handleConfirmCalibration = useCallback(() => {
    const realLength = parseFloat(realLengthInput);
    const ppm = computePixelsPerMeter(calPixelDistance, realLength);

    if (!ppm) {
      toast({
        title: '입력을 확인해주세요',
        description: '기준선을 긋고 실제 길이(m)를 입력해주세요',
        variant: 'destructive'
      });
      return;
    }

    setPixelsPerMeter(ppm);
    toast({
      title: '크기 보정 완료',
      description: `1m = ${ppm.toFixed(1)}px 로 설정했습니다`
    });
    setCurrentTab('roi');
  }, [calPixelDistance, realLengthInput, toast]);

  const handleSkipCalibration = useCallback(() => {
    setPixelsPerMeter(null);
    setCurrentTab('roi');
  }, []);

  const handleSaveROI = useCallback(() => {
    if (roi) {
      setFrameROIs((prev) => new Map(prev).set(currentFrameIndex, { ...roi }));
      setManualFrames((prev) => new Set(prev).add(currentFrameIndex));
      clearROI();
      toast({
        title: '위치 저장됨',
        description: `${currentFrameIndex + 1}번째 장면에 물체 위치를 저장했습니다`
      });
    }
  }, [roi, currentFrameIndex, toast, clearROI]);

  const generateVideoWithROI = useCallback(async (rois: Map<number, FrameROI>) => {
    if (extractedFrames.length === 0) return;

    const job = ++videoJobRef.current;
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
      const stream = canvas.captureStream(analysisFps);
      const mimeCandidates = ['video/webm;codecs=vp9', 'video/webm'];
      const mimeType = mimeCandidates.find((t) => MediaRecorder.isTypeSupported(t)) || '';
      const mediaRecorder = mimeType
        ? new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 2500000 })
        : new MediaRecorder(stream, { videoBitsPerSecond: 2500000 });

      const chunks: Blob[] = [];
      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunks.push(e.data);
      };

      const stopped = new Promise<void>((resolve) => {
        mediaRecorder.onstop = () => {
          const blob = new Blob(chunks, { type: mediaRecorder.mimeType || 'video/webm' });
          const url = URL.createObjectURL(blob);
          if (job === videoJobRef.current) {
            videoExtRef.current = blob.type.includes('mp4') ? 'mp4' : 'webm';
            replaceVideoWithROI(url);
          } else {
            URL.revokeObjectURL(url);
          }
          resolve();
        };
      });

      mediaRecorder.start();

      // Draw each frame with ROI + 이동 경로(trail)
      const trailSoFar: TrailPoint[] = [];
      for (let i = 0; i < extractedFrames.length; i++) {
        if (job !== videoJobRef.current) break; // 새 추적이 시작됐으면 이 영상은 버린다
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(extractedFrames[i].canvas, 0, 0);

        const frameRoi = rois.get(i);
        if (frameRoi) {
          const color = confidenceColor(frameRoi.confidence);
          const centerX = frameRoi.x + frameRoi.w / 2;
          const centerY = frameRoi.y + frameRoi.h / 2;
          trailSoFar.push({ x: centerX, y: centerY, confidence: frameRoi.confidence ?? 1 });

          ctx.strokeStyle = color;
          ctx.lineWidth = 3;
          ctx.strokeRect(frameRoi.x, frameRoi.y, frameRoi.w, frameRoi.h);

          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(centerX, centerY, 5, 0, 2 * Math.PI);
          ctx.fill();

          ctx.font = '16px sans-serif';
          ctx.fillText(`Frame ${i + 1}`, frameRoi.x, frameRoi.y - 8);
        }

        if (trailSoFar.length > 1) {
          for (let t = 1; t < trailSoFar.length; t++) {
            ctx.strokeStyle = confidenceColor(trailSoFar[t].confidence);
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(trailSoFar[t - 1].x, trailSoFar[t - 1].y);
            ctx.lineTo(trailSoFar[t].x, trailSoFar[t].y);
            ctx.stroke();
          }
        }

        // Wait for frame duration
        await new Promise((resolve) => setTimeout(resolve, 1000 / analysisFps));
      }

      mediaRecorder.stop();
      await stopped;
    } catch (error) {
      if (job === videoJobRef.current) {
        toast({
          title: '영상 생성 실패',
          description: error instanceof Error ? error.message : '영상을 생성할 수 없습니다',
          variant: 'destructive'
        });
      }
    } finally {
      if (job === videoJobRef.current) setIsGeneratingVideo(false);
    }
  }, [extractedFrames, analysisFps, toast, replaceVideoWithROI]);

  // forwardOnly: "이 장면부터 다시 추적"일 때 — 시작 장면보다 앞의 결과는 그대로 두고 뒤쪽만 새로 추적한다
  const runTracking = useCallback(async (startFrameIndex: number, initialROI: FrameROI, forwardOnly = false) => {
    if (!extractedFrames || extractedFrames.length === 0) {
      throw new Error('추출된 프레임이 없습니다');
    }

    const canvases = extractedFrames.map((f) => f.canvas);
    const trackedROIs = await trackObjectAcrossFrames(canvases, initialROI, startFrameIndex, () => {}, forwardOnly);

    if (trackedROIs.size === 0) {
      throw new Error('추적된 위치가 없습니다. 다시 시도해주세요.');
    }

    const merged = new Map<number, FrameROI>();
    if (forwardOnly) {
      frameROIs.forEach((r, idx) => {
        if (idx < startFrameIndex) merged.set(idx, r);
      });
    }
    trackedROIs.forEach((r, idx) => merged.set(idx, r));

    // 사용자가 직접 지정한 프레임은 자동 추적 결과보다 항상 우선한다
    manualFrames.forEach((idx) => {
      const manualRoi = frameROIs.get(idx);
      if (manualRoi) merged.set(idx, manualRoi);
    });

    setFrameROIs(merged);

    const frameHeight = extractedFrames[0].canvas.height;
    const motion = analyzeMotion(merged, analysisFps, pixelsPerMeter, frameHeight);

    if (motion.length === 0) {
      throw new Error('운동 데이터를 생성할 수 없습니다. 추적에 성공한 장면이 2개 이상 있어야 합니다.');
    }

    setMotionData(motion);
    // 경로 영상은 장면 수만큼 실제 시간이 걸리므로 기다리지 않고 결과부터 보여 준다
    void generateVideoWithROI(merged);

    return merged;
  }, [extractedFrames, trackObjectAcrossFrames, manualFrames, frameROIs, pixelsPerMeter, analysisFps, generateVideoWithROI]);

  const handleCompleteROISelection = useCallback(async () => {
    if (manualFrames.size === 0) {
      toast({
        title: '지정된 위치 없음',
        description: '먼저 최소 한 장면에서 물체 위치를 지정해주세요',
        variant: 'destructive'
      });
      return;
    }

    const firstFrameWithROI = Math.min(...Array.from(manualFrames));
    const initialROI = frameROIs.get(firstFrameWithROI);
    if (!initialROI) return;

    try {
      await runTracking(firstFrameWithROI, initialROI);
      setCurrentTab('analyze');
      toast({
        title: '추적 완료',
        description: '물체를 추적하고 운동을 분석했습니다'
      });
    } catch (error) {
      toast({
        title: '추적 실패',
        description: error instanceof Error ? error.message : '물체 추적에 실패했습니다',
        variant: 'destructive'
      });
    }
  }, [manualFrames, frameROIs, runTracking, toast]);

  const handleRetrackFromCurrent = useCallback(async () => {
    const currentROI = frameROIs.get(currentFrameIndex);
    if (!currentROI || !manualFrames.has(currentFrameIndex)) {
      toast({
        title: '지정된 위치 없음',
        description: '이 장면에서 먼저 물체 위치를 저장해주세요',
        variant: 'destructive'
      });
      return;
    }

    try {
      await runTracking(currentFrameIndex, currentROI, true);
      toast({
        title: '다시 추적 완료',
        description: `${currentFrameIndex + 1}번째 장면부터 다시 추적했습니다`
      });
    } catch (error) {
      toast({
        title: '추적 실패',
        description: error instanceof Error ? error.message : '다시 추적에 실패했습니다',
        variant: 'destructive'
      });
    }
  }, [frameROIs, currentFrameIndex, manualFrames, runTracking, toast]);

  const downloadVideoWithROI = useCallback(() => {
    if (!videoWithROI) return;

    const a = document.createElement('a');
    a.href = videoWithROI;
    // 아이폰 사파리는 webm을 못 만들어 mp4로 녹화되므로 확장자를 실제 형식에 맞춘다
    a.download = `motion-tracking-${Date.now()}.${videoExtRef.current}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    toast({
      title: '다운로드 시작',
      description: '경로가 표시된 영상 다운로드가 시작되었습니다'
    });
  }, [videoWithROI, toast]);

  // 크기 보정을 했으면 m 계열, 안 했으면 원본 픽셀 단위로 표시
  const units = useMemo(() => ({
    calibrated: pixelsPerMeter !== null,
    pos: pixelsPerMeter !== null ? 'm' : 'px',
    vel: pixelsPerMeter !== null ? 'm/s' : 'px/s',
    acc: pixelsPerMeter !== null ? 'm/s²' : 'px/s²'
  }), [pixelsPerMeter]);

  const downloadCSV = useCallback(() => {
    if (motionData.length === 0) return;

    // Create CSV content
    const headers = [
      'Time (s)',
      `X (${units.pos})`, `Y (${units.pos})`,
      `Vx (${units.vel})`, `Vy (${units.vel})`, `Speed (${units.vel})`,
      `Ax (${units.acc})`, `Ay (${units.acc})`, `Acceleration (${units.acc})`
    ];
    const rows = motionData.map((d) => [
      d.time.toFixed(4),
      d.x.toFixed(4),
      d.y.toFixed(4),
      d.vx.toFixed(4),
      d.vy.toFixed(4),
      d.speed.toFixed(4),
      // 처음·끝이라 가속도를 구할 수 없는 장면은 빈칸 (그래프와 같게)
      d.accelValid ? d.ax.toFixed(4) : '',
      d.accelValid ? d.ay.toFixed(4) : '',
      d.accelValid ? d.acceleration.toFixed(4) : ''
    ]);

    const csvContent = [
      headers.join(','),
      ...rows.map((row) => row.join(','))
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
      title: 'CSV 다운로드',
      description: '분석 결과가 CSV 파일로 다운로드되었습니다'
    });
  }, [motionData, toast, units]);

  const currentFrame = extractedFrames[currentFrameIndex] || null;
  const showVideo = currentTab === 'upload' || (currentTab === 'extract' && extractedFrames.length === 0);

  // 물체 지정 탭에서도, 지금 그리는 네모가 없으면 이 장면에 저장·추적된 네모를 보여 준다
  // (흔들린 장면으로 이동했을 때 어디를 잡았는지 보여야 다시 지정할지 판단할 수 있다)
  const storedRoi = frameROIs.get(currentFrameIndex) ?? null;
  const displayedRoi: ROI | null = currentTab === 'roi' ? (roi ?? storedRoi) : storedRoi;
  const displayedConfidence = currentTab === 'roi' && roi ? undefined : storedRoi?.confidence;

  const trackedFrameCount = useMemo(
    () => Array.from(frameROIs.values()).filter((r) => r.confidence !== 0).length,
    [frameROIs]
  );

  const calibrationLabel = useMemo(() => {
    if (currentTab !== 'calibrate' || !calibrationLine) return null;
    const len = parseFloat(realLengthInput);
    return len > 0 ? `${len}m` : null;
  }, [currentTab, calibrationLine, realLengthInput]);

  // 지금까지 추적된 물체의 이동 경로 (ROI 지정 중에는 현재 장면까지만, 결과 화면에서는 전체)
  const trail = useMemo<TrailPoint[] | undefined>(() => {
    if (currentTab !== 'roi' && currentTab !== 'analyze') return undefined;

    const entries = Array.from(frameROIs.entries()).sort((a, b) => a[0] - b[0]);
    const upto = currentTab === 'roi' ? currentFrameIndex : Infinity;

    return entries
      .filter(([idx]) => idx <= upto)
      .map(([, r]) => ({ x: r.x + r.w / 2, y: r.y + r.h / 2, confidence: r.confidence ?? 1 }));
  }, [frameROIs, currentTab, currentFrameIndex]);

  const lowConfidenceFrames = useMemo(() => {
    return Array.from(frameROIs.entries())
      .filter(([, r]) => typeof r.confidence === 'number' && r.confidence < 0.5)
      .map(([idx]) => idx)
      .sort((a, b) => a - b);
  }, [frameROIs]);

  // Prepare chart data
  const chartData = motionData.map((d) => ({
    time: Number(d.time.toFixed(3)),
    x: Number(d.x.toFixed(3)),
    y: Number(d.y.toFixed(3)),
    vx: Number(d.vx.toFixed(3)),
    vy: Number(d.vy.toFixed(3)),
    speed: Number(d.speed.toFixed(3)),
    // null이면 그 장면은 가속도 그래프에 점을 찍지 않는다
    ax: d.accelValid ? Number(d.ax.toFixed(3)) : null,
    ay: d.accelValid ? Number(d.ay.toFixed(3)) : null,
    acceleration: d.accelValid ? Number(d.acceleration.toFixed(3)) : null
  }));
  const validAccelerations = motionData.filter((d) => d.accelValid).map((d) => d.acceleration);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto p-4 max-w-6xl">
        <header className="mb-8 text-center relative">
          <div className="absolute right-0 top-0">
            <HelpButton onClick={() => setHelpOpen(true)} />
          </div>
          <h1 className="text-4xl font-bold bg-gradient-primary bg-clip-text text-transparent mb-2">
            Motion Tracker
          </h1>
          <p className="text-muted-foreground">
            동영상에서 물체를 지정해 운동을 분석해요 (모바일 지원)
          </p>
        </header>

        <HelpGuide open={helpOpen} onOpenChange={setHelpOpen} />

        <Tabs value={currentTab} onValueChange={setCurrentTab} className="space-y-6">
          <TabsList className="grid w-full grid-cols-5 bg-card h-auto">
            <TabsTrigger value="upload" className={STEP_TAB_CLASS}>
              <Upload className={STEP_ICON_CLASS} />
              1. 촬영
            </TabsTrigger>
            <TabsTrigger value="extract" className={STEP_TAB_CLASS}>
              <Play className={STEP_ICON_CLASS} />
              2. 장면 추출
            </TabsTrigger>
            <TabsTrigger value="calibrate" className={STEP_TAB_CLASS}>
              <Ruler className={STEP_ICON_CLASS} />
              3. 크기 보정
            </TabsTrigger>
            <TabsTrigger value="roi" className={STEP_TAB_CLASS}>
              <Target className={STEP_ICON_CLASS} />
              4. 물체 지정
            </TabsTrigger>
            <TabsTrigger value="analyze" className={STEP_TAB_CLASS}>
              <BarChart3 className={STEP_ICON_CLASS} />
              5. 결과
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
              ) : isCameraActive ? (
                <div className="relative w-full aspect-video bg-black rounded-lg overflow-hidden">
                  <video
                    ref={cameraPreviewRef}
                    autoPlay
                    muted
                    playsInline
                    className="w-full h-full object-contain"
                  />
                  {isRecording && (
                    <div className="absolute top-3 left-3 flex items-center gap-2 bg-black/60 px-3 py-1 rounded-full text-white text-sm">
                      <span className="w-2 h-2 rounded-full bg-red-500 animate-pulse" />
                      촬영 중 {recordingSeconds}초
                    </div>
                  )}
                </div>
              ) : (
                <VideoCanvas
                  ref={videoCanvasRef}
                  videoUrl={videoUrl}
                  currentFrame={currentFrame}
                  roi={displayedRoi}
                  roiConfidence={displayedConfidence}
                  calibrationLine={currentTab === 'calibrate' ? calibrationLine : null}
                  calibrationLabel={calibrationLabel}
                  trail={trail}
                  onPointerDown={
                    currentTab === 'roi' ? handlePointerDown :
                    currentTab === 'calibrate' ? calHandlePointerDown : undefined
                  }
                  onPointerMove={
                    currentTab === 'roi' ? handlePointerMove :
                    currentTab === 'calibrate' ? calHandlePointerMove : undefined
                  }
                  onPointerUp={
                    currentTab === 'roi' ? handlePointerUp :
                    currentTab === 'calibrate' ? calHandlePointerUp : undefined
                  }
                  showVideo={showVideo}
                />
              )}
            </Card>

            <Card className="p-6 bg-card border-border space-y-4">
              <TabsContent value="upload" className="mt-0 space-y-4">
                {!isCameraActive ? (
                  <>
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
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium">카메라가 켜졌어요</p>
                    <p className="text-xs text-muted-foreground">
                      움직이는 물체가 잘 보이도록 화면을 맞춘 뒤 촬영 시작을 눌러주세요
                    </p>

                    {!isRecording ? (
                      <>
                        <Button
                          onClick={handleStartRecording}
                          className="w-full bg-gradient-primary hover:opacity-90"
                          size="lg"
                        >
                          <Video className="w-4 h-4 mr-2" />
                          촬영 시작
                        </Button>
                        <Button
                          onClick={handleCancelCamera}
                          variant="outline"
                          className="w-full"
                        >
                          카메라 끄기
                        </Button>
                      </>
                    ) : (
                      <Button
                        onClick={handleStopRecording}
                        className="w-full bg-destructive text-destructive-foreground hover:opacity-90"
                        size="lg"
                      >
                        <Square className="w-4 h-4 mr-2" />
                        촬영 종료 ({recordingSeconds}초)
                      </Button>
                    )}
                  </>
                )}
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
                  {isExtracting ? '추출 중...' : '장면 추출 시작'}
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
                      {extractedFrames.length}개 장면 추출 완료
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
                        장면 {currentFrameIndex + 1} / {extractedFrames.length}
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

                    <FrameTrimmer
                      frames={extractedFrames}
                      fps={analysisFps}
                      currentFrameIndex={currentFrameIndex}
                      onSeek={jumpToFrame}
                      onApply={handleApplyCrop}
                      onSkip={handleSkipCrop}
                    />
                  </div>
                )}
              </TabsContent>

              <TabsContent value="calibrate" className="mt-0 space-y-4">
                {extractedFrames.length > 0 ? (
                  <>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">크기 보정</p>
                      <p className="text-xs text-muted-foreground">
                        화면 속 자나 길이를 알고 있는 물건(예: 책상)을 따라 선을 그어주세요
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
                        장면 {currentFrameIndex + 1} / {extractedFrames.length}
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

                    <div className="space-y-2">
                      <Label htmlFor="real-length">실제 길이 (m)</Label>
                      <Input
                        id="real-length"
                        type="number"
                        min="0.01"
                        step="0.01"
                        placeholder="예: 1"
                        value={realLengthInput}
                        onChange={(e) => setRealLengthInput(e.target.value)}
                        className="bg-secondary"
                      />
                    </div>

                    {calibrationLine && (
                      <p className="text-xs text-muted-foreground">
                        화면상 길이: {calPixelDistance.toFixed(1)}px
                      </p>
                    )}

                    <Button
                      onClick={clearCalibrationLine}
                      variant="outline"
                      className="w-full"
                    >
                      선 다시 긋기
                    </Button>

                    <Button
                      onClick={handleConfirmCalibration}
                      disabled={!calibrationLine || !(parseFloat(realLengthInput) > 0)}
                      className="w-full bg-gradient-primary hover:opacity-90"
                      size="lg"
                    >
                      <Ruler className="w-4 h-4 mr-2" />
                      보정 완료
                    </Button>

                    {pixelsPerMeter && (
                      <p className="text-xs text-primary">
                        보정됨: 1m = {pixelsPerMeter.toFixed(1)}px
                      </p>
                    )}

                    <Button
                      onClick={handleSkipCalibration}
                      variant="ghost"
                      className="w-full text-muted-foreground"
                    >
                      건너뛰기 (픽셀 단위로 분석)
                    </Button>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    먼저 장면을 추출해주세요
                  </p>
                )}
              </TabsContent>

              <TabsContent value="roi" className="mt-0 space-y-4">
                {extractedFrames.length > 0 ? (
                  <>
                    <div className="space-y-2">
                      <p className="text-sm font-medium">물체 지정</p>
                      <p className="text-xs text-muted-foreground">
                        화면을 드래그해서 움직이는 물체를 네모로 감싸주세요
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
                        장면 {currentFrameIndex + 1} / {extractedFrames.length}
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
                        위치 저장
                      </Button>
                    )}

                    <Button
                      onClick={clearROI}
                      variant="outline"
                      className="w-full"
                    >
                      위치 초기화
                    </Button>

                    <div className="pt-4 border-t border-border space-y-3">
                      <p className="text-xs text-muted-foreground">
                        직접 지정한 장면: {manualFrames.size}개
                        {trackedFrameCount > manualFrames.size && ` · 자동 추적한 장면: ${trackedFrameCount} / ${extractedFrames.length}개`}
                      </p>

                      <Button
                        onClick={handleCompleteROISelection}
                        disabled={manualFrames.size === 0 || isTracking}
                        className="w-full bg-gradient-primary hover:opacity-90"
                        size="lg"
                      >
                        <CheckCircle className="w-4 h-4 mr-2" />
                        {isTracking ? `추적 중... ${trackingProgress}%` : '물체 지정 완료'}
                      </Button>

                      {frameROIs.size > 0 && (
                        <Button
                          onClick={handleRetrackFromCurrent}
                          disabled={isTracking || !manualFrames.has(currentFrameIndex)}
                          variant="outline"
                          className="w-full"
                        >
                          이 장면부터 다시 추적
                        </Button>
                      )}

                      {lowConfidenceFrames.length > 0 && (
                        <div className="space-y-2">
                          <p className="text-xs text-muted-foreground">
                            추적이 흔들린 장면이에요. 눌러서 확인하고 위치를 다시 지정해보세요.
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {lowConfidenceFrames.map((idx) => (
                              <Button
                                key={idx}
                                size="sm"
                                variant="secondary"
                                onClick={() => jumpToFrame(idx)}
                                className="h-7 px-2 text-xs"
                              >
                                #{idx + 1}
                              </Button>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                ) : (
                  <p className="text-sm text-muted-foreground">
                    먼저 장면을 추출해주세요
                  </p>
                )}
              </TabsContent>

              <TabsContent value="analyze" className="mt-0 space-y-4">
                {motionData.length > 0 ? (
                  <>
                    {pixelsPerMeter === null && (
                      <div className="text-xs bg-blue-500/10 text-blue-200 rounded p-2">
                        크기 보정을 하지 않아 위치·속력 값이 픽셀(px) 단위로 표시돼요. 실제 단위(m)로 보려면 3단계에서 크기 보정을 해주세요.
                      </div>
                    )}

                    <p className="text-xs text-muted-foreground">
                      위치는 영상의 왼쪽 아래 모서리를 0으로 하고, 오른쪽을 +X, 위쪽을 +Y로 재요. 속력과 가속도는 크기만 그려요(방향별 값은 CSV에 있어요). 가속도는 앞뒤 장면이 넉넉한 구간만 그려요.
                    </p>

                    <Tabs value={activeChart} onValueChange={(v) => setActiveChart(v as typeof activeChart)} className="w-full">
                      <TabsList className="grid w-full grid-cols-3">
                        <TabsTrigger value="position">위치</TabsTrigger>
                        <TabsTrigger value="velocity">속력</TabsTrigger>
                        <TabsTrigger value="acceleration">가속도</TabsTrigger>
                      </TabsList>

                      <TabsContent value="position" className="space-y-2">
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={CHART_MARGIN}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="time" label={X_AXIS_LABEL} />
                              <YAxis label={yAxisLabel(`위치 (${units.pos})`)} />
                              <Tooltip {...tooltipProps(units.pos)} />
                              <Legend wrapperStyle={{ paddingTop: 16 }} />
                              <Line type="monotone" dataKey="x" stroke="hsl(var(--primary))" name="X 위치" />
                              <Line type="monotone" dataKey="y" stroke="hsl(var(--chart-2))" name="Y 위치" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </TabsContent>

                      <TabsContent value="velocity" className="space-y-2">
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={CHART_MARGIN}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="time" label={X_AXIS_LABEL} />
                              <YAxis label={yAxisLabel(`속력 (${units.vel})`)} />
                              <Tooltip {...tooltipProps(units.vel)} />
                              <Line type="monotone" dataKey="speed" stroke="hsl(var(--primary))" name="속력" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </TabsContent>

                      <TabsContent value="acceleration" className="space-y-2">
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={CHART_MARGIN}>
                              <CartesianGrid strokeDasharray="3 3" />
                              <XAxis dataKey="time" label={X_AXIS_LABEL} />
                              <YAxis label={yAxisLabel(`가속도의 크기 (${units.acc})`)} />
                              <Tooltip {...tooltipProps(units.acc)} />
                              <Line type="monotone" dataKey="acceleration" stroke="hsl(var(--primary))" name="가속도의 크기" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </TabsContent>
                    </Tabs>

                    <div className="pt-4 border-t border-border space-y-2">
                      <p className="text-sm font-medium">분석 통계</p>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div className="p-2 bg-secondary rounded">
                          <p className="text-muted-foreground">추적 장면</p>
                          <p className="font-semibold">{trackedFrameCount} / {extractedFrames.length}개</p>
                        </div>
                        <div className="p-2 bg-secondary rounded">
                          <p className="text-muted-foreground">분석 구간</p>
                          <p className="font-semibold">{((motionData[motionData.length - 1]?.time ?? 0) - (motionData[0]?.time ?? 0)).toFixed(2)}s</p>
                        </div>
                        <div className="p-2 bg-secondary rounded">
                          <p className="text-muted-foreground">최대 속력</p>
                          <p className="font-semibold">{Math.max(...motionData.map((d) => d.speed)).toFixed(2)} {units.vel}</p>
                        </div>
                        <div className="p-2 bg-secondary rounded">
                          <p className="text-muted-foreground">최대 가속도 크기</p>
                          <p className="font-semibold">
                            {validAccelerations.length > 0 ? `${Math.max(...validAccelerations).toFixed(2)} ${units.acc}` : '-'}
                          </p>
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
                          경로 영상 다운로드
                        </Button>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">
                      물체 지정을 완료하면 분석 결과가 표시됩니다
                    </p>
                    {manualFrames.size > 0 && (
                      <p className="text-xs text-muted-foreground">
                        {manualFrames.size}개 장면에 위치가 지정되었습니다
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
