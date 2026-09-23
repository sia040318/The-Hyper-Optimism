import { Volume2, VolumeX, Eye, Radio, Activity } from 'lucide-react';
import { InputMode } from '../types/gaze';

interface HeaderHUDProps {
  isAudioActive: boolean;
  onToggleAudio: () => void;
  cvMode: InputMode;
  isCvConnected: boolean;
  isCarlaConnected: boolean;
  onOpenStudy: () => void;
}

export const HeaderHUD: React.FC<HeaderHUDProps> = ({
  isAudioActive,
  onToggleAudio,
  cvMode,
  isCvConnected,
  isCarlaConnected,
  onOpenStudy
}) => {
  return (
    <header className="hud-header">
      <div className="brand-section">
        <span className="brand-badge">ADAS HCI</span>
        <div>
          <h1 className="brand-title">Spatial-to-Visual Proxy Cockpit</h1>
          <p className="brand-subtitle">3D HRTF Binaural ADAS Alert & Gaze Closed-Loop Elimination</p>
        </div>
      </div>

      <div className="header-status-group">
        {/* Audio Engine Status */}
        <button 
          onClick={onToggleAudio} 
          className={`status-pill ${isAudioActive ? 'active' : ''}`}
          style={{ cursor: 'pointer', background: isAudioActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(0,0,0,0.5)' }}
        >
          {isAudioActive ? <Volume2 size={14} color="var(--accent-emerald)" /> : <VolumeX size={14} color="var(--accent-amber)" />}
          <span>{isAudioActive ? 'Audio: 3D Active' : 'Start Audio Engine'}</span>
        </button>

        {/* CV Bridge / Simulation Mode Status */}
        <div className="status-pill">
          <Eye size={14} color={isCvConnected ? "var(--accent-emerald)" : "var(--accent-cyan)"} />
          <span>
            {cvMode === 'CV_WEBSOCKET' && isCvConnected ? 'CV Stream: Live MediaPipe' : 'Gaze: Simulation (Keys A/S/D)'}
          </span>
          <span className={`status-dot ${isCvConnected ? 'active pulse' : ''}`} />
        </div>

        {/* CARLA Simulator Bridge Status */}
        <div className="status-pill">
          <Radio size={14} color={isCarlaConnected ? "var(--accent-emerald)" : "var(--text-dim)"} />
          <span>{isCarlaConnected ? 'CARLA: Linked' : 'CARLA: Standalone'}</span>
          <span className={`status-dot ${isCarlaConnected ? 'active' : ''}`} />
        </div>

        {/* HCI Evaluation Study Modal Button */}
        <button onClick={onOpenStudy} className="btn btn-primary" style={{ padding: '6px 14px' }}>
          <Activity size={14} />
          <span>Run HCI Study</span>
        </button>
      </div>
    </header>
  );
};
