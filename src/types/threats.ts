export type ProxyTarget = 'LEFT_MIRROR' | 'RIGHT_MIRROR' | 'REAR_MIRROR' | 'FRONT_WINDSHIELD';

export type ScenarioType = 
  | 'BLIND_SPOT_LEFT' 
  | 'BLIND_SPOT_RIGHT' 
  | 'REAR_TAILGATER' 
  | 'FRONT_CUT_IN' 
  | 'ORBIT_360' 
  | 'MANUAL';

export interface ThreatObstacle {
  id: string;
  name: string;
  x: number;          // Lateral offset in meters (Negative = Left, Positive = Right)
  y: number;          // Longitudinal offset in meters (Positive = Forward, Negative = Rear)
  speedX?: number;    // Lateral velocity m/s
  speedY?: number;    // Longitudinal velocity m/s
  distance: number;   // Calculated euclidean distance
  azimuth: number;    // Angle in degrees (-180 to +180, 0 = Front, -90 = Left, 90 = Right, 180 = Rear)
  proxyTarget: ProxyTarget;
  isPrimary?: boolean;
}
