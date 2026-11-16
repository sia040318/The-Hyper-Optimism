import { StudyConditionType, StudyPartNumber, SURVEY_QUESTIONS } from '../config/studyConfig';
import { StudySessionBundle, StudyTrialRecord } from '../services/StudyTelemetryService';
import { ProxyTarget } from '../types/threats';

export interface ConditionAggregateMetrics {
  condition: StudyConditionType;
  part: StudyPartNumber;
  participantCount: number;
  trialCount: number;
  accuracyPct: number;
  frontBackReversalPct: number;
  leftRightReversalPct: number;
  meanRtMs: number;
  medianRtMs: number;
  meanAlarmDurationMs: number;
  meanWastedAlarmMs: number;
  meanBeepPulses: number;
  meanEyesOffRoadMs: number;
}

export interface PairedTestResult {
  label: string;
  metricName: string;
  condA: StudyConditionType;
  condB: StudyConditionType;
  n: number;
  meanA: number;
  meanB: number;
  diff: number;
  tStat: number;
  df: number;
  pValue: number;
  cohensD: number;
}

export const ZONES_ORDER: ProxyTarget[] = [
  'LEFT_MIRROR',
  'RIGHT_MIRROR',
  'REAR_MIRROR',
  'FRONT_WINDSHIELD'
];

export function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function meanOf(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function aggregateByCondition(
  sessions: StudySessionBundle[],
  part: StudyPartNumber,
  condition: StudyConditionType
): ConditionAggregateMetrics {
  const matchingTrials: StudyTrialRecord[] = [];
  const participantsWithCond = new Set<string>();

  sessions.forEach((s) => {
    const condTrials = (s.trials || []).filter((t) => t.part === part && t.condition === condition);
    if (condTrials.length > 0) {
      participantsWithCond.add(s.participant_id);
      matchingTrials.push(...condTrials);
    }
  });

  const total = matchingTrials.length;
  const correct = matchingTrials.filter((t) => t.is_correct).length;
  const fb = matchingTrials.filter((t) => t.is_front_back_reversal).length;
  const lr = matchingTrials.filter((t) => t.is_left_right_reversal).length;
  const rts = matchingTrials
    .map((t) => t.confirmed_rt_ms)
    .filter((v): v is number => typeof v === 'number' && v >= 0);

  return {
    condition,
    part,
    participantCount: participantsWithCond.size,
    trialCount: total,
    accuracyPct: total > 0 ? Math.round((correct / total) * 1000) / 10 : 0,
    frontBackReversalPct: total > 0 ? Math.round((fb / total) * 1000) / 10 : 0,
    leftRightReversalPct: total > 0 ? Math.round((lr / total) * 1000) / 10 : 0,
    meanRtMs: Math.round(meanOf(rts)),
    medianRtMs: Math.round(medianOf(rts)),
    meanAlarmDurationMs: Math.round(meanOf(matchingTrials.map((t) => t.alarm_duration_ms))),
    meanWastedAlarmMs: Math.round(meanOf(matchingTrials.map((t) => t.wasted_alarm_ms))),
    meanBeepPulses: Math.round(meanOf(matchingTrials.map((t) => t.beep_pulse_count)) * 10) / 10,
    meanEyesOffRoadMs: Math.round(meanOf(matchingTrials.map((t) => t.eyes_off_road_ms)))
  };
}

/**
 * Builds a 4x4 directional confusion matrix for a condition across all sessions.
 */
export function buildConfusionMatrix(
  sessions: StudySessionBundle[],
  condition: StudyConditionType
): Record<ProxyTarget, Record<ProxyTarget | 'TIMEOUT', number>> {
  const emptyRow = (): Record<ProxyTarget | 'TIMEOUT', number> => ({
    LEFT_MIRROR: 0,
    RIGHT_MIRROR: 0,
    REAR_MIRROR: 0,
    FRONT_WINDSHIELD: 0,
    TIMEOUT: 0
  });

  const matrix: Record<ProxyTarget, Record<ProxyTarget | 'TIMEOUT', number>> = {
    LEFT_MIRROR: emptyRow(),
    RIGHT_MIRROR: emptyRow(),
    REAR_MIRROR: emptyRow(),
    FRONT_WINDSHIELD: emptyRow()
  };

  sessions.forEach((s) => {
    (s.trials || []).forEach((t) => {
      if (t.condition === condition && matrix[t.target_zone]) {
        const resp = t.response_zone || 'TIMEOUT';
        matrix[t.target_zone][resp] = (matrix[t.target_zone][resp] || 0) + 1;
      }
    });
  });

  return matrix;
}

/**
 * Normal CDF approximation for large df or numerical integration for exact Student's t two-tailed p-value.
 */
function studentTTwoTailedP(absT: number, df: number): number {
  if (df <= 0 || !Number.isFinite(absT)) return 1.0;
  if (absT === 0) return 1.0;
  // Numerical Simpson integration of Student-t PDF from 0 to absT
  const gammaRatio = (d: number): number => {
    // Log-gamma Stirling/Lanczos for clean small-df accuracy
    const logGamma = (z: number): number => {
      const p = [
        676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
        12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7
      ];
      if (z < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * z)) - logGamma(1 - z);
      z -= 1;
      let x = 0.99999999999980993;
      for (let i = 0; i < p.length; i++) x += p[i] / (z + i + 1);
      const t = z + p.length - 0.5;
      return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(x);
    };
    return Math.exp(logGamma((d + 1) / 2) - logGamma(d / 2)) / Math.sqrt(d * Math.PI);
  };

  const c = gammaRatio(df);
  const pdf = (x: number) => c * Math.pow(1 + (x * x) / df, -(df + 1) / 2);
  const steps = 200;
  const upper = Math.min(absT, 30);
  const h = upper / steps;
  let sum = pdf(0) + pdf(upper);
  for (let i = 1; i < steps; i++) {
    sum += (i % 2 === 0 ? 2 : 4) * pdf(i * h);
  }
  const oneTailTail = Math.max(0, 0.5 - (h / 3) * sum);
  return Math.min(1, Math.max(0.0001, 2 * oneTailTail));
}

