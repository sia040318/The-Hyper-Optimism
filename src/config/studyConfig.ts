/**
 * ============================================================================
 * AURA DRIVE — TEAM-EDITABLE HCI EMPIRICAL STUDY CONFIGURATION
 * ============================================================================
 * Non-technical teammates can freely edit survey question text, scale labels,
 * trial counts, timing thresholds, and condition descriptions right here
 * without touching any React components, audio synthesis, or 3D engine code.
 *
 * After editing, save this file and run `npm run build` (or `npm run deploy`).
 */

export type StudyPartNumber = 1 | 2;

export type Part1Condition = 'MONO_BASELINE' | 'STEREO_BASELINE' | 'SPATIAL_3D';

export type Part2Condition = 'TRADITIONAL_PERSISTENT' | 'GAZE_CONTINGENT_3D';

export type StudyConditionType = Part1Condition | Part2Condition;

export interface SurveyQuestionConfig {
  /** Stable identifier recorded in CSV/JSON telemetry exports */
  id: string;
  /** Short category badge displayed above the question */
  category: string;
  /** Question text presented to the participant */
  prompt: string;
  /** Label shown at the left end (0) of the slider */
  lowLabel: string;
  /** Label shown at the right end (10) of the slider */
  highLabel: string;
  /** Which study parts show this question (1 = Localization, 2 = Alarm Fatigue) */
  applicableParts: StudyPartNumber[];
  /** Hint for analytics interpretation (true when lower numbers are better) */
  lowerIsBetter?: boolean;
}

/**
 * ----------------------------------------------------------------------------
 * 1. POST-BLOCK SURVEY QUESTIONS (0–10 Progressive Multi-Bubble Sliders)
 * ----------------------------------------------------------------------------
 */
export const SURVEY_QUESTIONS: SurveyQuestionConfig[] = [
  {
    id: 'directional_clarity',
    category: 'SPATIAL CLARITY',
    prompt: 'How easily could you identify which direction the hazard came from?',
    lowLabel: '0 = Impossible to tell',
    highLabel: '10 = Immediately obvious',
    applicableParts: [1, 2],
    lowerIsBetter: false
  },
  {
    id: 'front_rear_distinction',
    category: 'FRONT / REAR DISCRIMINATION',
    prompt: 'How confident were you telling front warnings apart from rear warnings?',
    lowLabel: '0 = Constant confusion',
    highLabel: '10 = Completely distinct',
    applicableParts: [1],
    lowerIsBetter: false
  },
  {
    id: 'mental_effort',
    category: 'COGNITIVE WORKLOAD',
    prompt: 'How much concentration did it take to interpret the audio warnings?',
    lowLabel: '0 = Effortless',
    highLabel: '10 = Exhausting',
    applicableParts: [1, 2],
    lowerIsBetter: true
  },
  {
    id: 'alarm_annoyance',
    category: 'ALARM FATIGUE & ANNOYANCE',
    prompt: 'How irritating or overwhelming did the warning sounds feel?',
    lowLabel: '0 = Not at all annoying',
    highLabel: '10 = Unbearable',
    applicableParts: [1, 2],
    lowerIsBetter: true
  },
  {
    id: 'system_trust',
    category: 'REAL-WORLD TRUST',
    prompt: 'How comfortable would you feel relying on this alert system in real highway driving?',
    lowLabel: '0 = Would turn it off',
    highLabel: '10 = Completely trust it',
    applicableParts: [1, 2],
    lowerIsBetter: false
  }
];

/**
 * ----------------------------------------------------------------------------
 * 2. EXPERIMENTAL TIMING, TRIAL COUNTS & HARDWARE THRESHOLDS
 * ----------------------------------------------------------------------------
 */
export const STUDY_PARAMETERS = {
  /** Number of trials per block in Part 1 (2 Left, 2 Right, 2 Rear, 2 Front) */
  part1TrialsPerCondition: 8,

  /** Number of trials per block in Part 2 (2 Left, 2 Right, 2 Rear) */
  part2TrialsPerCondition: 6,

  /** Locked highway autopilot cruise speed during study blocks (100 km/h = 27.78 m/s) */
  autopilotSpeedKmh: 100,

  /** Maximum alarm duration (ms) in Traditional Persistent Alarm mode */
  traditionalAlarmMaxDurationMs: 3500,

  /** Gaze dwell duration (ms) on matching mirror required to confirm gaze check */
  gazeDwellConfirmationMs: 300,

  /** Fallback timeout (ms) in Part 2 if webcam gaze cannot confirm before prompting fallback */
  gazeFallbackTimeoutMs: 2200,

  /** Minimum random/jittered inter-trial interval (ms) */
  interTrialMinMs: 2200,

  /** Maximum random/jittered inter-trial interval (ms) */
  interTrialMaxMs: 3400,

  /** Maximum response window (ms) in Part 1 before auto-advancing */
  part1ResponseTimeoutMs: 8000,

  /** Step 0 interactive practice round duration (ms, unlogged) */
  practiceDurationMs: 10000,

  /** Minimum webcam tracking framerate recommended in Step 0 calibration gate */
  minRequiredWebcamFps: 15,

  /** Progressive slider track range and step */
  sliderMin: 0,
  sliderMax: 10,
  sliderStep: 0.5,

  /** Unit proximity threshold within which overlapping bubbles fan out vertically */
  overlapThresholdUnits: 0.4,

  /** Default study passcode if ?study=... parameter matches or when entered manually */
  defaultStudyPasscode: import.meta.env.VITE_STUDY_PASSCODE || 'KNU2026',

  /** AWS API Gateway endpoint injected at build time via .env.production */
  apiBaseUrl: import.meta.env.VITE_STUDY_API_URL || ''
} as const;

