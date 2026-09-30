import React, { useRef, useEffect, useState } from 'react';
import { Camera, CameraOff, Eye, Activity, CheckCircle2, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { inBrowserVision } from '../services/InBrowserVisionService';
import { GazeZone, HeadPose, InBrowserVisionDiagnostics } from '../types/gaze';
import { ProxyTarget } from '../types/threats';

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
  const [isCameraActive, setIsCameraActive] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(true);
  const [diagnostics, setDiagnostics] = useState<InBrowserVisionDiagnostics | null>(null);

  // Sync canvas dimensions and draw overlays
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

        const diag = inBrowserVision.getLastDiagnostics();
        if (diag) {
          setDiagnostics(diag);
        }
      }
      animId = requestAnimationFrame(renderOverlay);
    };

    animId = requestAnimationFrame(renderOverlay);
    return () => cancelAnimationFrame(animId);
  }, [isCameraActive]);

  // Toggle Camera
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
        setErrorMessage('Failed to access webcam or load MediaPipe vision model.');
        setIsCameraActive(false);
        onCameraActiveChange(false);
      }
    }
  };

  // Check if current gaze matches the active threat target
  const isTargetMatched = activeThreatTarget && currentGaze === activeThreatTarget;

  return (
    <div className="glass-panel" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
      {/* Header Bar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <Eye size={16} className={isCameraActive ? 'text-cyan' : 'text-muted'} />
          <span style={{ fontSize: '12px', fontWeight: 600, letterSpacing: '0.05em' }}>
            DRIVER MONITORING (CV)
          </span>
          {isCameraActive && (
            <span
              style={{
                fontSize: '10px',
                padding: '2px 6px',
                borderRadius: '4px',
                background: 'rgba(16, 185, 129, 0.2)',
                color: '#10b981',
                border: '1px solid rgba(16, 185, 129, 0.4)',
                fontWeight: 600
              }}
            >
              ● IN-BROWSER
            </span>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '2px',
              display: 'flex',
              alignItems: 'center'
            }}
            title={isExpanded ? 'Collapse' : 'Expand'}
          >
            {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      {isExpanded && (
        <>
          {/* Video Feed & Canvas Container */}
          <div
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '4 / 3',
              borderRadius: '8px',
              overflow: 'hidden',
              background: '#090d16',
              border: `1px solid ${isTargetMatched ? 'rgba(16, 185, 129, 0.8)' : 'rgba(255, 255, 255, 0.1)'}`,
              boxShadow: isTargetMatched ? '0 0 15px rgba(16, 185, 129, 0.3)' : 'none',
              transition: 'border 0.2s, box-shadow 0.2s'
            }}
          >
            <video
              ref={videoRef}
              playsInline
              muted
              style={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                transform: 'scaleX(-1)', // Mirror feed naturally
                display: isCameraActive ? 'block' : 'none'
              }}
            />

            <canvas
              ref={canvasRef}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: '100%',
                pointerEvents: 'none',
                display: isCameraActive ? 'block' : 'none'
              }}
            />

            {/* Offline / Placeholder View */}
            {!isCameraActive && (
              <div
                style={{
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '8px',
                  color: 'var(--text-muted)',
                  padding: '16px',
                  textAlign: 'center'
                }}
              >
                <Camera size={28} style={{ opacity: 0.4 }} />
                <span style={{ fontSize: '11px' }}>
                  Enable webcam for live in-browser head pose & iris gaze tracking.
                </span>
                <span style={{ fontSize: '10px', color: 'rgba(255, 255, 255, 0.3)' }}>
                  (No Python server required. Runs 100% locally via WebAssembly GPU)
                </span>
              </div>
            )}

            {/* Closed-Loop Silence Overlay Banner */}
            {isCameraActive && isSilenced && isTargetMatched && (
              <div
                style={{
                  position: 'absolute',
                  bottom: '8px',
                  left: '8px',
                  right: '8px',
                  background: 'rgba(16, 185, 129, 0.9)',
                  backdropFilter: 'blur(4px)',
                  color: '#fff',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  fontSize: '11px',
                  fontWeight: 600,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '6px',
                  boxShadow: '0 2px 8px rgba(0, 0, 0, 0.4)'
                }}
              >
                <CheckCircle2 size={13} />
                ALERT CLOSED-LOOP MUTED!
              </div>
            )}

            {/* FPS and Latency Badge */}
            {isCameraActive && diagnostics && (
              <div
                style={{
                  position: 'absolute',
                  top: '6px',
                  left: '6px',
                  background: 'rgba(0, 0, 0, 0.65)',
                  backdropFilter: 'blur(4px)',
                  padding: '2px 6px',
                  borderRadius: '4px',
                  fontSize: '9px',
                  fontFamily: 'monospace',
                  color: '#38bdf8',
                  display: 'flex',
                  gap: '8px'
                }}
              >
                <span>{diagnostics.fps} FPS</span>
                <span>{diagnostics.latencyMs} ms</span>
              </div>
            )}
          </div>

          {/* Error Notice */}
          {errorMessage && (
            <div
              style={{
                fontSize: '11px',
                color: '#ef4444',
                background: 'rgba(239, 68, 68, 0.1)',
                padding: '6px 8px',
                borderRadius: '4px',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <AlertCircle size={14} />
              <span>{errorMessage}</span>
            </div>
          )}

          {/* Gaze Target & Dwell Meter */}
          {isCameraActive && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '6px',
                background: 'rgba(255, 255, 255, 0.03)',
                padding: '8px',
                borderRadius: '6px',
                border: '1px solid rgba(255, 255, 255, 0.05)'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', fontSize: '11px' }}>
                <span style={{ color: 'var(--text-muted)' }}>Confirmed Gaze:</span>
                <span
                  style={{
                    fontWeight: 700,
                    color:
                      currentGaze === 'CENTER'
                        ? '#38bdf8'
                        : isTargetMatched
                        ? '#10b981'
                        : '#f59e0b'
                  }}
                >
                  {currentGaze}
                </span>
              </div>

              {/* Dwell Confirmation Progress Bar */}
              {diagnostics && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '9px', color: 'rgba(255, 255, 255, 0.4)' }}>
                    <span>Dwell Stabilizer (300ms)</span>
                    <span>{Math.round(diagnostics.dwellProgress * 100)}%</span>
                  </div>
                  <div
                    style={{
                      height: '4px',
                      background: 'rgba(255, 255, 255, 0.1)',
                      borderRadius: '2px',
                      overflow: 'hidden'
                    }}
                  >
                    <div
                      style={{
                        height: '100%',
                        width: `${diagnostics.dwellProgress * 100}%`,
                        background: diagnostics.isConfirmed ? '#10b981' : '#00f0ff',
                        transition: 'width 0.1s linear'
                      }}
                    />
                  </div>
                </div>
              )}

              {/* Angle Metrics Grid */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(3, 1fr)',
                  gap: '4px',
                  marginTop: '4px',
                  fontSize: '9px',
                  fontFamily: 'monospace'
                }}
              >
                <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '4px', borderRadius: '3px', textAlign: 'center' }}>
                  <span style={{ color: 'rgba(255,255,255,0.4)', display: 'block' }}>YAW</span>
                  <span style={{ color: Math.abs(headPose.yaw) >= 18 ? '#f59e0b' : '#fff', fontWeight: 600 }}>
                    {headPose.yaw}°
                  </span>
                </div>
                <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '4px', borderRadius: '3px', textAlign: 'center' }}>
                  <span style={{ color: 'rgba(255,255,255,0.4)', display: 'block' }}>PITCH</span>
                  <span style={{ color: headPose.pitch >= 12 ? '#f59e0b' : '#fff', fontWeight: 600 }}>
                    {headPose.pitch}°
                  </span>
                </div>
                <div style={{ background: 'rgba(0, 0, 0, 0.3)', padding: '4px', borderRadius: '3px', textAlign: 'center' }}>
                  <span style={{ color: 'rgba(255,255,255,0.4)', display: 'block' }}>IRIS</span>
                  <span style={{ color: '#10b981', fontWeight: 600 }}>
                    {diagnostics?.irisRatio !== null && diagnostics?.irisRatio !== undefined ? diagnostics.irisRatio.toFixed(2) : '--'}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Camera Action Button */}
          <button
            onClick={handleToggleCamera}
            disabled={isLoading}
            className={`btn ${isCameraActive ? 'btn-danger' : 'btn-primary'}`}
            style={{
              width: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              padding: '8px',
              fontSize: '11px',
              fontWeight: 600
            }}
          >
            {isLoading ? (
              <>
                <Activity size={14} className="animate-spin" />
                Initializing MediaPipe...
              </>
            ) : isCameraActive ? (
              <>
                <CameraOff size={14} />
                Stop Webcam Tracker
              </>
            ) : (
              <>
                <Camera size={14} />
                Enable In-Browser Camera
              </>
            )}
          </button>
        </>
      )}
    </div>
  );
};
