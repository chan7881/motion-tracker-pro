import { useState, useCallback, useRef } from 'react';

export interface ExtractedFrame {
    canvas: HTMLCanvasElement;
    timestamp: number;
    index: number;
}

// 모바일 메모리 부담을 줄이기 위해 추출 해상도의 긴 변을 이 값으로 제한한다.
// (원본 해상도 그대로 저장하면 프레임 수가 많을 때 모바일 브라우저가 메모리 부족으로
// 탭을 강제 재시작시켜 앱이 처음 화면으로 되돌아가는 문제가 있었다.)
const MAX_FRAME_DIMENSION = 720;

// 탐색(seek)이 이 시간 안에 끝나지 않으면 멈춘 것으로 보고 오류를 낸다.
// (기다리기만 하면 "추출 중..."에서 영원히 멈춘 것처럼 보인다.)
const SEEK_TIMEOUT_MS = 10000;

// HTMLMediaElement.HAVE_METADATA — 길이(duration)와 화면 크기를 읽을 수 있는 상태
const HAVE_METADATA = 1;

function waitForEvent(video: HTMLVideoElement, eventName: 'seeked' | 'loadedmetadata', timeoutMessage: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            clearTimeout(timer);
            video.removeEventListener(eventName, onDone);
            video.removeEventListener('error', onError);
        };
        const onDone = () => { cleanup(); resolve(); };
        const onError = () => { cleanup(); reject(new Error('영상을 읽는 중 오류가 났습니다. 다른 형식(mp4)으로 저장해 다시 올려주세요.')); };
        const timer = setTimeout(() => { cleanup(); reject(new Error(timeoutMessage)); }, SEEK_TIMEOUT_MS);
        video.addEventListener(eventName, onDone);
        video.addEventListener('error', onError);
    });
}

async function seekTo(video: HTMLVideoElement, time: number): Promise<void> {
    const done = waitForEvent(video, 'seeked', '영상의 장면을 불러오지 못했습니다. 영상을 다시 올려주세요.');
    video.currentTime = time;
    await done;
}

export interface ExtractResult {
    count: number;
    // 바로 앞 장면과 픽셀이 완전히 같은 장면 수. 카메라 영상은 잡음 때문에 정지 장면도
    // 조금씩 다르므로, 많으면 추출 FPS가 영상의 FPS보다 높아 같은 장면을 되풀이한 것이다.
    duplicateCount: number;
}

function countRepeatedFrames(frames: ExtractedFrame[]): number {
    let repeated = 0;
    let prev: Uint8ClampedArray | null = null;
    for (const frame of frames) {
        const ctx = frame.canvas.getContext('2d');
        if (!ctx) continue;
        const data = ctx.getImageData(0, 0, frame.canvas.width, frame.canvas.height).data;
        if (prev && prev.length === data.length) {
            let same = true;
            for (let i = 0; i < data.length; i += 4) {
                if (data[i] !== prev[i] || data[i + 1] !== prev[i + 1] || data[i + 2] !== prev[i + 2]) {
                    same = false;
                    break;
                }
            }
            if (same) repeated++;
        }
        prev = data;
    }
    return repeated;
}

