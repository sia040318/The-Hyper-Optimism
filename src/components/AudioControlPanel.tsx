import React from 'react';
import { PanningModel, SoundType } from '../types/audio';
import { ProxyTarget } from '../types/threats';
import { Headphones, Sliders } from 'lucide-react';

interface AudioControlPanelProps {
  volume: number;
  onVolumeChange: (vol: number) => void;
  panningModel: PanningModel;
  onPanningChange: (model: PanningModel) => void;
  soundType: SoundType;
  onSoundTypeChange: (sound: SoundType) => void;
  onTestDirection: (target: ProxyTarget) => void;
}

export const AudioControlPanel: React.FC<AudioControlPanelProps> = ({
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
