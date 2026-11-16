import {
  Part1Condition,
  Part2Condition,
  StudyConditionType,
  StudyPartNumber,
  STUDY_PARAMETERS
} from '../config/studyConfig';
import { ProxyTarget } from '../types/threats';

export type HazardRole = 'overtaker' | 'blind_spot_linger' | 'tailgater' | 'cut_in';

export interface ScheduledStudyTrial {
  trialIndex: number; // 1-based
  targetZone: ProxyTarget;
  threatAzimuthDeg: number;
  interTrialDelayMs: number;
  hazardRole: HazardRole;
}

export interface ScheduledBlockPlan {
  participantId: string;
  part: StudyPartNumber;
  condition: StudyConditionType;
  conditionOrder: number; // 1-based position within this part
  sessionSeed: number;
  trials: ScheduledStudyTrial[];
}

/**
 * Mulberry32 deterministic 32-bit PRNG.
 * Produces repeatable uniform [0, 1) numbers for any 32-bit integer seed.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * FNV-1a 32-bit hash to derive reproducible numeric seeds from (participantId, part, condition).
 */
export function deriveSessionSeed(
  participantId: string,
  part: StudyPartNumber,
  condition: StudyConditionType
): number {
  const key = `${participantId.trim().toUpperCase()}::PART${part}::${condition}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

/**
 * Extracts numeric index from participant IDs such as "P_01", "P_02", "P_00".
 */
export function parseParticipantNumber(participantId: string): number {
  const match = participantId.match(/\d+/);
  if (!match) return 0;
  return parseInt(match[0], 10);
}

/**
 * 3x3 Balanced Latin Square counterbalancing for Part 1 conditions.
 */
const PART1_LATIN_SQUARE: Part1Condition[][] = [
  ['MONO_BASELINE', 'STEREO_BASELINE', 'SPATIAL_3D'],
  ['STEREO_BASELINE', 'SPATIAL_3D', 'MONO_BASELINE'],
  ['SPATIAL_3D', 'MONO_BASELINE', 'STEREO_BASELINE']
];

export function getPart1ConditionOrder(participantId: string): Part1Condition[] {
  const num = parseParticipantNumber(participantId);
  const row = Math.abs(num) % PART1_LATIN_SQUARE.length;
  return [...PART1_LATIN_SQUARE[row]];
}

/**
 * 2x2 Counterbalancing for Part 2 conditions.
 */
const PART2_ORDERS: Part2Condition[][] = [
  ['TRADITIONAL_PERSISTENT', 'GAZE_CONTINGENT_3D'],
  ['GAZE_CONTINGENT_3D', 'TRADITIONAL_PERSISTENT']
];

export function getPart2ConditionOrder(participantId: string): Part2Condition[] {
  const num = parseParticipantNumber(participantId);
  const row = Math.abs(num) % PART2_ORDERS.length;
  return [...PART2_ORDERS[row]];
}

function getZoneMetadata(zone: ProxyTarget): { azimuthDeg: number; hazardRole: HazardRole } {
  switch (zone) {
    case 'LEFT_MIRROR':
      return { azimuthDeg: -95, hazardRole: 'overtaker' };
    case 'RIGHT_MIRROR':
      return { azimuthDeg: 95, hazardRole: 'blind_spot_linger' };
    case 'REAR_MIRROR':
      return { azimuthDeg: 180, hazardRole: 'tailgater' };
    case 'FRONT_WINDSHIELD':
    default:
      return { azimuthDeg: 0, hazardRole: 'cut_in' };
  }
}

function hasThreeConsecutiveDuplicates(deck: ProxyTarget[]): boolean {
  for (let i = 2; i < deck.length; i++) {
    if (deck[i] === deck[i - 1] && deck[i] === deck[i - 2]) {
      return true;
    }
  }
  return false;
}

/**
 * Generates a balanced, deterministic trial deck for a given participant, part, and condition.
 * Every condition in Part 1 contains identical road exposure & balanced hazard counts (2L, 2R, 2B, 2F),
 * and every condition in Part 2 contains balanced hazard counts (2L, 2R, 2B).
 */
export function generateBlockSchedule(
  participantId: string,
  part: StudyPartNumber,
  condition: StudyConditionType,
  conditionOrder = 1
): ScheduledBlockPlan {
  const sessionSeed = deriveSessionSeed(participantId, part, condition);
  const rng = mulberry32(sessionSeed);

  const baseZones: ProxyTarget[] =
    part === 1
      ? ['LEFT_MIRROR', 'RIGHT_MIRROR', 'REAR_MIRROR', 'FRONT_WINDSHIELD']
      : ['LEFT_MIRROR', 'RIGHT_MIRROR', 'REAR_MIRROR'];

  const totalTrials =
    part === 1 ? STUDY_PARAMETERS.part1TrialsPerCondition : STUDY_PARAMETERS.part2TrialsPerCondition;

  const deck: ProxyTarget[] = [];
  for (let i = 0; i < totalTrials; i++) {
    deck.push(baseZones[i % baseZones.length]);
  }

  // Seeded Fisher-Yates shuffle with retry guard to prevent 3 identical consecutive cues
  for (let attempt = 0; attempt < 16; attempt++) {
    for (let i = deck.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = deck[i];
      deck[i] = deck[j];
      deck[j] = tmp;
    }
    if (!hasThreeConsecutiveDuplicates(deck)) break;
  }

  const minI = STUDY_PARAMETERS.interTrialMinMs;
  const maxI = STUDY_PARAMETERS.interTrialMaxMs;
  const centerI = (minI + maxI) / 2;

  const trials: ScheduledStudyTrial[] = deck.map((targetZone, idx) => {
    const meta = getZoneMetadata(targetZone);
    // ±350 ms seeded jitter clamped within [interTrialMinMs, interTrialMaxMs]
    const jitter = (rng() * 2 - 1) * 350;
    const interTrialDelayMs = Math.round(Math.max(minI, Math.min(maxI, centerI + jitter)));
    return {
      trialIndex: idx + 1,
      targetZone,
      threatAzimuthDeg: meta.azimuthDeg,
      interTrialDelayMs,
      hazardRole: meta.hazardRole
    };
  });

  return {
    participantId,
    part,
    condition,
    conditionOrder,
    sessionSeed,
    trials
  };
}
