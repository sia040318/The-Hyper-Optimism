import {
  Part1Condition,
  Part2Condition,
  STUDY_PARAMETERS,
  StudyConditionType,
  StudyPartNumber
} from '../config/studyConfig';
import { ProxyTarget } from '../types/threats';

export interface StudyTrialRecord {
  participant_id: string;
  session_seed: number;
  part: StudyPartNumber;
  condition: StudyConditionType;
  condition_order: number;
  trial_index: number;
  target_zone: ProxyTarget;
  threat_azimuth_deg: number;
  onset_timestamp_ms: number;
  first_response_ms: number | null;
  confirmed_rt_ms: number | null;
  response_zone: ProxyTarget | 'TIMEOUT';
  is_correct: boolean;
  is_front_back_reversal: boolean;
  is_left_right_reversal: boolean;
  wrong_attempts_count: number;
  alarm_duration_ms: number;
  wasted_alarm_ms: number;
  beep_pulse_count: number;
  eyes_off_road_ms: number;
  cv_confidence_avg: number;
  timestamp_iso: string;
}

export interface StudySurveyRecord {
  participant_id: string;
  part: StudyPartNumber;
  question_id: string;
  condition: StudyConditionType;
  condition_order: number;
  initial_score: number;
  final_score: number;
  score_delta: number;
  timestamp_iso: string;
}

export interface StudyHardwareInfo {
  audio_output_device: string;
  webcam_label: string;
  webcam_fps_avg: number;
  cv_confidence_avg: number;
  input_mode: 'WEBCAM_MEDIAPIPE' | 'SIMULATION_FALLBACK';
  user_agent: string;
}

export type SyncStatus = 'SYNCED' | 'PENDING' | 'LOCAL_FALLBACK';

export interface StudySessionBundle {
  participant_id: string;
  created_at: string;
  updated_at: string;
  hardware_info: StudyHardwareInfo;
  part1_condition_order: Part1Condition[];
  part2_condition_order: Part2Condition[];
  part1_completed: boolean;
  part2_completed: boolean;
  completed_blocks: string[];
  trials: StudyTrialRecord[];
  surveys: StudySurveyRecord[];
  sync_status: SyncStatus;
  last_sync_error?: string;
  s3_key?: string;
}

const LOCAL_STORAGE_KEY = 'aura_hci_study_sessions_v1';

export function isValidParticipantId(pid: string): boolean {
  return /^P_\d{2,3}$/.test(pid.trim());
}

/**
 * Normalizes flexible inputs like "1", "p1", "P_1", "12" into canonical "P_01", "P_12", etc.
 */
export function normalizeParticipantId(raw: string): string {
  const cleaned = raw.trim().toUpperCase();
  const match = cleaned.match(/^(?:P_?)?(\d{1,3})$/);
  if (!match) return cleaned;
  const num = parseInt(match[1], 10);
  if (Number.isNaN(num)) return cleaned;
  if (num < 100) {
    return `P_${String(num).padStart(2, '0')}`;
  }
  return `P_${num}`;
}

export function loadAllLocalSessions(): StudySessionBundle[] {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed;
    return [];
  } catch {
    return [];
  }
}

export function loadLocalSession(participantId: string): StudySessionBundle | null {
  const all = loadAllLocalSessions();
  return all.find((s) => s.participant_id === participantId) || null;
}

export function hasLocalSession(participantId: string): boolean {
  return loadLocalSession(participantId) !== null;
}

/**
 * Suggests the next unused Participant ID (P_01..P_999) based on local browser sessions,
 * ignoring synthetic P_00 self-test sessions.
 */
export function suggestNextParticipantId(): string {
  const usedNums = new Set<number>();
  loadAllLocalSessions().forEach((s) => {
    const m = s.participant_id.match(/^P_(\d{2,3})$/);
    if (m) {
      const n = parseInt(m[1], 10);
      if (n >= 1) usedNums.add(n);
    }
  });
  let candidate = 1;
  while (usedNums.has(candidate) && candidate < 999) {
    candidate += 1;
  }
  return candidate < 100 ? `P_${String(candidate).padStart(2, '0')}` : `P_${candidate}`;
}

