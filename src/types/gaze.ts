export type GazeZone = 'CENTER' | 'LEFT_MIRROR' | 'RIGHT_MIRROR' | 'REAR_MIRROR' | 'UNKNOWN';

export interface HeadPose {
  pitch: number; // looking up (+) or down (-)
  yaw: number;   // looking right (+) or left (-)
  roll: number;  // head tilt
}

export type InputMode = 'SIMULATION' | 'CV_WEBSOCKET' | 'IN_BROWSER_WEBCAM';

export interface InBrowserVisionDiagnostics {
  fps: number;
  latencyMs: number;
  irisRatio: number | null;
  candidateZone: GazeZone;
  confirmedZone: GazeZone | null;
  dwellProgress: number; // 0.0 to 1.0 (towards confirmation threshold)
  isConfirmed: boolean;
  landmarksDetected: boolean;
}

export interface GazeUpdateMessage {
  type: 'GAZE_UPDATE';
  timestamp: number;
  gaze_zone: GazeZone;
  confidence: number;
  head_pose: HeadPose;
  dwell_time_ms: number;
  face_detected: boolean;
  iris_ratio?: number | null;
  diagnostics?: InBrowserVisionDiagnostics;
}

export interface DriverState {
  currentZone: GazeZone;
  dwellTimeMs: number;
  inputMode: InputMode;
  isCvConnected: boolean;
  confidence: number;
  headPose: HeadPose;
  irisRatio?: number | null;
  diagnostics?: InBrowserVisionDiagnostics;
}

