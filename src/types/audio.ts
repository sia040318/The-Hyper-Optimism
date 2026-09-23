export type PanningModel = 'HRTF' | 'equalpower';

export type SoundType = 'chime' | 'click_train' | 'sine';

export type UrgencyLevel = 'SAFE' | 'AWARENESS' | 'WARNING' | 'CRITICAL';

export interface AudioEngineConfig {
  panningModel: PanningModel;
  soundType: SoundType;
  masterVolume: number;
  isMuted: boolean;
}

export interface SpatialAudioParams {
  x: number;      // Web Audio X: Left (-) / Right (+)
  y: number;      // Web Audio Y: Elevation (Up/Down)
  z: number;      // Web Audio Z: Behind (+) / Forward (-)
  azimuthDeg: number;
  distanceMeters: number;
  urgency: UrgencyLevel;
}
