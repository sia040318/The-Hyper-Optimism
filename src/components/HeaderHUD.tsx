import { Volume2, VolumeX, Eye, Radio, Activity, Gamepad2 } from 'lucide-react';
import { InputMode } from '../types/gaze';

interface HeaderHUDProps {
  isAudioActive: boolean;
  onToggleAudio: () => void;
  cvMode: InputMode;
  isCvConnected: boolean;
  isCarlaConnected: boolean;
  onOpenStudy: () => void;
  onLaunchGame: () => void;
}

export const HeaderHUD: React.FC<HeaderHUDProps> = ({
  isAudioActive,
  onToggleAudio,
  cvMode,
  isCvConnected,
  isCarlaConnected,
  onOpenStudy,
  onLaunchGame
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
          style={{ 
            cursor: 'pointer', 
            background: isAudioActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.05)',
            borderColor: isAudioActive ? 'rgba(16, 185, 129, 0.4)' : 'rgba(255, 255, 255, 0.12)'
          }}
          title={isAudioActive ? "Click to Turn Sound Off" : "Click to Turn Sound On"}
        >
          {isAudioActive ? <Volume2 size={14} color="var(--accent-emerald)" /> : <VolumeX size={14} color="var(--text-muted)" />}
          <span>{isAudioActive ? 'Audio: 3D Active' : 'Audio: Off'}</span>
        </button>

        {/* CV Bridge / In-Browser Camera Status */}
        <div className="status-pill">
          <Eye size={14} color={cvMode === 'IN_BROWSER_WEBCAM' || isCvConnected ? "var(--accent-emerald)" : "var(--accent-cyan)"} />
          <span>
            {cvMode === 'IN_BROWSER_WEBCAM'
              ? 'Vision: In-Browser Webcam (Active)'
              : cvMode === 'CV_WEBSOCKET' && isCvConnected
              ? 'CV Stream: Live MediaPipe (WS)'
              : 'Gaze: Simulation (Keys A/S/D)'}
          </span>
          <span className={`status-dot ${cvMode === 'IN_BROWSER_WEBCAM' || isCvConnected ? 'active pulse' : ''}`} />
        </div>

        {/* CARLA Simulator Bridge Status */}
        <div className="status-pill">
          <Radio size={14} color={isCarlaConnected ? "var(--accent-emerald)" : "var(--text-dim)"} />
          <span>{isCarlaConnected ? 'CARLA: Linked' : 'CARLA: Standalone'}</span>
          <span className={`status-dot ${isCarlaConnected ? 'active' : ''}`} />
        </div>

        {/* Launch Fullscreen Driver Game Mode Button */}
        <button
          onClick={onLaunchGame}
          className="btn"
          style={{
            background: 'linear-gradient(135deg, rgba(0, 240, 255, 0.2), rgba(99, 102, 241, 0.25))',
            borderColor: 'rgba(0, 240, 255, 0.5)',
            color: '#fff',
            fontWeight: 700,
            padding: '6px 14px',
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
            boxShadow: '0 0 15px rgba(0, 240, 255, 0.25)'
          }}
          title="Play the 3D Driving Simulator in Fullscreen"
        >
          <Gamepad2 size={16} color="#00f0ff" />
          <span>Play 3D Game</span>
        </button>

        {/* HCI Evaluation Study Modal Button */}
        <button onClick={onOpenStudy} className="btn btn-primary" style={{ padding: '6px 14px' }}>
          <Activity size={14} />
          <span>Run HCI Study</span>
        </button>
      </div>
    </header>
  );
};
