import React from 'react';
import { PanningModel, SoundType } from '../types/audio';
import { ProxyTarget } from '../types/threats';
import { Headphones, Sliders } from 'lucide-react';

interface AudioControlPanelProps {
  isAudioActive: boolean;
  onToggleAudio: () => void;
  volume: number;
  onVolumeChange: (vol: number) => void;
  panningModel: PanningModel;
  onPanningChange: (model: PanningModel) => void;
  soundType: SoundType;
  onSoundTypeChange: (sound: SoundType) => void;
  onTestDirection: (target: ProxyTarget) => void;
}

export const AudioControlPanel: React.FC<AudioControlPanelProps> = ({
  isAudioActive,
  onToggleAudio,
  volume,
  onVolumeChange,
  panningModel,
  onPanningChange,
  soundType,
  onSoundTypeChange,
  onTestDirection
}) => {
  return (
    <div className="glass-panel">
      <div className="panel-header">
        <h2 className="panel-title">
          <Headphones size={15} color="var(--accent-cyan)" />
          HRTF Audio Engine
        </h2>
      </div>

      {/* Sound On / Off Toggle Slider Switch */}
      <div className="slider-group" style={{ paddingBottom: 6, borderBottom: '1px solid var(--border-subtle)' }}>
        <div className="slider-label-row" style={{ alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ fontWeight: 600, color: 'var(--text-main)' }}>Audio Output</span>
            <span style={{ 
              fontSize: 10, 
              padding: '2px 6px', 
              borderRadius: 4, 
              background: isAudioActive ? 'rgba(16, 185, 129, 0.15)' : 'rgba(255, 255, 255, 0.06)',
              color: isAudioActive ? 'var(--accent-emerald)' : 'var(--text-dim)',
              fontFamily: 'var(--font-mono)'
            }}>
              {isAudioActive ? 'ACTIVE' : 'MUTED'}
            </span>
          </div>

          <button
            onClick={onToggleAudio}
            type="button"
            className={`audio-toggle-switch ${isAudioActive ? 'active' : ''}`}
            aria-label="Toggle Sound"
            title={isAudioActive ? "Click to Turn Sound Off" : "Click to Turn Sound On"}
            style={{
              width: 44,
              height: 24,
              borderRadius: 12,
              background: isAudioActive ? 'var(--accent-emerald)' : 'rgba(255, 255, 255, 0.15)',
              border: '1px solid ' + (isAudioActive ? 'var(--accent-emerald)' : 'rgba(255, 255, 255, 0.2)'),
              position: 'relative',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              padding: 2,
              display: 'flex',
              alignItems: 'center'
            }}
          >
            <div
              style={{
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: '#ffffff',
                boxShadow: '0 2px 4px rgba(0, 0, 0, 0.4)',
                transform: isAudioActive ? 'translateX(20px)' : 'translateX(0px)',
                transition: 'transform 0.2s cubic-bezier(0.4, 0, 0.2, 1)'
              }}
            />
          </button>
        </div>
      </div>

      {/* Volume Slider */}
      <div className="slider-group">
        <div className="slider-label-row">
          <span>Master Volume</span>
          <span style={{ fontFamily: 'var(--font-mono)' }}>{Math.round(volume * 100)}%</span>
        </div>
        <input
          type="range"
          className="slider"
          min="0"
          max="100"
          value={Math.round(volume * 100)}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value) / 100)}
        />
      </div>

      {/* Spatial Panning Model (HRTF vs Stereo) */}
      <div className="slider-group">
        <div className="slider-label-row">
          <span>Spatial Panning Engine</span>
        </div>
        <div className="segmented-control">
          <button
            className={`segment-btn ${panningModel === 'HRTF' ? 'active' : ''}`}
            onClick={() => onPanningChange('HRTF')}
          >
            3D HRTF (Binaural)
          </button>
          <button
            className={`segment-btn ${panningModel === 'equalpower' ? 'active' : ''}`}
            onClick={() => onPanningChange('equalpower')}
          >
            Stereo Baseline
          </button>
        </div>
      </div>

      {/* Sound Waveform */}
      <div className="slider-group">
        <div className="slider-label-row">
          <span>Acoustic Waveform</span>
        </div>
        <div className="segmented-control">
          <button
            className={`segment-btn ${soundType === 'chime' ? 'active' : ''}`}
            onClick={() => onSoundTypeChange('chime')}
          >
            Harmonic Chime
          </button>
          <button
            className={`segment-btn ${soundType === 'click_train' ? 'active' : ''}`}
            onClick={() => onSoundTypeChange('click_train')}
          >
            Click Train
          </button>
          <button
            className={`segment-btn ${soundType === 'sine' ? 'active' : ''}`}
            onClick={() => onSoundTypeChange('sine')}
          >
            Pure Sine
          </button>
        </div>
      </div>

      {/* Instant Direction Tests */}
      <div className="panel-header" style={{ marginTop: 4 }}>
        <h2 className="panel-title">
          <Sliders size={14} color="var(--accent-amber)" />
          Instant Direction Cues
        </h2>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
        <button className="btn" onClick={() => onTestDirection('LEFT_MIRROR')}>
          Left Mirror (-90°)
        </button>
        <button className="btn" onClick={() => onTestDirection('RIGHT_MIRROR')}>
          Right Mirror (+90°)
        </button>
        <button className="btn" onClick={() => onTestDirection('REAR_MIRROR')}>
          Rear Mirror (180°)
        </button>
        <button className="btn" onClick={() => onTestDirection('FRONT_WINDSHIELD')}>
          Front (0°)
        </button>
      </div>

      <div style={{ marginTop: 'auto', fontSize: 11, color: 'var(--text-dim)', textAlign: 'center' }}>
        🎧 Stereo headphones required for accurate HRTF pinna & ITD cues.
      </div>
    </div>
  );
};
