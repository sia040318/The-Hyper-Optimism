export type GazeZone = 'CENTER' | 'LEFT_MIRROR' | 'RIGHT_MIRROR' | 'REAR_MIRROR' | 'UNKNOWN';

export interface HeadPose {
  pitch: number; // looking up (+) or down (-)
  yaw: number;   // looking right (+) or left (-)
  roll: number;  // head tilt
}

export interface GazeUpdateMessage {
  type: 'GAZE_UPDATE';
  timestamp: number;
  gaze_zone: GazeZone;
  confidence: number;
  head_pose: HeadPose;
  dwell_time_ms: number;
  face_detected: boolean;
}

export type InputMode = 'SIMULATION' | 'CV_WEBSOCKET';

export interface DriverState {
  currentZone: GazeZone;
  dwellTimeMs: number;
  inputMode: InputMode;
  isCvConnected: boolean;
  confidence: number;
  headPose: HeadPose;
}
