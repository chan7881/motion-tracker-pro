import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { VideoCanvas, VideoCanvasHandle, confidenceColor, confidenceDash, frameBoxStyle, TrailPoint } from '@/components/VideoCanvas';
import { FrameTrimmer } from '@/components/FrameTrimmer';
import { FrameNavigator } from '@/components/FrameNavigator';
import { HelpGuide, HelpButton, useAutoShowHelp } from '@/components/HelpGuide';
import { useVideoFrame } from '@/hooks/useVideoFrame';
import { useROISelection, ROI } from '@/hooks/useROISelection';
import { useScaleCalibration } from '@/hooks/useScaleCalibration';
import { useOpticalFlowTracking } from '@/hooks/useOpticalFlowTracking';
import { useToast } from '@/hooks/use-toast';
import { analyzeMotion, computePixelsPerMeter, MotionData } from '@/utils/motionAnalysis';
import {
  Upload, Camera, Play, Target, BarChart3, Activity,
  CheckCircle, Check, Download, Video, Ruler, Square
} from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';

type FrameROI = ROI & { confidence?: number };

// 폰(390px)에서도 다섯 단계 이름이 겹치지 않게: 좁은 화면은 아이콘을 숨기고 두 줄까지 허용
const STEP_TAB_CLASS = 'data-[state=active]:bg-primary data-[state=active]:text-primary-foreground data-[state=active]:shadow-sm min-h-11 h-auto px-1 sm:px-3 text-xs sm:text-sm leading-tight whitespace-normal break-keep sm:whitespace-nowrap';
const STEP_ICON_CLASS = 'hidden sm:block w-4 h-4 mr-2 shrink-0';
// 마친 단계 표시: 색만이 아니라 모양(체크)과 화면 읽기 프로그램용 글자를 함께 준다
const StepDone = ({ done }: { done: boolean }) =>
  done ? (
    <>
      <Check className="w-3.5 h-3.5 mr-0.5 shrink-0" aria-hidden="true" />
      <span className="sr-only">(완료)</span>
    </>
  ) : null;

// 카드 공통 모양
const PANEL_CLASS = 'p-4 sm:p-5 shadow-sm';

// 자주 쓰는 추출 FPS. 직접 입력도 된다
const FPS_PRESETS = [10, 15, 30, 60];

// 단계마다 같은 모양의 제목과 한 줄 안내
const StepHeading = ({ title, description }: { title: string; description?: string }) => (
  <div className="space-y-1">
    <h2 className="text-base font-semibold tracking-tight">{title}</h2>
    {description && <p className="text-sm text-muted-foreground">{description}</p>}
  </div>
);

// 아직 앞 단계를 하지 않았을 때
const EmptyStep = ({ text }: { text: string }) => (
  <p className="text-sm text-muted-foreground rounded-md border border-dashed px-3 py-6 text-center">{text}</p>
);

const StatTile = ({ label, value }: { label: string; value: string }) => (
  <div className="rounded-md border bg-muted/40 px-3 py-2">
    <p className="text-xs text-muted-foreground">{label}</p>
    <p className="text-sm font-semibold tabular-nums">{value}</p>
  </div>
);