/**
 * ----------------------------------------------------------------------------
 * 3. CONDITION LABELS & VISUAL TOKENS
 * ----------------------------------------------------------------------------
 */
export interface ConditionMeta {
  id: StudyConditionType;
  part: StudyPartNumber;
  label: string;
  shortLabel: string;
  description: string;
  accentColor: string;
  badgeBg: string;
}

export const CONDITION_META: Record<StudyConditionType, ConditionMeta> = {
  MONO_BASELINE: {
    id: 'MONO_BASELINE',
    part: 1,
    label: 'Mono Non-Spatial Baseline',
    shortLabel: 'Mono',
    description: 'Single center-channel alert with no directional panning or pinna filtering.',
    accentColor: '#a1a1aa',
    badgeBg: 'rgba(161, 161, 170, 0.12)'
  },
  STEREO_BASELINE: {
    id: 'STEREO_BASELINE',
    part: 1,
    label: 'Stereo ILD Baseline',
    shortLabel: 'Stereo',
    description: 'Standard left/right equal-power panning without 3D HRTF or front-back pinna cues.',
    accentColor: '#fbbf24',
    badgeBg: 'rgba(251, 191, 36, 0.12)'
  },
  SPATIAL_3D: {
    id: 'SPATIAL_3D',
    part: 1,
    label: '3D HRTF + Pinna Spatial Audio',
    shortLabel: '3D Spatial',
    description: 'Full 3D HRTF directional audio with 4.2 kHz pinna notch and cabin early reflections.',
    accentColor: '#38bdf8',
    badgeBg: 'rgba(56, 189, 248, 0.12)'
  },
  TRADITIONAL_PERSISTENT: {
    id: 'TRADITIONAL_PERSISTENT',
    part: 2,
    label: 'Traditional Persistent Alarm',
    shortLabel: 'Traditional',
    description: 'Standard persistent alarm that keeps sounding for 3.5s even after mirror check.',
    accentColor: '#f87171',
    badgeBg: 'rgba(248, 113, 113, 0.12)'
  },
  GAZE_CONTINGENT_3D: {
    id: 'GAZE_CONTINGENT_3D',
    part: 2,
    label: 'Gaze-Contingent 3D ADAS',
    shortLabel: 'Gaze-Contingent 3D',
    description: '3D spatial warning that mutes immediately upon 300 ms mirror gaze dwell (C6→G6 earcon).',
    accentColor: '#34d399',
    badgeBg: 'rgba(52, 211, 153, 0.12)'
  }
};

/**
 * Neutral participant-facing condition labels to prevent demand characteristics bias
 * during active trials and progressive ratings.
 */
export function getBlindedConditionLabel(part: StudyPartNumber, blockOrderOneBased: number): string {
  if (part === 1) {
    const labels = ['Audio Profile A', 'Audio Profile B', 'Audio Profile C'];
    return labels[(Math.max(1, blockOrderOneBased) - 1) % labels.length];
  }
  const labels = ['Alert System 1', 'Alert System 2'];
  return labels[(Math.max(1, blockOrderOneBased) - 1) % labels.length];
}

/**
 * Distinct, restrained DESIGN.md colors for multi-bubble slider thumbs (#1, #2, #3)
 */
export const BUBBLE_BADGE_STYLES = [
  {
    index: 1,
    solid: '#38bdf8',
    border: '#38bdf8',
    glow: 'rgba(56, 189, 248, 0.18)',
    tint: 'rgba(56, 189, 248, 0.12)'
  },
  {
    index: 2,
    solid: '#fbbf24',
    border: '#fbbf24',
    glow: 'rgba(251, 191, 36, 0.18)',
    tint: 'rgba(251, 191, 36, 0.12)'
  },
  {
    index: 3,
    solid: '#34d399',
    border: '#34d399',
    glow: 'rgba(52, 211, 153, 0.18)',
    tint: 'rgba(52, 211, 153, 0.12)'
  }
] as const;