export const useVideoFrame = () => {
    const [extractedFrames, setExtractedFrames] = useState<ExtractedFrame[]>([]);
    const [isExtracting, setIsExtracting] = useState(false);
    const [progress, setProgress] = useState(0);
    // 실제로 프레임을 뽑을 때 쓴 FPS. 입력칸의 FPS는 추출 뒤에도 바꿀 수 있으므로,
    // 시간 계산(속도·가속도)·구간 자르기·영상 생성은 반드시 이 값을 써야 한다.
    const [frameFps, setFrameFps] = useState<number | null>(null);
    const videoRef = useRef<HTMLVideoElement | null>(null);

    const extractFrames = useCallback(async (videoElement: HTMLVideoElement, fps: number = 10): Promise<ExtractResult> => {
        if (!videoElement || isExtracting) return { count: 0, duplicateCount: 0 };
        if (!(fps > 0)) throw new Error('프레임레이트(FPS)는 0보다 커야 합니다.');

        setIsExtracting(true);
        setProgress(0);
        const frames: ExtractedFrame[] = [];

        try {
            const canvas = document.createElement('canvas');
            const ctx = canvas.getContext('2d');
            if (!ctx) throw new Error('Could not get canvas context');

            // 메타데이터가 아직 없을 때만 기다린다. (readyState가 이미 1(HAVE_METADATA)인데
            // loadedmetadata를 기다리면 그 이벤트는 다시 오지 않아 영원히 멈춘다 — 아이폰
            // 사파리는 재생 전까지 readyState가 1에 머무는 일이 흔하다.)
            if (videoElement.readyState < HAVE_METADATA) {
                await waitForEvent(videoElement, 'loadedmetadata', '영상 정보를 불러오지 못했습니다. 영상을 다시 올려주세요.');
            }

            let duration = videoElement.duration;
            // 일부 .mov 파일(특히 아이폰 촬영본)은 메타데이터가 로드돼도 duration이
            // Infinity로 보고된다. 끝으로 한 번 탐색(seek)하면 브라우저가 실제 길이를
            // 다시 계산해 값을 채워준다.
            if (!isFinite(duration)) {
                await seekTo(videoElement, 1e10);
                duration = videoElement.duration;
            }

            if (!duration || !isFinite(duration)) {
                throw new Error('Invalid video duration');
            }

            const interval = 1 / fps;
            const totalFrames = Math.floor(duration * fps);

            const nativeWidth = videoElement.videoWidth || 640;
            const nativeHeight = videoElement.videoHeight || 480;
            const scale = Math.min(1, MAX_FRAME_DIMENSION / Math.max(nativeWidth, nativeHeight));
            canvas.width = Math.round(nativeWidth * scale);
            canvas.height = Math.round(nativeHeight * scale);

            for (let i = 0; i < totalFrames; i++) {
                const timestamp = i * interval;

                // 구간의 "가운데" 시각으로 탐색한다. 영상의 장면 시각은 ms 단위로 반올림돼 있어
                // 정확히 i/fps로 탐색하면 경계 바로 앞이 되어 이전 장면이 한 번 더 잡히고,
                // 그러면 위치가 멈췄다 뛰는 것처럼 보여 속도·가속도가 크게 튄다.
                // (모든 장면을 같은 만큼 미루므로 장면 사이 시간 간격은 그대로다.)
                await seekTo(videoElement, timestamp + interval / 2);

                // Small delay for mobile browsers
                await new Promise(resolve => requestAnimationFrame(resolve));

                ctx.clearRect(0, 0, canvas.width, canvas.height);
                ctx.drawImage(videoElement, 0, 0, canvas.width, canvas.height);

                // Create a copy of the canvas
                const frameCanvas = document.createElement('canvas');
                frameCanvas.width = canvas.width;
                frameCanvas.height = canvas.height;
                const frameCtx = frameCanvas.getContext('2d');
                if (frameCtx) {
                    frameCtx.drawImage(canvas, 0, 0);
                    frames.push({ canvas: frameCanvas, timestamp, index: i });
                }

                setProgress(Math.round(((i + 1) / totalFrames) * 100));
            }

            setExtractedFrames(frames);
            setFrameFps(fps);
            const duplicateCount = countRepeatedFrames(frames);
            console.log(`Extracted ${frames.length} frames (${duplicateCount} repeated)`);
            return { count: frames.length, duplicateCount };
        } catch (error) {
            console.error('Frame extraction error:', error);
            throw error;
        } finally {
            setIsExtracting(false);
        }
    }, [isExtracting]);

    const reset = useCallback(() => {
        setExtractedFrames([]);
        setFrameFps(null);
        setProgress(0);
    }, []);

    // 추출된 프레임 중 [startIndex, endIndex] 구간(양끝 포함)만 남기고 0부터 다시 인덱싱한다.
    // 재인덱싱하면 이미 지정한 ROI·추적 결과의 장면 번호가 어긋나므로, 호출하는 쪽에서
    // 그것들을 함께 비워야 한다. timestamp는 잘라낸 구간의 시작을 0초로 다시 맞춘다.
    const cropFrames = useCallback((startIndex: number, endIndex: number) => {
        setExtractedFrames((prev) => {
            const start = Math.max(0, Math.min(startIndex, prev.length - 1));
            const end = Math.max(start, Math.min(endIndex, prev.length - 1));

            return prev.slice(start, end + 1).map((frame, i) => ({
                canvas: frame.canvas,
                timestamp: frame.timestamp - prev[start].timestamp,
                index: i
            }));
        });
    }, []);

    return {
        extractedFrames,
        frameFps,
        isExtracting,
        progress,
        extractFrames,
        cropFrames,
        reset,
        videoRef
    };
};