// 그래프 축 이름이 폰에서 잘리거나 눈금 숫자와 겹치지 않도록 여백과 정렬을 한곳에서 정한다
const CHART_MARGIN = { top: 10, right: 10, bottom: 20, left: 16 };
const X_AXIS_LABEL = { value: '시간 (s)', position: 'insideBottom' as const, offset: -12, fill: 'hsl(var(--muted-foreground))', fontSize: 13 };
// 시간축은 반드시 수(number)축이어야 한다. Recharts 기본값인 범주축은 점을 순서대로 같은 간격에
// 놓아서, 추적에 실패해 빠진 장면이 있으면 그 틈이 사라지고 기울기(속력)·모양이 실제와 달라진다.
const TIME_AXIS = {
  dataKey: 'time',
  type: 'number' as const,
  domain: [0, 'auto'] as [number, string],
  label: X_AXIS_LABEL
};
const yAxisLabel = (value: string) => ({
  value,
  angle: -90,
  position: 'insideLeft' as const,
  fill: 'hsl(var(--muted-foreground))',
  fontSize: 13,
  style: { textAnchor: 'middle' as const }
});
// 그래프 눈금·격자·툴팁은 화면 테마 색(라이트/다크)을 따른다
const AXIS_PROPS = {
  stroke: 'hsl(var(--border))',
  tick: { fill: 'hsl(var(--muted-foreground))', fontSize: 12 },
  tickLine: false
};
const GRID_PROPS = { stroke: 'hsl(var(--border))', strokeDasharray: '3 3', vertical: false };
// 툴팁: 시간과 값에 단위를 붙인다
const tooltipProps = (unit: string) => ({
  labelFormatter: (t: number) => `${t} s`,
  formatter: (v: number, name: string) => [`${v} ${unit}`, name] as [string, string],
  contentStyle: {
    background: 'hsl(var(--popover))',
    border: '1px solid hsl(var(--border))',
    borderRadius: 8,
    fontSize: 13
  },
  labelStyle: { color: 'hsl(var(--popover-foreground))', fontWeight: 600 }
});
// 장면이 많으면 점을 작게 (선 모양이 점에 묻히지 않게). 선 애니메이션은 끈다 — 측정 도구라 꾸밈이
// 필요 없고, 화면 크기가 바뀔 때마다 선이 반만 그려진 채로 다시 그려지는 것이 학생에게 혼란을 준다
const lineDot = (n: number) => (n > 40 ? { r: 1.5 } : { r: 3 });

