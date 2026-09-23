import { ProxyTarget } from './threats';

export type StudyCondition = '3D_HRTF' | 'STEREO_BASELINE';

export interface TrialResult {
  trialNumber: number;
  condition: StudyCondition;
  targetProxy: ProxyTarget;
  responseProxy: ProxyTarget;
  isCorrect: boolean;
  isFrontBackReversal: boolean;
  reactionTimeMs: number;
  soundAzimuthDeg: number;
  timestamp: string;
}

export interface ConditionSummary {
  condition: StudyCondition;
  totalTrials: number;
  correctTrials: number;
  accuracyPercent: number;
  meanReactionTimeMs: number;
  medianReactionTimeMs: number;
  frontBackReversals: number;
  frontBackReversalRatePercent: number;
}

export interface SUSResponses {
  q1_frequentUse: number;       // 1 (Strongly disagree) to 5 (Strongly agree)
  q2_complexity: number;
  q3_easeOfUse: number;
  q4_needTechSupport: number;
  q5_wellIntegrated: number;
  q6_inconsistency: number;
  q7_quickLearn: number;
  q8_cumbersome: number;
  q9_confidence: number;
  q10_learningEffort: number;
}

export interface NasaTlxResponses {
  mentalDemand: number;     // 0 - 100
  physicalDemand: number;   // 0 - 100
  temporalDemand: number;   // 0 - 100
  performance: number;      // 0 - 100 (0 = Good, 100 = Poor)
  effort: number;           // 0 - 100
  frustration: number;      // 0 - 100
}

export interface ParticipantSession {
  participantId: string;
  age?: number;
  drivingYears?: number;
  trials: TrialResult[];
  hrtfSummary: ConditionSummary | null;
  stereoSummary: ConditionSummary | null;
  susResponses?: SUSResponses;
  susScore?: number;
  nasaTlxResponses?: NasaTlxResponses;
  overallTlxScore?: number;
}
