import React from 'react';
import { ThreatObstacle } from '../types/threats';
import { GazeZone, HeadPose, InputMode } from '../types/gaze';
import { calculateUrgency } from '../utils/threatScenarios';
import { Gauge, Eye } from 'lucide-react';

interface TelemetryPanelProps {
  primaryThreat: ThreatObstacle | null;
  currentGaze: GazeZone;
  dwellTimeMs: number;
  headPose: HeadPose;
  inputMode: InputMode;
  isCvConnected: boolean;
  onSimulateGaze: (zone: GazeZone) => void;
}

export const TelemetryPanel: React.FC<TelemetryPanelProps> = ({
  primaryThreat,
  currentGaze,
  dwellTimeMs,
  headPose,
  inputMode,
  isCvConnected,
  onSimulateGaze
}) => {
  const urgency = primaryThreat ? calculateUrgency(primaryThreat.distance) : 'SAFE';

  const getUrgencyColor = () => {
    switch (urgency) {
      case 'CRITICAL': return 'var(--accent-rose)';
      case 'WARNING': return 'var(--accent-amber)';
      case 'AWARENESS': return 'var(--accent-cyan)';
      default: return 'var(--accent-emerald)';
    }
  };

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <Gauge size={14} color="var(--accent-cyan)" />
          Threat Telemetry
        </h2>
      </div>

      <div className="telemetry-grid">
        <div className="telemetry-item">
          <div className="telemetry-label">Relative Azimuth</div>
          <div className="telemetry-value">
            {primaryThreat ? `${primaryThreat.azimuth.toFixed(1)}°` : '--'}
          </div>
        </div>

        <div className="telemetry-item">
          <div className="telemetry-label">Distance (r)</div>
          <div className="telemetry-value">
            {primaryThreat ? `${primaryThreat.distance.toFixed(1)} m` : '--'}
          </div>
        </div>

        <div className="telemetry-item">
          <div className="telemetry-label">Mapped Proxy Target</div>
          <div className="telemetry-value" style={{ fontSize: 12, color: 'var(--accent-cyan)' }}>
            {primaryThreat ? primaryThreat.proxyTarget : 'NONE'}
          </div>
        </div>

        <div className="telemetry-item">
          <div className="telemetry-label">Urgency Level</div>
          <div className="telemetry-value" style={{ color: getUrgencyColor(), fontSize: 13 }}>
            {urgency}
          </div>
        </div>
      </div>

      {/* Driver Gaze & Head Pose Section */}
      <div className="panel-header" style={{ marginTop: 4 }}>
        <h2 className="panel-title">
          <Eye size={14} color="var(--accent-violet)" />
          Driver Monitoring Telemetry
        </h2>
        <span style={{ fontSize: 10, color: isCvConnected && inputMode === 'CV_WEBSOCKET' ? 'var(--accent-emerald)' : 'var(--accent-cyan)' }}>
          {isCvConnected && inputMode === 'CV_WEBSOCKET' ? '● Live MediaPipe' : 'Keyboard Simulation'}
        </span>
      </div>

      <div className="telemetry-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <div className="telemetry-label">Active Gaze Focus</div>
          <div className="telemetry-value" style={{ fontSize: 14 }}>
            {currentGaze}
          </div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="telemetry-label">Dwell Time</div>
          <div className="telemetry-value" style={{ fontSize: 13, color: 'var(--accent-emerald)' }}>
            {dwellTimeMs} ms
          </div>
        </div>
      </div>

      {/* Head Pose Euler Angles */}
      <div className="telemetry-grid">
        <div className="telemetry-item">
          <div className="telemetry-label">Head Yaw (L/R)</div>
          <div className="telemetry-value" style={{ fontSize: 13 }}>
            {headPose.yaw.toFixed(1)}°
          </div>
        </div>
        <div className="telemetry-item">
          <div className="telemetry-label">Head Pitch (Up/Dn)</div>
          <div className="telemetry-value" style={{ fontSize: 13 }}>
            {headPose.pitch.toFixed(1)}°
          </div>
        </div>
      </div>

      {/* Simulation Trigger Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
        <div className="telemetry-label">Keyboard Simulation Shortcuts:</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button className="btn" onClick={() => onSimulateGaze('LEFT_MIRROR')} style={{ fontSize: 10 }}>
            Left Mirror (A / ←)
          </button>
          <button className="btn" onClick={() => onSimulateGaze('RIGHT_MIRROR')} style={{ fontSize: 10 }}>
            Right Mirror (D / →)
          </button>
          <button className="btn" onClick={() => onSimulateGaze('REAR_MIRROR')} style={{ fontSize: 10 }}>
            Rear Mirror (S / ↓)
          </button>
          <button className="btn" onClick={() => onSimulateGaze('CENTER')} style={{ fontSize: 10 }}>
            Forward Road (W / ↑)
          </button>
        </div>
      </div>

      {/* Collaborator Help Info */}
      <div className="telemetry-item" style={{ marginTop: 'auto', fontSize: 10, color: 'var(--text-dim)' }}>
        <div style={{ fontWeight: 600, color: 'var(--text-muted)', marginBottom: 2 }}>
          Collaborator CV Stream:
        </div>
        Run <code>python cv_bridge/cv_mediapipe_template.py</code> to connect live webcam head tracking.
      </div>
    </div>
  );
};