export function computePairedComparison(
  sessions: StudySessionBundle[],
  label: string,
  metricName: string,
  part: StudyPartNumber,
  condA: StudyConditionType,
  condB: StudyConditionType,
  extractor: (trials: StudyTrialRecord[]) => number | null
): PairedTestResult {
  const pairs: Array<[number, number]> = [];
  sessions.forEach((s) => {
    const aTrials = (s.trials || []).filter((t) => t.part === part && t.condition === condA);
    const bTrials = (s.trials || []).filter((t) => t.part === part && t.condition === condB);
    if (aTrials.length > 0 && bTrials.length > 0) {
      const va = extractor(aTrials);
      const vb = extractor(bTrials);
      if (va !== null && vb !== null) {
        pairs.push([va, vb]);
      }
    }
  });

  const n = pairs.length;
  if (n < 2) {
    return {
      label,
      metricName,
      condA,
      condB,
      n,
      meanA: pairs.length ? pairs[0][0] : 0,
      meanB: pairs.length ? pairs[0][1] : 0,
      diff: pairs.length ? pairs[0][1] - pairs[0][0] : 0,
      tStat: 0,
      df: 0,
      pValue: 1,
      cohensD: 0
    };
  }

  const diffs = pairs.map(([a, b]) => b - a);
  const meanA = meanOf(pairs.map(([a]) => a));
  const meanB = meanOf(pairs.map(([, b]) => b));
  const meanDiff = meanOf(diffs);
  const variance = diffs.reduce((acc, d) => acc + Math.pow(d - meanDiff, 2), 0) / (n - 1);
  const sd = Math.sqrt(variance);
  const se = sd / Math.sqrt(n);
  const tStat = se > 1e-9 ? meanDiff / se : 0;
  const cohensD = sd > 1e-9 ? meanDiff / sd : 0;
  const pValue = studentTTwoTailedP(Math.abs(tStat), n - 1);

  return {
    label,
    metricName,
    condA,
    condB,
    n,
    meanA: Math.round(meanA * 10) / 10,
    meanB: Math.round(meanB * 10) / 10,
    diff: Math.round(meanDiff * 10) / 10,
    tStat: Math.round(tStat * 100) / 100,
    df: n - 1,
    pValue: Math.round(pValue * 10000) / 10000,
    cohensD: Math.round(cohensD * 100) / 100
  };
}

export interface SurveyQuestionAggregate {
  questionId: string;
  category: string;
  prompt: string;
  lowerIsBetter: boolean;
  byCondition: Record<
    string,
    {
      n: number;
      initialMean: number;
      finalMean: number;
      meanDelta: number;
    }
  >;
}

export function aggregateSurveys(
  sessions: StudySessionBundle[],
  part: StudyPartNumber,
  conditions: StudyConditionType[]
): SurveyQuestionAggregate[] {
  const qs = SURVEY_QUESTIONS.filter((q) => q.applicableParts.includes(part));
  return qs.map((q) => {
    const byCondition: SurveyQuestionAggregate['byCondition'] = {};
    conditions.forEach((cond) => {
      const matching = sessions.flatMap((s) =>
        (s.surveys || []).filter(
          (sr) => sr.part === part && sr.question_id === q.id && sr.condition === cond
        )
      );
      byCondition[cond] = {
        n: matching.length,
        initialMean: Math.round(meanOf(matching.map((m) => m.initial_score)) * 100) / 100,
        finalMean: Math.round(meanOf(matching.map((m) => m.final_score)) * 100) / 100,
        meanDelta: Math.round(meanOf(matching.map((m) => m.score_delta)) * 100) / 100
      };
    });
    return {
      questionId: q.id,
      category: q.category,
      prompt: q.prompt,
      lowerIsBetter: Boolean(q.lowerIsBetter),
      byCondition
    };
  });
}