export function saveSessionLocally(bundle: StudySessionBundle): void {
  try {
    const all = loadAllLocalSessions();
    const idx = all.findIndex((s) => s.participant_id === bundle.participant_id);
    const updated: StudySessionBundle = {
      ...bundle,
      updated_at: new Date().toISOString()
    };
    if (idx >= 0) {
      all[idx] = updated;
    } else {
      all.push(updated);
    }
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(all));
  } catch (err) {
    console.warn('[StudyTelemetry] Failed to write localStorage:', err);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CloudSyncResult {
  ok: boolean;
  s3Key?: string;
  error?: string;
}

/**
 * Incrementally POSTs completed block telemetry & surveys to AWS API Gateway (`POST /ingest`)
 * with 2 automatic retries before falling back to local backup mode.
 */
export async function syncBlockToCloud(
  bundle: StudySessionBundle,
  part: StudyPartNumber,
  blockCondition: StudyConditionType,
  studyPasscode: string
): Promise<CloudSyncResult> {
  saveSessionLocally({ ...bundle, sync_status: 'PENDING' });

  const baseUrl = STUDY_PARAMETERS.apiBaseUrl.replace(/\/+$/, '');
  if (!baseUrl) {
    const errMsg = 'Study API endpoint (VITE_STUDY_API_URL) is not configured in this build.';
    saveSessionLocally({ ...bundle, sync_status: 'LOCAL_FALLBACK', last_sync_error: errMsg });
    return { ok: false, error: errMsg };
  }

  const blockTrials = bundle.trials.filter((t) => t.part === part && t.condition === blockCondition);
  const blockSurveys = bundle.surveys.filter((s) => s.part === part && s.condition === blockCondition);

  const correctCount = blockTrials.filter((t) => t.is_correct).length;
  const accuracyPct = blockTrials.length > 0 ? (correctCount / blockTrials.length) * 100 : 0;
  const rts = blockTrials
    .map((t) => t.confirmed_rt_ms)
    .filter((v): v is number => typeof v === 'number' && v >= 0);
  const meanRtMs = rts.length > 0 ? Math.round(rts.reduce((a, b) => a + b, 0) / rts.length) : 0;
  const meanAlarmMs =
    blockTrials.length > 0
      ? Math.round(blockTrials.reduce((a, b) => a + b.alarm_duration_ms, 0) / blockTrials.length)
      : 0;
  const meanWastedMs =
    blockTrials.length > 0
      ? Math.round(blockTrials.reduce((a, b) => a + b.wasted_alarm_ms, 0) / blockTrials.length)
      : 0;

  const payload = {
    participant_id: bundle.participant_id,
    part,
    condition: blockCondition,
    block_key: `PART${part}#${blockCondition}`,
    summary: {
      total_trials: blockTrials.length,
      correct_trials: correctCount,
      accuracy_pct: Math.round(accuracyPct * 10) / 10,
      mean_rt_ms: meanRtMs,
      mean_alarm_duration_ms: meanAlarmMs,
      mean_wasted_alarm_ms: meanWastedMs,
      webcam_fps_avg: bundle.hardware_info.webcam_fps_avg,
      cv_confidence_avg: bundle.hardware_info.cv_confidence_avg,
      survey_count: blockSurveys.length
    },
    session_bundle: bundle
  };

  let lastError = 'Unknown network error';
  const retryDelays = [600, 1400];

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const resp = await fetch(`${baseUrl}/ingest`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-study-token': studyPasscode
        },
        body: JSON.stringify(payload)
      });

      if (!resp.ok) {
        const errBody = await resp.text();
        throw new Error(`HTTP ${resp.status}: ${errBody || resp.statusText}`);
      }

      const data = (await resp.json()) as { ok?: boolean; s3_key?: string };
      saveSessionLocally({
        ...bundle,
        sync_status: 'SYNCED',
        last_sync_error: undefined,
        s3_key: data.s3_key || bundle.s3_key
      });
      return { ok: true, s3Key: data.s3_key };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      if (attempt < retryDelays.length) {
        await delay(retryDelays[attempt]);
      }
    }
  }

  saveSessionLocally({
    ...bundle,
    sync_status: 'LOCAL_FALLBACK',
    last_sync_error: lastError
  });
  return { ok: false, error: lastError };
}

export function triggerFileDownload(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadSessionJson(bundle: StudySessionBundle) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  triggerFileDownload(
    `aura_study_${bundle.participant_id}_${stamp}.json`,
    JSON.stringify(bundle, null, 2),
    'application/json'
  );
}

function escapeCsv(val: unknown): string {
  if (val === null || val === undefined) return '';
  const str = String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function exportAllToTrialsCsv(sessions: StudySessionBundle[]): string {
  const headers = [
    'participant_id',
    'session_seed',
    'part',
    'condition',
    'condition_order',
    'trial_index',
    'target_zone',
    'threat_azimuth_deg',
    'onset_timestamp_ms',
    'first_response_ms',
    'confirmed_rt_ms',
    'response_zone',
    'is_correct',
    'is_front_back_reversal',
    'is_left_right_reversal',
    'wrong_attempts_count',
    'alarm_duration_ms',
    'wasted_alarm_ms',
    'beep_pulse_count',
    'eyes_off_road_ms',
    'cv_confidence_avg',
    'audio_output_device',
    'webcam_fps_avg',
    'timestamp_iso'
  ];

  const rows: string[] = [headers.join(',')];
  sessions.forEach((s) => {
    const dev = s.hardware_info?.audio_output_device || '';
    const fps = s.hardware_info?.webcam_fps_avg ?? '';
    (s.trials || []).forEach((t) => {
      rows.push(
        [
          t.participant_id,
          t.session_seed,
          t.part,
          t.condition,
          t.condition_order,
          t.trial_index,
          t.target_zone,
          t.threat_azimuth_deg,
          t.onset_timestamp_ms,
          t.first_response_ms,
          t.confirmed_rt_ms,
          t.response_zone,
          t.is_correct ? 1 : 0,
          t.is_front_back_reversal ? 1 : 0,
          t.is_left_right_reversal ? 1 : 0,
          t.wrong_attempts_count,
          t.alarm_duration_ms,
          t.wasted_alarm_ms,
          t.beep_pulse_count,
          t.eyes_off_road_ms,
          t.cv_confidence_avg,
          dev,
          fps,
          t.timestamp_iso
        ]
          .map(escapeCsv)
          .join(',')
      );
    });
  });

  return rows.join('\n');
}

export function exportAllToSurveysCsv(sessions: StudySessionBundle[]): string {
  const headers = [
    'participant_id',
    'part',
    'question_id',
    'condition',
    'condition_order',
    'initial_score',
    'final_score',
    'score_delta',
    'timestamp_iso'
  ];

  const rows: string[] = [headers.join(',')];
  sessions.forEach((s) => {
    (s.surveys || []).forEach((q) => {
      rows.push(
        [
          q.participant_id,
          q.part,
          q.question_id,
          q.condition,
          q.condition_order,
          q.initial_score,
          q.final_score,
          q.score_delta,
          q.timestamp_iso
        ]
          .map(escapeCsv)
          .join(',')
      );
    });
  });

  return rows.join('\n');
}
