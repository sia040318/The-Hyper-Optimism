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
  irisRatio?: number | null;
  onSimulateGaze: (zone: GazeZone) => void;
}

export const TelemetryPanel: React.FC<TelemetryPanelProps> = ({
  primaryThreat,
  currentGaze,
  dwellTimeMs,
  headPose,
  inputMode,
  isCvConnected,
  irisRatio,
  onSimulateGaze
}) => {
  const urgency = primaryThreat ? calculateUrgency(primaryThreat.distance) : 'SAFE';

  const getUrgencyColor = () => {
    switch (urgency) {
      case 'CRITICAL':
        return 'var(--accent-rose)';
      case 'WARNING':
        return 'var(--accent-amber)';
      case 'AWARENESS':
        return 'var(--accent-cyan)';
      default:
        return 'var(--accent-emerald)';
    }
  };

  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <Gauge size={14} color="var(--accent-cyan)" />
          Threat Telemetry
        </h2>
        {primaryThreat && (
          <span
            style={{
              fontSize: 10,
              fontFamily: 'var(--font-mono)',
              color: 'var(--text-muted)'
            }}
          >
            {primaryThreat.name}
          </span>
        )}
      </div>

      <div className="telemetry-grid">
        <div className="telemetry-item">
          <div className="telemetry-label">Relative Azimuth</div>
          <div className="telemetry-value">
            {primaryThreat
              ? `${primaryThreat.azimuth > 0 ? '+' : ''}${primaryThreat.azimuth.toFixed(1)}°`
              : '--'}
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
          <div className="telemetry-label">Urgency (ISO 15006)</div>
          <div className="telemetry-value" style={{ color: getUrgencyColor(), fontSize: 13 }}>
            {urgency}
          </div>
        </div>
      </div>

      {/* Driver Gaze & Head Pose Section */}
      <div className="panel-header" style={{ marginTop: 4 }}>
        <h2 className="panel-title">
          <Eye size={14} color="var(--accent-violet)" />
          Driver Gaze Telemetry
        </h2>
        <span
          style={{
            fontSize: 10,
            color:
              inputMode === 'IN_BROWSER_WEBCAM' || (isCvConnected && inputMode === 'CV_WEBSOCKET')
                ? 'var(--accent-emerald)'
                : 'var(--accent-cyan)'
          }}
        >
          {inputMode === 'IN_BROWSER_WEBCAM'
            ? '● In-Browser MediaPipe'
            : isCvConnected && inputMode === 'CV_WEBSOCKET'
            ? '● Python WS Stream'
            : 'Keyboard / Click Sim'}
        </span>
      </div>

      <div
        className="telemetry-item"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div>
          <div className="telemetry-label">Active Gaze Focus</div>
          <div
            className="telemetry-value"
            style={{
              fontSize: 14,
              color: currentGaze !== 'CENTER' ? 'var(--accent-emerald)' : '#fff'
            }}
          >
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
            {headPose.yaw > 0 ? `+${headPose.yaw.toFixed(1)}` : headPose.yaw.toFixed(1)}°
          </div>
        </div>
        <div className="telemetry-item">
          <div className="telemetry-label">Head Pitch (Up/Dn)</div>
          <div className="telemetry-value" style={{ fontSize: 13 }}>
            {headPose.pitch > 0 ? `+${headPose.pitch.toFixed(1)}` : headPose.pitch.toFixed(1)}°
          </div>
        </div>
        {irisRatio !== undefined && irisRatio !== null && (
          <div className="telemetry-item" style={{ gridColumn: 'span 2' }}>
            <div className="telemetry-label">Iris Gaze Ratio (L 0.0 ← 0.5 → 1.0 R)</div>
            <div className="telemetry-value" style={{ fontSize: 13, color: 'var(--accent-emerald)' }}>
              {irisRatio.toFixed(2)}
            </div>
          </div>
        )}
      </div>

      {/* Simulation Trigger Buttons */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
        <div className="telemetry-label">Quick Gaze Simulation (Keys 1 – 4):</div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
          <button
            className={`btn ${currentGaze === 'LEFT_MIRROR' ? 'btn-primary' : ''}`}
            onClick={() => onSimulateGaze('LEFT_MIRROR')}
            style={{ fontSize: 11 }}
          >
            ◀ Left Mirror [1]
          </button>
          <button
            className={`btn ${currentGaze === 'RIGHT_MIRROR' ? 'btn-primary' : ''}`}
            onClick={() => onSimulateGaze('RIGHT_MIRROR')}
            style={{ fontSize: 11 }}
          >
            Right Mirror [3] ▶
          </button>
          <button
            className={`btn ${currentGaze === 'REAR_MIRROR' ? 'btn-primary' : ''}`}
            onClick={() => onSimulateGaze('REAR_MIRROR')}
            style={{ fontSize: 11 }}
          >
            ▼ Rear Mirror [4]
          </button>
          <button
            className={`btn ${currentGaze === 'CENTER' ? 'btn-primary' : ''}`}
            onClick={() => onSimulateGaze('CENTER')}
            style={{ fontSize: 11 }}
          >
            ▲ Forward Road [2]
          </button>
        </div>
      </div>
    </div>
  );
};
