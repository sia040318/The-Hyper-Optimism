import React, { useRef, useEffect, useState } from 'react';
import {
  Camera,
  CameraOff,
  Eye,
  Activity,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  AlertCircle
} from 'lucide-react';
import { inBrowserVision } from '../services/InBrowserVisionService';
import { GazeZone, HeadPose, InBrowserVisionDiagnostics } from '../types/gaze';
import { ProxyTarget } from '../types/threats';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface DriverCameraPIPProps {
  currentGaze: GazeZone;
  headPose: HeadPose;
  activeThreatTarget: ProxyTarget | null;
  isSilenced: boolean;
  onCameraActiveChange: (active: boolean) => void;
}

export const DriverCameraPIP: React.FC<DriverCameraPIPProps> = ({
  currentGaze,
  headPose,
  activeThreatTarget,
  isSilenced,
  onCameraActiveChange
}) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [isCameraActive, setIsCameraActive] = useState(() => inBrowserVision.getIsRunning());
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [diagnostics, setDiagnostics] = useState<InBrowserVisionDiagnostics | null>(null);

  // Sync camera state if started/stopped by StudyOrchestrator & bind stream when expanded
  useEffect(() => {
    const running = inBrowserVision.getIsRunning();
    setIsCameraActive(running);
    if (running && isExpanded && videoRef.current) {
      inBrowserVision.attachVideoElement(videoRef.current);
    }
    const unsub = inBrowserVision.subscribe((msg) => {
      if (!isCameraActive && inBrowserVision.getIsRunning()) {
        setIsCameraActive(true);
        if (videoRef.current) inBrowserVision.attachVideoElement(videoRef.current);
      }
      if (msg.diagnostics) setDiagnostics(msg.diagnostics);
    });
    return () => unsub();
  }, [isExpanded, isCameraActive]);

  // Draw landmarks overlay
  useEffect(() => {
    let animId: number;
    const renderOverlay = () => {
      if (isCameraActive && canvasRef.current && videoRef.current) {
        const video = videoRef.current;
        const canvas = canvasRef.current;
        if (video.videoWidth > 0 && video.videoHeight > 0) {
          if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
          }
          inBrowserVision.drawDebugOverlay(canvas);
        }
      }
      animId = requestAnimationFrame(renderOverlay);
    };
    animId = requestAnimationFrame(renderOverlay);
    return () => cancelAnimationFrame(animId);
  }, [isCameraActive]);

  const handleToggleCamera = async () => {
    setErrorMessage(null);

    if (isCameraActive) {
      inBrowserVision.stop();
      setIsCameraActive(false);
      onCameraActiveChange(false);
      setDiagnostics(null);
    } else {
      if (!videoRef.current) return;
      setIsLoading(true);
      const success = await inBrowserVision.start(videoRef.current);
      setIsLoading(false);

      if (success) {
        setIsCameraActive(true);
        onCameraActiveChange(true);
      } else {
        setErrorMessage('Failed to access webcam or load MediaPipe model.');
        setIsCameraActive(false);
        onCameraActiveChange(false);
      }
    }
  };

  const isTargetMatched = Boolean(activeThreatTarget && currentGaze === activeThreatTarget);

  return (
    <div className="flex flex-col gap-3 rounded-[10px] border border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Eye
            size={14}
            strokeWidth={1.75}
            className={isCameraActive ? 'text-[#34d399]' : 'text-muted-foreground'}
          />
          <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
            Driver Monitoring
          </span>
          {isCameraActive && (
            <Badge
              variant="outline"
              className="border-[#34d399]/35 bg-[#34d399]/10 font-mono text-[10px] text-[#34d399]"
            >
              LIVE
            </Badge>
          )}
        </div>

        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className="cursor-pointer rounded p-1 text-muted-foreground hover:text-foreground"
          title={isExpanded ? 'Collapse' : 'Expand'}
        >
          {isExpanded ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
        </button>
      </div>

      {isExpanded && (
        <>
          <div
            className={`relative aspect-[4/3] w-full overflow-hidden rounded-lg border bg-background transition-colors ${
              isTargetMatched ? 'border-[#34d399]/60' : 'border-border'
            }`}
          >
            <video
              ref={videoRef}
              playsInline
              muted
              className={`h-full w-full -scale-x-100 object-cover ${
                isCameraActive ? 'block' : 'hidden'
              }`}
            />

            <canvas
              ref={canvasRef}
              className={`pointer-events-none absolute inset-0 h-full w-full ${
                isCameraActive ? 'block' : 'hidden'
              }`}
            />

            {!isCameraActive && (
              <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-muted-foreground">
                <Camera size={24} strokeWidth={1.5} className="opacity-50" />
                <span className="text-xs">Enable webcam for live head pose & iris gaze tracking.</span>
                <span className="font-mono text-[10px] text-[#71717a]">
                  100% local MediaPipe WebAssembly
                </span>
              </div>
            )}

            {isCameraActive && isSilenced && isTargetMatched && (
              <div className="absolute right-2 bottom-2 left-2 flex items-center justify-center gap-1.5 rounded bg-[#34d399]/90 px-2 py-1 font-mono text-[10px] font-semibold text-[#09090b]">
                <CheckCircle2 size={12} />
                CLOSED-LOOP MUTED
              </div>
            )}

            {isCameraActive && diagnostics && (
              <div className="absolute top-2 left-2 flex gap-2 rounded bg-black/75 px-2 py-0.5 font-mono text-[10px] tabular-nums text-[#38bdf8]">
                <span>{diagnostics.fps} FPS</span>
                <span>{diagnostics.latencyMs} ms</span>
              </div>
            )}
          </div>

          {errorMessage && (
            <div className="flex items-center gap-1.5 rounded-md border border-[#f87171]/30 bg-[#f87171]/10 px-2.5 py-1.5 text-xs text-[#f87171]">
              <AlertCircle size={13} className="shrink-0" />
              <span>{errorMessage}</span>
            </div>
          )}

          {isCameraActive && (
            <div className="space-y-2 rounded-lg border border-border bg-popover/60 p-2.5">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Confirmed Gaze</span>
                <span
                  className={`font-mono font-semibold ${
                    currentGaze === 'CENTER'
                      ? 'text-[#38bdf8]'
                      : isTargetMatched
                        ? 'text-[#34d399]'
                        : 'text-[#fbbf24]'
                  }`}
                >
                  {currentGaze}
                </span>
              </div>

              {diagnostics && (
                <div className="space-y-1">
                  <div className="flex justify-between font-mono text-[10px] text-muted-foreground">
                    <span>Dwell (300 ms)</span>
                    <span className="tabular-nums">{Math.round(diagnostics.dwellProgress * 100)}%</span>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-white/[0.08]">
                    <div
                      className="h-full transition-all duration-75"
                      style={{
                        width: `${diagnostics.dwellProgress * 100}%`,
                        backgroundColor: diagnostics.isConfirmed ? '#34d399' : '#38bdf8'
                      }}
                    />
                  </div>
                </div>
              )}

              <div className="grid grid-cols-3 gap-1.5 pt-1 font-mono text-[10px] tabular-nums">
                <div className="rounded border border-border bg-background py-1 text-center">
                  <span className="block text-[9px] text-[#71717a]">YAW</span>
                  <span className={Math.abs(headPose.yaw) >= 14 ? 'text-[#fbbf24]' : 'text-foreground'}>
                    {headPose.yaw}°
                  </span>
                </div>
                <div className="rounded border border-border bg-background py-1 text-center">
                  <span className="block text-[9px] text-[#71717a]">PITCH</span>
                  <span className={headPose.pitch >= 10 ? 'text-[#fbbf24]' : 'text-foreground'}>
                    {headPose.pitch}°
                  </span>
                </div>
                <div className="rounded border border-border bg-background py-1 text-center">
                  <span className="block text-[9px] text-[#71717a]">IRIS</span>
                  <span className="text-[#34d399]">
                    {diagnostics?.irisRatio !== null && diagnostics?.irisRatio !== undefined
                      ? diagnostics.irisRatio.toFixed(2)
                      : '--'}
                  </span>
                </div>
              </div>
            </div>
          )}

          <Button
            type="button"
            variant={isCameraActive ? 'destructive' : 'outline'}
            size="sm"
            onClick={handleToggleCamera}
            disabled={isLoading}
            className="h-8 w-full text-xs"
          >
            {isLoading ? (
              <>
                <Activity size={13} className="animate-spin" />
                Initializing MediaPipe...
              </>
            ) : isCameraActive ? (
              <>
                <CameraOff size={13} />
                Stop Webcam Tracker
              </>
            ) : (
              <>
                <Camera size={13} />
                Enable In-Browser Camera
              </>
            )}
          </Button>
        </>
      )}
    </div>
  );
};