const Index = () => {
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [currentTab, setCurrentTab] = useState('upload');
  const [currentFrameIndex, setCurrentFrameIndex] = useState(0);
  const [fps, setFps] = useState(10);
  // FPS 직접 입력칸에 친 글자 (버튼으로 고르면 비운다)
  const [fpsInput, setFpsInput] = useState('');
  const [frameROIs, setFrameROIs] = useState<Map<number, FrameROI>>(new Map());
  const [manualFrames, setManualFrames] = useState<Set<number>>(new Set());
  // 추적을 마쳐 결과를 보여 줄 상태인지. 결과 값 자체는 아래 motionData에서 매번 계산한다
  const [hasResults, setHasResults] = useState(false);
  const [activeChart, setActiveChart] = useState<'position' | 'velocity' | 'acceleration'>('position');
  const [videoWithROI, setVideoWithROI] = useState<string | null>(null);
  const [isGeneratingVideo, setIsGeneratingVideo] = useState(false);

  // 실측 스케일 보정
  const [pixelsPerMeter, setPixelsPerMeter] = useState<number | null>(null);
  const [realLengthInput, setRealLengthInput] = useState('');
  // 크기 보정 단계를 마쳤는지(보정했거나 건너뛰었거나) — 단계 탭의 완료 표시용
  const [calibrationDecided, setCalibrationDecided] = useState(false);

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

  // 결과는 지금의 위치·크기 보정·FPS에서 매번 다시 계산한다. 추적할 때 한 번 저장해 두면,
  // 결과를 본 뒤 크기 보정을 다시 했을 때 값은 px 그대로인데 단위만 m로 바뀌어 틀린 값이 된다.
  const motionData = useMemo<MotionData[]>(() => {
    if (!hasResults || extractedFrames.length === 0) return [];
    return analyzeMotion(frameROIs, analysisFps, pixelsPerMeter, extractedFrames[0].canvas.height);
  }, [hasResults, extractedFrames, frameROIs, analysisFps, pixelsPerMeter]);

  const { isTracking, progress: trackingProgress, trackObjectAcrossFrames } = useOpticalFlowTracking();
  const { open: helpOpen, setOpen: setHelpOpen } = useAutoShowHelp();

  // Create a ref object that dynamically gets the canvas from VideoCanvas
  const canvasRefGetter = {
    get current() {
      return videoCanvasRef.current?.getCanvasElement() || null;
    }
  };

  // 네모를 다 그리면(또는 톡 누르면) 지금 장면에 바로 저장한다 — 따로 「저장」을 누르지 않아도 된다
  const saveRoiForCurrentFrame = useCallback((r: ROI) => {
    if (r.w < 4 || r.h < 4) return;
    setFrameROIs((prev) => new Map(prev).set(currentFrameIndex, { ...r }));
    setManualFrames((prev) => new Set(prev).add(currentFrameIndex));
  }, [currentFrameIndex]);

  const { roi, handlePointerDown, handlePointerMove, handlePointerUp, clearROI } = useROISelection(
    canvasRefGetter as React.RefObject<HTMLCanvasElement>,
    saveRoiForCurrentFrame
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
    setHasResults(false);
    replaceVideoWithROI(null);
    clearROI();
  }, [clearROI, replaceVideoWithROI]);

  const resetForNewVideo = useCallback(() => {
    reset();
    clearTrackingResults();
    setPixelsPerMeter(null);
    setRealLengthInput('');
    setCalibrationDecided(false);
    clearCalibrationLine();
  }, [reset, clearTrackingResults, clearCalibrationLine]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 같은 파일을 다시 골라도 onChange가 오도록 비운다 (실패한 뒤 같은 영상을 다시 올릴 때)
    e.target.value = '';
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

    // 다음 단계로 바로 넘어가므로 따로 알리지 않는다 (알림이 폰 위쪽 단계 탭을 가린다)
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

    // 입력칸의 max·min은 화살표에만 걸리고 직접 친 값은 막지 않으므로 여기서 확인한다
    if (!(fps >= 1 && fps <= 60)) {
      toast({
        title: '프레임레이트를 확인해 주세요',
        description: '프레임레이트(FPS)는 1부터 60 사이로 넣어 주세요.',
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
      }

      // 크기 보정으로 자동 이동하지 않고 이 탭에 남아 구간 자르기(트림) UI를 보여준다
      // (추출한 장면 수는 화면에 나오므로 성공 알림은 띄우지 않는다)
    } catch (error) {
      toast({
        title: '추출 실패',
        description: error instanceof Error ? error.message : '프레임을 추출하지 못했습니다',
        variant: 'destructive',
        duration: 12000 // 무엇을 바꿔야 하는지 적힌 긴 문장이라 기본 5초로는 다 읽기 어렵다
      });
    }
  }, [extractFrames, fps, toast, clearTrackingResults]);

  const handleApplyCrop = useCallback((startIndex: number, endIndex: number) => {
    cropFrames(startIndex, endIndex);
    clearTrackingResults();
    setCurrentTab('calibrate');
  }, [cropFrames, clearTrackingResults]);

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
      setCurrentTab('extract');
    };

    mediaRecorderRef.current = recorder;
    recorder.start();
    setIsRecording(true);
    setRecordingSeconds(0);
  }, [videoUrl, resetForNewVideo, stopCameraStream]);

  const handleStopRecording = useCallback(() => {
    mediaRecorderRef.current?.stop();
  }, []);

  const jumpToFrame = useCallback((index: number) => {
    clearROI();
    setCurrentFrameIndex(index);
  }, [clearROI]);

  const goToFrame = useCallback((index: number) => {
    const clamped = Math.max(0, Math.min(index, extractedFrames.length - 1));
    if (clamped !== currentFrameIndex) jumpToFrame(clamped);
  }, [currentFrameIndex, extractedFrames.length, jumpToFrame]);

  // 지금 장면에 직접 지정한 네모를 지운다 (잘못 눌렀을 때)
  const handleClearCurrentRoi = useCallback(() => {
    clearROI();
    if (!manualFrames.has(currentFrameIndex)) return;
    setManualFrames((prev) => {
      const next = new Set(prev);
      next.delete(currentFrameIndex);
      return next;
    });
    setFrameROIs((prev) => {
      const next = new Map(prev);
      next.delete(currentFrameIndex);
      return next;
    });
  }, [clearROI, manualFrames, currentFrameIndex]);

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
    setCalibrationDecided(true);
    toast({
      title: '크기 보정 완료',
      description: `1m = ${ppm.toFixed(1)}px 로 설정했습니다`
    });
    setCurrentTab('roi');
  }, [calPixelDistance, realLengthInput, toast]);

  const handleSkipCalibration = useCallback(() => {
    setPixelsPerMeter(null);
    setCalibrationDecided(true);
    setCurrentTab('roi');
  }, []);


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
          ctx.setLineDash(confidenceDash(frameRoi.confidence));
          ctx.strokeRect(frameRoi.x, frameRoi.y, frameRoi.w, frameRoi.h);
          ctx.setLineDash([]);

          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(centerX, centerY, 5, 0, 2 * Math.PI);
          ctx.fill();

          // 경로 영상은 폰에서 작게 줄어 보이므로 화면 높이에 맞춰 글자를 키운다
          ctx.font = `bold ${Math.max(16, Math.round(canvas.height / 16))}px sans-serif`;
          ctx.fillText(`장면 ${i + 1}`, frameRoi.x, frameRoi.y - 8);
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
      // 아이폰은 다 쓴 캔버스도 메모리를 잡고 있으므로 0×0으로 줄여 돌려준다
      canvas.width = 0;
      canvas.height = 0;
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

    setHasResults(true);
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
  }, [videoWithROI]);

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

    // 엑셀은 BOM이 없는 UTF-8 CSV를 CP949로 읽어 「s²」 같은 글자가 깨지므로 BOM을 붙인다
    const blob = new Blob(['﻿' + csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `motion-analysis-${Date.now()}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [motionData, units]);

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

  const stepDone = {
    upload: !!videoUrl,
    extract: extractedFrames.length > 0,
    calibrate: calibrationDecided,
    roi: hasResults
  };
  const firstFrameSize = extractedFrames[0]
    ? { w: extractedFrames[0].canvas.width, h: extractedFrames[0].canvas.height }
    : { w: 16, h: 9 };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b bg-card">
        <div className="mx-auto max-w-6xl px-3 sm:px-4 h-14 flex items-center gap-3">
          <div className="w-8 h-8 rounded-md bg-primary text-primary-foreground flex items-center justify-center shrink-0">
            <Activity className="w-4 h-4" aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="text-base sm:text-lg font-semibold leading-tight tracking-tight">Motion Tracker</h1>
            <p className="hidden sm:block text-xs text-muted-foreground">동영상에서 물체를 지정해 운동을 분석해요</p>
          </div>
          <HelpButton onClick={() => setHelpOpen(true)} />
        </div>
      </header>

      <HelpGuide open={helpOpen} onOpenChange={setHelpOpen} />

      <main className="mx-auto max-w-6xl px-3 sm:px-4 py-4 sm:py-6">
        <Tabs value={currentTab} onValueChange={setCurrentTab} className="space-y-4 sm:space-y-6">
          <TabsList className="grid w-full grid-cols-5 h-auto p-1">
            <TabsTrigger value="upload" className={STEP_TAB_CLASS}>
              <Upload className={STEP_ICON_CLASS} />
              <StepDone done={stepDone.upload} />
              1. 촬영
            </TabsTrigger>
            <TabsTrigger value="extract" className={STEP_TAB_CLASS}>
              <Play className={STEP_ICON_CLASS} />
              <StepDone done={stepDone.extract} />
              2. 장면 추출
            </TabsTrigger>
            <TabsTrigger value="calibrate" className={STEP_TAB_CLASS}>
              <Ruler className={STEP_ICON_CLASS} />
              <StepDone done={stepDone.calibrate} />
              3. 크기 보정
            </TabsTrigger>
            <TabsTrigger value="roi" className={STEP_TAB_CLASS}>
              <Target className={STEP_ICON_CLASS} />
              <StepDone done={stepDone.roi} />
              4. 물체 지정
            </TabsTrigger>
            <TabsTrigger value="analyze" className={STEP_TAB_CLASS}>
              <BarChart3 className={STEP_ICON_CLASS} />
              5. 결과
            </TabsTrigger>
          </TabsList>

          <div className="grid md:grid-cols-3 gap-4 sm:gap-6 items-start">
            <Card className={`md:col-span-2 ${PANEL_CLASS}`}>
              {currentTab === 'analyze' && videoWithROI ? (
                <div className="mx-auto bg-black rounded-lg overflow-hidden" style={frameBoxStyle(firstFrameSize.w, firstFrameSize.h)}>
                  <video
                    src={videoWithROI}
                    controls
                    loop
                    playsInline
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

            <Card className={`${PANEL_CLASS} space-y-4`}>
              <TabsContent value="upload" className="mt-0 space-y-4">
                {!isCameraActive ? (
                  <>
                    <StepHeading title="영상 올리기" description="물체가 움직이는 영상을 올리거나, 카메라로 바로 찍어요." />

                    <input
                      ref={fileInputRef}
                      id="video-upload"
                      type="file"
                      accept="video/*"
                      onChange={handleFileUpload}
                      className="hidden"
                    />
                    <Button onClick={() => fileInputRef.current?.click()} className="w-full" size="lg">
                      <Upload className="w-4 h-4 mr-2" />
                      영상 파일 선택
                    </Button>

                    <div className="relative">
                      <div className="absolute inset-0 flex items-center">
                        <span className="w-full border-t border-border" />
                      </div>
                      <div className="relative flex justify-center text-xs">
                        <span className="bg-card px-2 text-muted-foreground">또는</span>
                      </div>
                    </div>

                    <Button onClick={handleStartCamera} variant="outline" className="w-full" size="lg">
                      <Camera className="w-4 h-4 mr-2" />
                      카메라 켜기
                    </Button>

                    <p className="text-xs text-muted-foreground rounded-md bg-muted px-3 py-2">
                      휴대폰은 움직이지 않게 고정하고, 길이를 아는 자를 함께 찍으면 실제 단위(m)로 분석할 수 있어요.
                    </p>
                  </>
                ) : (
                  <>
                    <StepHeading title="카메라가 켜졌어요" description="움직이는 물체가 잘 보이도록 화면을 맞춘 뒤 촬영 시작을 눌러 주세요." />

                    {!isRecording ? (
                      <>
                        <Button onClick={handleStartRecording} className="w-full" size="lg">
                          <Video className="w-4 h-4 mr-2" />
                          촬영 시작
                        </Button>
                        <Button onClick={handleCancelCamera} variant="outline" className="w-full">
                          카메라 끄기
                        </Button>
                      </>
                    ) : (
                      <Button onClick={handleStopRecording} variant="destructive" className="w-full" size="lg">
                        <Square className="w-4 h-4 mr-2" />
                        촬영 종료 ({recordingSeconds}초)
                      </Button>
                    )}
                  </>
                )}
              </TabsContent>

              <TabsContent value="extract" className="mt-0 space-y-4">
                <StepHeading title="장면 추출" description="영상에서 1초에 몇 장면을 뽑을지 고른 뒤 추출해요." />

                <div className="space-y-2">
                  <Label htmlFor="fps">1초에 뽑을 장면 수 (FPS)</Label>
                  <div className="grid grid-cols-5 gap-2">
                    {FPS_PRESETS.map((v) => (
                      <Button
                        key={v}
                        type="button"
                        variant={fps === v ? 'default' : 'outline'}
                        aria-pressed={fps === v}
                        onClick={() => {
                          setFps(v);
                          setFpsInput('');
                        }}
                        className="px-0 tabular-nums"
                      >
                        {v}
                      </Button>
                    ))}
                    <Input
                      id="fps"
                      type="number"
                      inputMode="numeric"
                      min="1"
                      max="60"
                      // 버튼으로 고르면 칸은 비워 두어 같은 숫자가 두 번 보이지 않게 한다
                      value={fpsInput}
                      placeholder="직접"
                      onChange={(e) => {
                        setFpsInput(e.target.value);
                        setFps(Number(e.target.value));
                      }}
                      aria-label="FPS 직접 입력"
                      className="h-11 px-2 text-center tabular-nums"
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    빠른 운동일수록 크게 해요. 찍은 영상의 FPS(휴대폰은 보통 30이나 60)보다 크게 하지는 않아요.
                  </p>
                </div>

                <Button onClick={handleExtractFrames} disabled={!videoUrl || isExtracting} className="w-full" size="lg">
                  {isExtracting ? '추출 중...' : '장면 추출 시작'}
                </Button>

                {isExtracting && (
                  <div className="space-y-2">
                    <Progress value={progress} className="w-full" />
                    <p className="text-sm text-center text-muted-foreground tabular-nums">{progress}%</p>
                  </div>
                )}

                {extractedFrames.length > 0 && (
                  <div className="space-y-3 pt-1">
                    <p className="text-sm font-medium">{extractedFrames.length}개 장면을 뽑았어요</p>
                    <FrameNavigator index={currentFrameIndex} count={extractedFrames.length} onChange={goToFrame} />
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
                    <StepHeading title="크기 보정" description="화면 속 자나 길이를 아는 물건(예: 책상)을 따라 선을 그어 주세요." />

                    <FrameNavigator index={currentFrameIndex} count={extractedFrames.length} onChange={goToFrame} />

                    <div className="space-y-2">
                      <Label htmlFor="real-length">선의 실제 길이 (m)</Label>
                      <Input
                        id="real-length"
                        type="number"
                        inputMode="decimal"
                        min="0.01"
                        step="0.01"
                        placeholder="예: 1"
                        value={realLengthInput}
                        onChange={(e) => setRealLengthInput(e.target.value)}
                        className="h-11"
                      />
                      <p className="text-xs text-muted-foreground">
                        30 cm는 0.3, 50 cm는 0.5로 넣어요.
                        {calibrationLine && <> 화면에서 그은 길이: <span className="tabular-nums">{calPixelDistance.toFixed(1)}px</span></>}
                      </p>
                    </div>

                    <Button
                      onClick={handleConfirmCalibration}
                      disabled={!calibrationLine || !(parseFloat(realLengthInput) > 0)}
                      className="w-full"
                      size="lg"
                    >
                      <Ruler className="w-4 h-4 mr-2" />
                      보정 완료
                    </Button>

                    {pixelsPerMeter && (
                      <p className="text-xs text-primary font-medium">
                        보정됨: 1m = {pixelsPerMeter.toFixed(1)}px
                      </p>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <Button onClick={clearCalibrationLine} variant="outline">
                        선 다시 긋기
                      </Button>
                      <Button onClick={handleSkipCalibration} variant="ghost" className="text-muted-foreground">
                        건너뛰기 (px)
                      </Button>
                    </div>
                  </>
                ) : (
                  <EmptyStep text="먼저 2단계에서 장면을 추출해 주세요." />
                )}
              </TabsContent>

              <TabsContent value="roi" className="mt-0 space-y-4">
                {extractedFrames.length > 0 ? (
                  <>
                    <StepHeading
                      title="물체 지정"
                      description="움직이는 물체를 톡 누르거나, 드래그해서 네모로 감싸요. 한 장면에서만 지정해도 나머지는 자동으로 따라가요. 손이나 다른 물체와 떨어져 있는 장면에서 지정하면 더 잘 따라가요."
                    />

                    <FrameNavigator index={currentFrameIndex} count={extractedFrames.length} onChange={goToFrame} />

                    {manualFrames.has(currentFrameIndex) && (
                      <Button onClick={handleClearCurrentRoi} variant="outline" className="w-full">
                        이 장면에 지정한 네모 지우기
                      </Button>
                    )}

                    <div className="pt-4 border-t border-border space-y-3">
                      <p className="text-xs text-muted-foreground">
                        직접 지정한 장면 {manualFrames.size}개
                        {trackedFrameCount > manualFrames.size && ` · 자동 추적한 장면 ${trackedFrameCount} / ${extractedFrames.length}개`}
                      </p>

                      <Button
                        onClick={handleCompleteROISelection}
                        disabled={manualFrames.size === 0 || isTracking}
                        className="w-full"
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
                            추적이 흔들린 장면이에요(네모가 점선). 눌러서 확인하고 네모를 다시 그려 보세요.
                          </p>
                          <div className="flex flex-wrap gap-1">
                            {lowConfidenceFrames.map((idx) => (
                              <Button
                                key={idx}
                                size="sm"
                                variant="secondary"
                                onClick={() => jumpToFrame(idx)}
                                className="h-11 min-w-11 px-2 text-xs tabular-nums"
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
                  <EmptyStep text="먼저 2단계에서 장면을 추출해 주세요." />
                )}
              </TabsContent>

              <TabsContent value="analyze" className="mt-0 space-y-4">
                {motionData.length > 0 ? (
                  <>
                    <StepHeading title="결과" />

                    {pixelsPerMeter === null && (
                      <p className="text-xs rounded-md border border-primary/30 bg-primary/10 px-3 py-2">
                        크기 보정을 하지 않아 위치·속력 값이 픽셀(px) 단위로 표시돼요. 실제 단위(m)로 보려면 3단계에서 크기 보정을 해 주세요.
                      </p>
                    )}

                    <p className="text-xs text-muted-foreground">
                      위치는 영상의 왼쪽 아래 모서리를 0으로 하고, 오른쪽을 +X, 위쪽을 +Y로 재요. 속력과 가속도는 크기만 그려요(방향별 값은 CSV에 있어요). 가속도는 앞뒤 장면이 넉넉한 구간만 그려요.
                    </p>

                    <Tabs value={activeChart} onValueChange={(v) => setActiveChart(v as typeof activeChart)} className="w-full">
                      <TabsList className="grid w-full grid-cols-3 h-auto p-1">
                        <TabsTrigger value="position" className="min-h-11">위치</TabsTrigger>
                        <TabsTrigger value="velocity" className="min-h-11">속력</TabsTrigger>
                        <TabsTrigger value="acceleration" className="min-h-11">가속도</TabsTrigger>
                      </TabsList>

                      <TabsContent value="position">
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={CHART_MARGIN}>
                              <CartesianGrid {...GRID_PROPS} />
                              <XAxis {...TIME_AXIS} {...AXIS_PROPS} />
                              <YAxis {...AXIS_PROPS} label={yAxisLabel(`위치 (${units.pos})`)} />
                              <Tooltip {...tooltipProps(units.pos)} />
                              <Legend wrapperStyle={{ paddingTop: 16, fontSize: 13 }} />
                              <Line type="monotone" dataKey="x" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={lineDot(chartData.length)} isAnimationActive={false} name="X 위치" />
                              <Line type="monotone" dataKey="y" stroke="hsl(var(--chart-2))" strokeWidth={2} dot={lineDot(chartData.length)} isAnimationActive={false} name="Y 위치" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </TabsContent>

                      <TabsContent value="velocity">
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={CHART_MARGIN}>
                              <CartesianGrid {...GRID_PROPS} />
                              <XAxis {...TIME_AXIS} {...AXIS_PROPS} />
                              <YAxis {...AXIS_PROPS} label={yAxisLabel(`속력 (${units.vel})`)} />
                              <Tooltip {...tooltipProps(units.vel)} />
                              <Line type="monotone" dataKey="speed" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={lineDot(chartData.length)} isAnimationActive={false} name="속력" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </TabsContent>

                      <TabsContent value="acceleration">
                        <div className="h-64">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={chartData} margin={CHART_MARGIN}>
                              <CartesianGrid {...GRID_PROPS} />
                              <XAxis {...TIME_AXIS} {...AXIS_PROPS} />
                              <YAxis {...AXIS_PROPS} label={yAxisLabel(`가속도의 크기 (${units.acc})`)} />
                              <Tooltip {...tooltipProps(units.acc)} />
                              <Line type="monotone" dataKey="acceleration" stroke="hsl(var(--chart-1))" strokeWidth={2} dot={lineDot(chartData.length)} isAnimationActive={false} name="가속도의 크기" />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </TabsContent>
                    </Tabs>

                    <div className="pt-4 border-t border-border space-y-2">
                      <p className="text-sm font-semibold">분석 통계</p>
                      <div className="grid grid-cols-2 gap-2">
                        <StatTile label="추적 장면" value={`${trackedFrameCount} / ${extractedFrames.length}개`} />
                        <StatTile
                          label="분석 구간"
                          value={`${((motionData[motionData.length - 1]?.time ?? 0) - (motionData[0]?.time ?? 0)).toFixed(2)} s`}
                        />
                        <StatTile label="최대 속력" value={`${Math.max(...motionData.map((d) => d.speed)).toFixed(2)} ${units.vel}`} />
                        <StatTile
                          label="최대 가속도 크기"
                          value={validAccelerations.length > 0 ? `${Math.max(...validAccelerations).toFixed(2)} ${units.acc}` : '-'}
                        />
                      </div>
                    </div>

                    <div className="pt-4 border-t border-border space-y-2">
                      <p className="text-sm font-semibold">내려받기</p>

                      <Button onClick={downloadCSV} className="w-full" size="lg">
                        <Download className="w-4 h-4 mr-2" />
                        CSV 파일
                      </Button>

                      {isGeneratingVideo ? (
                        <Button disabled variant="outline" className="w-full" size="lg">
                          <Video className="w-4 h-4 mr-2 animate-pulse" />
                          경로 영상 만드는 중...
                        </Button>
                      ) : videoWithROI ? (
                        <Button onClick={downloadVideoWithROI} variant="outline" className="w-full" size="lg">
                          <Video className="w-4 h-4 mr-2" />
                          경로 영상
                        </Button>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <EmptyStep
                    text={manualFrames.size > 0
                      ? `${manualFrames.size}개 장면에 물체를 지정했어요. 4단계에서 「물체 지정 완료」를 누르면 결과가 나와요.`
                      : '4단계에서 물체를 지정하면 결과가 나와요.'}
                  />
                )}
              </TabsContent>
            </Card>
          </div>
        </Tabs>
      </main>
    </div>
  );
};

export default Index;
