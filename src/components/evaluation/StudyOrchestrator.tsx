import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  CONDITION_META,
  Part1Condition,
  Part2Condition,
  STUDY_PARAMETERS,
  SURVEY_QUESTIONS,
  StudyConditionType,
  StudyPartNumber
} from '../../config/studyConfig';
import { SpatialAudioEngine } from '../../audio/SpatialAudioEngine';
import { GameWindowHandle } from '../../game';
import { inBrowserVision } from '../../services/InBrowserVisionService';
import {
  ScheduledBlockPlan,
  generateBlockSchedule,
  getPart1ConditionOrder,
  getPart2ConditionOrder
} from '../../services/DeterministicStudyDirector';
import {
  StudyHardwareInfo,
  StudySessionBundle,
  StudySurveyRecord,
  StudyTrialRecord,
  downloadSessionJson,
  exportAllToTrialsCsv,
  isValidParticipantId,
  saveSessionLocally,
  syncBlockToCloud,
  triggerFileDownload
} from '../../services/StudyTelemetryService';
import { ProgressiveSurveyModal } from './ProgressiveSurveyModal';
import { GazeZone, InBrowserVisionDiagnostics } from '../../types/gaze';
import { ProxyTarget } from '../../types/threats';
import {
  Activity,
  AlertTriangle,
  Camera,
  CheckCircle2,
  Cloud,
  CloudOff,
  Download,
  Eye,
  Headphones,
  Play,
  RefreshCw,
  ShieldCheck,
  Volume2,
  X
} from 'lucide-react';

export type StudyVisualMode = 'OFF' | 'PART1_BLIND_AUDIO' | 'PART2_MIRROR_HAZARD';

interface StudyOrchestratorProps {
  isOpen: boolean;
  onClose: () => void;
  initialPasscode?: string;
  initialParticipantId?: string;
  audioEngine: SpatialAudioEngine;
  gameWindowRef: React.RefObject<GameWindowHandle | null>;
  currentGaze: GazeZone;
  onSimulateGaze: (zone: GazeZone, force?: boolean) => void;
  onAudioActiveChange: (active: boolean) => void;
  onStudyVisualModeChange: (mode: StudyVisualMode) => void;
  onOpenLegacySandboxStudy?: () => void;
}

type OrchestratorPhase =
  | 'STEP0_GATE'
  | 'PART1_READY'
  | 'PART1_RUNNING'
  | 'PART1_TRANSITION'
  | 'PART2_READY'
  | 'PART2_RUNNING'
  | 'STUDY_COMPLETE';

type TrialSubState = 'INTER_TRIAL' | 'AWAITING_RESPONSE' | 'TRIAL_FEEDBACK';

function getDirectionFromKey(key: string): ProxyTarget | null {
  if (key === 'w' || key === 'W' || key === 'ArrowUp' || key === '2') return 'FRONT_WINDSHIELD';
  if (key === 's' || key === 'S' || key === 'ArrowDown' || key === '4') return 'REAR_MIRROR';
  if (key === 'a' || key === 'A' || key === 'ArrowLeft' || key === '1') return 'LEFT_MIRROR';
  if (key === 'd' || key === 'D' || key === 'ArrowRight' || key === '3') return 'RIGHT_MIRROR';
  return null;
}

function getMirrorKeyGaze(key: string): GazeZone | null {
  if (key === '1' || key === 'a' || key === 'A' || key === 'ArrowLeft') return 'LEFT_MIRROR';
  if (key === '3' || key === 'd' || key === 'D' || key === 'ArrowRight') return 'RIGHT_MIRROR';
  if (key === '4' || key === 's' || key === 'S' || key === 'ArrowDown') return 'REAR_MIRROR';
  if (key === '2' || key === '0') return 'CENTER';
  return null;
}

export const StudyOrchestrator: React.FC<StudyOrchestratorProps> = ({
  isOpen,
  onClose,
  initialPasscode,
  initialParticipantId,
  audioEngine,
  gameWindowRef,
  currentGaze,
  onSimulateGaze,
  onAudioActiveChange,
  onStudyVisualModeChange,
  onOpenLegacySandboxStudy
}) => {
  // Participant & Passcode State
  const [participantId, setParticipantId] = useState(
    initialParticipantId && isValidParticipantId(initialParticipantId) ? initialParticipantId : 'P_01'
  );
  const [studyPasscode, setStudyPasscode] = useState(
    initialPasscode || STUDY_PARAMETERS.defaultStudyPasscode
  );
  const [phase, setPhase] = useState<OrchestratorPhase>('STEP0_GATE');

  // Step 0 Calibration Gate State
  const [audioOutputLabel, setAudioOutputLabel] = useState('Default Stereo Output');
  const [leftEarTested, setLeftEarTested] = useState(false);
  const [rightEarTested, setRightEarTested] = useState(false);
  const [stereoConfirmed, setStereoConfirmed] = useState(false);

  const [isWebcamRunning, setIsWebcamRunning] = useState(false);
  const [webcamLabel, setWebcamLabel] = useState('In-Browser Webcam (MediaPipe)');
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const [useSimFallback, setUseSimFallback] = useState(false);
  const [visionDiag, setVisionDiag] = useState<InBrowserVisionDiagnostics | null>(null);
  const [faceDetectedNow, setFaceDetectedNow] = useState(false);

  // Practice Round State (10s interactive check)
  const [isPracticeActive, setIsPracticeActive] = useState(false);
  const [practiceSecondsLeft, setPracticeSecondsLeft] = useState(10);
  const [practiceKeyDone, setPracticeKeyDone] = useState(false);
  const [practiceGazeDone, setPracticeGazeDone] = useState(false);
  const [practiceComplete, setPracticeComplete] = useState(false);

  // Study Schedule & Block State
  const [part1Order, setPart1Order] = useState<Part1Condition[]>(() =>
    getPart1ConditionOrder(participantId)
  );
  const [part2Order, setPart2Order] = useState<Part2Condition[]>(() =>
    getPart2ConditionOrder(participantId)
  );
  const [part1BlockIdx, setPart1BlockIdx] = useState(0);
  const [part2BlockIdx, setPart2BlockIdx] = useState(0);

  const [activePlan, setActivePlan] = useState<ScheduledBlockPlan | null>(null);
  const [currentTrialIdx, setCurrentTrialIdx] = useState(0);
  const [trialSubState, setTrialSubState] = useState<TrialSubState>('INTER_TRIAL');
  const [showGazeFallbackPrompt, setShowGazeFallbackPrompt] = useState(false);
  const [statusBanner, setStatusBanner] = useState<string>('Stand by...');

  // Progressive Survey State
  const [surveyModalOpen, setSurveyModalOpen] = useState(false);
  const [surveyPart, setSurveyPart] = useState<StudyPartNumber>(1);
  const [surveyCompletedConds, setSurveyCompletedConds] = useState<StudyConditionType[]>([]);
  const [initialScoresMap, setInitialScoresMap] = useState<
    Record<StudyPartNumber, Record<string, Record<string, number>>>
  >({ 1: {}, 2: {} });
  const [currentScoresMap, setCurrentScoresMap] = useState<
    Record<StudyPartNumber, Record<string, Record<string, number>>>
  >({ 1: {}, 2: {} });

  // Session & Sync Telemetry
  const [sessionBundle, setSessionBundle] = useState<StudySessionBundle | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Persistent Webcam Video & Overlay Refs (never unmounted while Orchestrator is open)
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  // Trial Timing & CV Sampling Refs
  const timerIdsRef = useRef<number[]>([]);
  const trialOnsetPerfRef = useRef<number>(0);
  const trialFirstRespMsRef = useRef<number | null>(null);
  const trialWrongAttemptsRef = useRef<number>(0);
  const trialConfidenceSamplesRef = useRef<number[]>([]);
  const trialFpsSamplesRef = useRef<number[]>([]);
  const trialEyesOffRoadMsRef = useRef<number>(0);
  const lastSamplePerfRef = useRef<number>(0);
  const trialResolvedRef = useRef<boolean>(false);
  const part2ConfirmedRtRef = useRef<number | null>(null);
  const currentGazeRef = useRef<GazeZone>(currentGaze);
  const activePlanRef = useRef<ScheduledBlockPlan | null>(null);
  const currentTrialIdxRef = useRef<number>(0);
  const trialSubStateRef = useRef<TrialSubState>('INTER_TRIAL');
  const sessionBundleRef = useRef<StudySessionBundle | null>(null);
  const phaseRef = useRef<OrchestratorPhase>(phase);

  useEffect(() => {
    currentGazeRef.current = currentGaze;
  }, [currentGaze]);

  useEffect(() => {
    activePlanRef.current = activePlan;
  }, [activePlan]);

  useEffect(() => {
    currentTrialIdxRef.current = currentTrialIdx;
  }, [currentTrialIdx]);

  useEffect(() => {
    trialSubStateRef.current = trialSubState;
  }, [trialSubState]);

  useEffect(() => {
    sessionBundleRef.current = sessionBundle;
  }, [sessionBundle]);

  useEffect(() => {
    phaseRef.current = phase;
  }, [phase]);

  // Keep orders updated when participantId changes in Step 0
  useEffect(() => {
    setPart1Order(getPart1ConditionOrder(participantId));
    setPart2Order(getPart2ConditionOrder(participantId));
  }, [participantId]);

  const clearAllTimers = useCallback(() => {
    timerIdsRef.current.forEach((id) => {
      clearTimeout(id);
      clearInterval(id);
    });
    timerIdsRef.current = [];
  }, []);

  const scheduleTimeout = useCallback((fn: () => void, ms: number): number => {
    const id = window.setTimeout(fn, ms);
    timerIdsRef.current.push(id);
    return id;
  }, []);

  // Detect Audio Output & Video Devices on mount
  useEffect(() => {
    if (!isOpen) return;
    if (navigator.mediaDevices?.enumerateDevices) {
      navigator.mediaDevices
        .enumerateDevices()
        .then((devices) => {
          const audioOut = devices.find((d) => d.kind === 'audiooutput' && d.label);
          if (audioOut?.label) setAudioOutputLabel(audioOut.label);
          const videoIn = devices.find((d) => d.kind === 'videoinput' && d.label);
          if (videoIn?.label) setWebcamLabel(videoIn.label);
        })
        .catch(() => {});
    }
  }, [isOpen]);

  // Subscribe to InBrowserVision telemetry when orchestrator is open
  useEffect(() => {
    if (!isOpen) return;
    setIsWebcamRunning(inBrowserVision.getIsRunning());

    const unsub = inBrowserVision.subscribe((msg) => {
      setFaceDetectedNow(msg.face_detected);
      if (msg.diagnostics) {
        setVisionDiag(msg.diagnostics);
      }

      // Accumulate CV metrics during active trials
      if (
        (phaseRef.current === 'PART1_RUNNING' || phaseRef.current === 'PART2_RUNNING') &&
        trialSubStateRef.current === 'AWAITING_RESPONSE'
      ) {
        const now = performance.now();
        const dt = lastSamplePerfRef.current > 0 ? Math.min(120, now - lastSamplePerfRef.current) : 0;
        lastSamplePerfRef.current = now;

        if (msg.face_detected) {
          trialConfidenceSamplesRef.current.push(msg.confidence);
        } else {
          trialConfidenceSamplesRef.current.push(0);
        }
        if (msg.diagnostics?.fps) {
          trialFpsSamplesRef.current.push(msg.diagnostics.fps);
        }
        if (msg.gaze_zone !== 'CENTER' && dt > 0) {
          trialEyesOffRoadMsRef.current += dt;
        }
      }
    });

    let rafId: number;
    const drawOverlay = () => {
      if (inBrowserVision.getIsRunning() && canvasRef.current && videoRef.current) {
        const v = videoRef.current;
        const c = canvasRef.current;
        if (v.videoWidth > 0 && v.videoHeight > 0) {
          if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
            c.width = v.videoWidth;
            c.height = v.videoHeight;
          }
          inBrowserVision.drawDebugOverlay(c);
        }
      }
      rafId = requestAnimationFrame(drawOverlay);
    };
    rafId = requestAnimationFrame(drawOverlay);

    return () => {
      unsub();
      cancelAnimationFrame(rafId);
    };
  }, [isOpen]);

  // Cleanup when Orchestrator closes
  useEffect(() => {
    if (!isOpen) {
      clearAllTimers();
      audioEngine.stopStudyTrialAlert();
      audioEngine.setStudyAudioMode(null);
      onStudyVisualModeChange('OFF');
      gameWindowRef.current?.setStudyAutopilotMode(false, false);
    }
  }, [isOpen, clearAllTimers, audioEngine, onStudyVisualModeChange, gameWindowRef]);

  const handleStartWebcam = async () => {
    setWebcamError(null);
    if (!videoRef.current) return;
    if (inBrowserVision.getIsRunning()) {
      setIsWebcamRunning(true);
      return;
    }
    const ok = await inBrowserVision.start(videoRef.current);
    if (ok) {
      setIsWebcamRunning(true);
      setUseSimFallback(false);
      // Refresh device label after permission grant
      navigator.mediaDevices
        ?.enumerateDevices()
        .then((devices) => {
          const v = devices.find((d) => d.kind === 'videoinput' && d.label);
          if (v?.label) setWebcamLabel(v.label);
          const a = devices.find((d) => d.kind === 'audiooutput' && d.label);
          if (a?.label) setAudioOutputLabel(a.label);
        })
        .catch(() => {});
    } else {
      setWebcamError(
        'Webcam access blocked or unavailable. You may enable Keyboard/Click Simulation Fallback below.'
      );
    }
  };

  // 10s Interactive Practice Round
  const handleStartPractice = async () => {
    await audioEngine.start();
    onAudioActiveChange(true);
    audioEngine.setStudyAudioMode('SPATIAL_3D');
    setIsPracticeActive(true);
    setPracticeSecondsLeft(Math.round(STUDY_PARAMETERS.practiceDurationMs / 1000));
    setPracticeKeyDone(false);
    setPracticeGazeDone(false);
    setPracticeComplete(false);

    // Play a gentle directional sample cue
    audioEngine.testDirection('LEFT_MIRROR');

    const startTime = Date.now();
    const interval = window.setInterval(() => {
      const elapsed = Date.now() - startTime;
      const rem = Math.max(0, Math.ceil((STUDY_PARAMETERS.practiceDurationMs - elapsed) / 1000));
      setPracticeSecondsLeft(rem);
      if (elapsed >= STUDY_PARAMETERS.practiceDurationMs) {
        clearInterval(interval);
        setIsPracticeActive(false);
        setPracticeComplete(true);
      }
    }, 250);
    timerIdsRef.current.push(interval);
  };

  // Track Practice Round responses (WASD + Gaze dwell)
  useEffect(() => {
    if (!isPracticeActive) return;
    if (currentGaze === 'LEFT_MIRROR' || currentGaze === 'RIGHT_MIRROR' || currentGaze === 'REAR_MIRROR') {
      if (!practiceGazeDone) {
        audioEngine.playAcknowledgeEarcon();
        setPracticeGazeDone(true);
      }
    }
  }, [isPracticeActive, currentGaze, practiceGazeDone, audioEngine]);

  useEffect(() => {
    if (!isPracticeActive) return;
    const onKey = (e: KeyboardEvent) => {
      if (getDirectionFromKey(e.key)) {
        e.preventDefault();
        setPracticeKeyDone(true);
      }
      const gaze = getMirrorKeyGaze(e.key);
      if (gaze && useSimFallback) {
        onSimulateGaze(gaze);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isPracticeActive, useSimFallback, onSimulateGaze]);

  // --- INITIALIZE STUDY SESSION & ENTER PART 1 ---
  const handleBeginEmpiricalStudy = async () => {
    const cleanPid = participantId.trim().toUpperCase();
    if (!isValidParticipantId(cleanPid)) return;

    await audioEngine.start();
    onAudioActiveChange(true);
    audioEngine.stopStudyTrialAlert();

    const p1Order = getPart1ConditionOrder(cleanPid);
    const p2Order = getPart2ConditionOrder(cleanPid);
    setPart1Order(p1Order);
    setPart2Order(p2Order);

    const hardwareInfo: StudyHardwareInfo = {
      audio_output_device: audioOutputLabel,
      webcam_label: isWebcamRunning ? webcamLabel : 'Simulation Fallback',
      webcam_fps_avg: visionDiag?.fps || 0,
      cv_confidence_avg: isWebcamRunning ? 0.96 : 1.0,
      input_mode: isWebcamRunning ? 'WEBCAM_MEDIAPIPE' : 'SIMULATION_FALLBACK',
      user_agent: navigator.userAgent
    };

    const initialBundle: StudySessionBundle = {
      participant_id: cleanPid,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      hardware_info: hardwareInfo,
      part1_condition_order: p1Order,
      part2_condition_order: p2Order,
      part1_completed: false,
      part2_completed: false,
      completed_blocks: [],
      trials: [],
      surveys: [],
      sync_status: 'PENDING'
    };

    saveSessionLocally(initialBundle);
    setSessionBundle(initialBundle);
    setPart1BlockIdx(0);
    setPart2BlockIdx(0);
    setInitialScoresMap({ 1: {}, 2: {} });
    setCurrentScoresMap({ 1: {}, 2: {} });

    onStudyVisualModeChange('PART1_BLIND_AUDIO');
    gameWindowRef.current?.setStudyAutopilotMode(true, true);
    setPhase('PART1_READY');
  };

  // --- PART 1 EXECUTION ---
  const startPart1Block = (blockIndex: number) => {
    const cond = part1Order[blockIndex];
    const plan = generateBlockSchedule(
      sessionBundleRef.current?.participant_id || participantId,
      1,
      cond,
      blockIndex + 1
    );
    clearAllTimers();
    setActivePlan(plan);
    activePlanRef.current = plan;
    setCurrentTrialIdx(0);
    currentTrialIdxRef.current = 0;

    audioEngine.setStudyAudioMode(cond);
    onStudyVisualModeChange('PART1_BLIND_AUDIO');
    gameWindowRef.current?.setStudyAutopilotMode(true, true);
    gameWindowRef.current?.clearStudyHazards(false);

    setPhase('PART1_RUNNING');
    runPart1Trial(plan, 0);
  };

  const runPart1Trial = (plan: ScheduledBlockPlan, idx: number) => {
    if (idx >= plan.trials.length) {
      finishBlockAndOpenSurvey(plan);
      return;
    }

    clearAllTimers();
    const trial = plan.trials[idx];
    setCurrentTrialIdx(idx);
    currentTrialIdxRef.current = idx;
    setTrialSubState('INTER_TRIAL');
    trialSubStateRef.current = 'INTER_TRIAL';
    trialResolvedRef.current = false;
    trialFirstRespMsRef.current = null;
    trialWrongAttemptsRef.current = 0;
    trialConfidenceSamplesRef.current = [];
    trialFpsSamplesRef.current = [];
    trialEyesOffRoadMsRef.current = 0;
    lastSamplePerfRef.current = 0;

    setStatusBanner(`Cruising at 100 km/h • Listen for hazard cue (${idx + 1}/${plan.trials.length})...`);
    audioEngine.stopStudyTrialAlert();

    scheduleTimeout(() => {
      if (phaseRef.current !== 'PART1_RUNNING') return;
      trialOnsetPerfRef.current = performance.now();
      lastSamplePerfRef.current = trialOnsetPerfRef.current;
      setTrialSubState('AWAITING_RESPONSE');
      trialSubStateRef.current = 'AWAITING_RESPONSE';
      setStatusBanner('⚡ IDENTIFY DIRECTION NOW: W / A / S / D or Arrow Keys');

      audioEngine.triggerStudyTrialAlert(trial.targetZone, 7.5);

      // Timeout guard
      scheduleTimeout(() => {
        if (!trialResolvedRef.current && trialSubStateRef.current === 'AWAITING_RESPONSE') {
          completePart1Trial('TIMEOUT');
        }
      }, STUDY_PARAMETERS.part1ResponseTimeoutMs);
    }, trial.interTrialDelayMs);
  };

  const completePart1Trial = useCallback(
    (response: ProxyTarget | 'TIMEOUT') => {
      const plan = activePlanRef.current;
      if (!plan || trialResolvedRef.current || trialSubStateRef.current !== 'AWAITING_RESPONSE') return;

      trialResolvedRef.current = true;
      clearAllTimers();
      audioEngine.stopStudyTrialAlert();

      const idx = currentTrialIdxRef.current;
      const trial = plan.trials[idx];
      const rtMs =
        response === 'TIMEOUT'
          ? null
          : Math.max(40, Math.round(performance.now() - trialOnsetPerfRef.current));
      const isCorrect = response === trial.targetZone;
      const isFrontBackRev =
        (trial.targetZone === 'FRONT_WINDSHIELD' && response === 'REAR_MIRROR') ||
        (trial.targetZone === 'REAR_MIRROR' && response === 'FRONT_WINDSHIELD');
      const isLeftRightRev =
        (trial.targetZone === 'LEFT_MIRROR' && response === 'RIGHT_MIRROR') ||
        (trial.targetZone === 'RIGHT_MIRROR' && response === 'LEFT_MIRROR');

      const confSamples = trialConfidenceSamplesRef.current;
      const cvAvg =
        confSamples.length > 0
          ? Math.round((confSamples.reduce((a, b) => a + b, 0) / confSamples.length) * 100) / 100
          : isWebcamRunning
          ? 0.95
          : 1.0;

      const record: StudyTrialRecord = {
        participant_id: plan.participantId,
        session_seed: plan.sessionSeed,
        part: 1,
        condition: plan.condition,
        condition_order: plan.conditionOrder,
        trial_index: trial.trialIndex,
        target_zone: trial.targetZone,
        threat_azimuth_deg: trial.threatAzimuthDeg,
        onset_timestamp_ms: Math.round(Date.now() - (rtMs ?? STUDY_PARAMETERS.part1ResponseTimeoutMs)),
        first_response_ms: rtMs,
        confirmed_rt_ms: rtMs,
        response_zone: response,
        is_correct: isCorrect,
        is_front_back_reversal: isFrontBackRev,
        is_left_right_reversal: isLeftRightRev,
        wrong_attempts_count: isCorrect ? 0 : 1,
        alarm_duration_ms: rtMs ?? STUDY_PARAMETERS.part1ResponseTimeoutMs,
        wasted_alarm_ms: 0,
        beep_pulse_count: audioEngine.getBeepPulseCount(),
        eyes_off_road_ms: Math.round(trialEyesOffRoadMsRef.current),
        cv_confidence_avg: cvAvg,
        timestamp_iso: new Date().toISOString()
      };

      setSessionBundle((prev) => {
        if (!prev) return prev;
        const fpsSamples = trialFpsSamplesRef.current;
        const avgFps =
          fpsSamples.length > 0
            ? Math.round(fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length)
            : prev.hardware_info.webcam_fps_avg;
        const updated: StudySessionBundle = {
          ...prev,
          hardware_info: { ...prev.hardware_info, webcam_fps_avg: avgFps },
          trials: [...prev.trials, record]
        };
        saveSessionLocally(updated);
        return updated;
      });

      setTrialSubState('TRIAL_FEEDBACK');
      trialSubStateRef.current = 'TRIAL_FEEDBACK';
      setStatusBanner(
        response === 'TIMEOUT'
          ? '⏱ Response Window Elapsed — Advancing...'
          : `✓ Recorded (${rtMs} ms)`
      );

      scheduleTimeout(() => {
        runPart1Trial(plan, idx + 1);
      }, 420);
    },
    [audioEngine, clearAllTimers, isWebcamRunning, scheduleTimeout]
  );

  // Keyboard listener for Part 1 directional response (WASD / Arrows / 1-4)
  useEffect(() => {
    if (phase !== 'PART1_RUNNING' || trialSubState !== 'AWAITING_RESPONSE') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      const resp = getDirectionFromKey(e.key);
      if (resp) {
        e.preventDefault();
        completePart1Trial(resp);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [phase, trialSubState, completePart1Trial]);

  // --- PART 2 EXECUTION (PERSISTENT ALARM FATIGUE VS GAZE-CONTINGENT 3D) ---
  const startPart2Block = (blockIndex: number) => {
    const cond = part2Order[blockIndex];
    const plan = generateBlockSchedule(
      sessionBundleRef.current?.participant_id || participantId,
      2,
      cond,
      blockIndex + 1
    );
    clearAllTimers();
    setActivePlan(plan);
    activePlanRef.current = plan;
    setCurrentTrialIdx(0);
    currentTrialIdxRef.current = 0;

    audioEngine.setStudyAudioMode(cond);
    onStudyVisualModeChange('PART2_MIRROR_HAZARD');
    gameWindowRef.current?.setStudyAutopilotMode(true, false);
    gameWindowRef.current?.clearStudyHazards(false);
    onSimulateGaze('CENTER');

    setPhase('PART2_RUNNING');
    runPart2Trial(plan, 0);
  };

  const finalizePart2Trial = useCallback(
    (
      plan: ScheduledBlockPlan,
      idx: number,
      confirmedRtMs: number | null,
      alarmDurationMs: number,
      respondedZone: ProxyTarget | 'TIMEOUT'
    ) => {
      if (trialResolvedRef.current) return;
      trialResolvedRef.current = true;
      clearAllTimers();
      audioEngine.stopStudyTrialAlert();
      gameWindowRef.current?.clearStudyHazards(false);

      const trial = plan.trials[idx];
      const wastedAlarmMs =
        plan.condition === 'TRADITIONAL_PERSISTENT' && confirmedRtMs !== null
          ? Math.max(0, alarmDurationMs - confirmedRtMs)
          : 0;

      const confSamples = trialConfidenceSamplesRef.current;
      const cvAvg =
        confSamples.length > 0
          ? Math.round((confSamples.reduce((a, b) => a + b, 0) / confSamples.length) * 100) / 100
          : isWebcamRunning
          ? 0.95
          : 1.0;

      const record: StudyTrialRecord = {
        participant_id: plan.participantId,
        session_seed: plan.sessionSeed,
        part: 2,
        condition: plan.condition,
        condition_order: plan.conditionOrder,
        trial_index: trial.trialIndex,
        target_zone: trial.targetZone,
        threat_azimuth_deg: trial.threatAzimuthDeg,
        onset_timestamp_ms: Math.round(Date.now() - alarmDurationMs),
        first_response_ms: trialFirstRespMsRef.current ?? confirmedRtMs,
        confirmed_rt_ms: confirmedRtMs,
        response_zone: respondedZone,
        is_correct: respondedZone === trial.targetZone,
        is_front_back_reversal: false,
        is_left_right_reversal:
          (trial.targetZone === 'LEFT_MIRROR' && respondedZone === 'RIGHT_MIRROR') ||
          (trial.targetZone === 'RIGHT_MIRROR' && respondedZone === 'LEFT_MIRROR'),
        wrong_attempts_count: trialWrongAttemptsRef.current,
        alarm_duration_ms: Math.round(alarmDurationMs),
        wasted_alarm_ms: Math.round(wastedAlarmMs),
        beep_pulse_count: audioEngine.getBeepPulseCount(),
        eyes_off_road_ms: Math.round(trialEyesOffRoadMsRef.current),
        cv_confidence_avg: cvAvg,
        timestamp_iso: new Date().toISOString()
      };

      setSessionBundle((prev) => {
        if (!prev) return prev;
        const fpsSamples = trialFpsSamplesRef.current;
        const avgFps =
          fpsSamples.length > 0
            ? Math.round(fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length)
            : prev.hardware_info.webcam_fps_avg;
        const updated: StudySessionBundle = {
          ...prev,
          hardware_info: { ...prev.hardware_info, webcam_fps_avg: avgFps },
          trials: [...prev.trials, record]
        };
        saveSessionLocally(updated);
        return updated;
      });

      setTrialSubState('TRIAL_FEEDBACK');
      trialSubStateRef.current = 'TRIAL_FEEDBACK';
      setShowGazeFallbackPrompt(false);
      onSimulateGaze('CENTER');

      scheduleTimeout(() => {
        runPart2Trial(plan, idx + 1);
      }, 650);
    },
    [audioEngine, clearAllTimers, gameWindowRef, isWebcamRunning, onSimulateGaze, scheduleTimeout]
  );

  const runPart2Trial = (plan: ScheduledBlockPlan, idx: number) => {
    if (idx >= plan.trials.length) {
      finishBlockAndOpenSurvey(plan);
      return;
    }

    clearAllTimers();
    const trial = plan.trials[idx];
    setCurrentTrialIdx(idx);
    currentTrialIdxRef.current = idx;
    setTrialSubState('INTER_TRIAL');
    trialSubStateRef.current = 'INTER_TRIAL';
    setShowGazeFallbackPrompt(false);
    trialResolvedRef.current = false;
    trialFirstRespMsRef.current = null;
    part2ConfirmedRtRef.current = null;
    trialWrongAttemptsRef.current = 0;
    trialConfidenceSamplesRef.current = [];
    trialFpsSamplesRef.current = [];
    trialEyesOffRoadMsRef.current = 0;
    lastSamplePerfRef.current = 0;

    audioEngine.stopStudyTrialAlert();
    gameWindowRef.current?.clearStudyHazards(false);
    onSimulateGaze('CENTER');
    setStatusBanner(`Eyes ahead on highway • Trial ${idx + 1}/${plan.trials.length} starting...`);

    scheduleTimeout(() => {
      if (phaseRef.current !== 'PART2_RUNNING') return;
      trialOnsetPerfRef.current = performance.now();
      lastSamplePerfRef.current = trialOnsetPerfRef.current;
      setTrialSubState('AWAITING_RESPONSE');
      trialSubStateRef.current = 'AWAITING_RESPONSE';

      gameWindowRef.current?.spawnStudyHazardCar(trial.targetZone, trial.trialIndex);
      audioEngine.triggerStudyTrialAlert(trial.targetZone, 7.5);
      setStatusBanner(
        plan.condition === 'GAZE_CONTINGENT_3D'
          ? '👁 Check the matching mirror (300 ms gaze dwell) to silence the 3D alert!'
          : '🔊 Traditional Alarm Active — Check the matching mirror!'
      );

      // Show fallback guidance after 5000ms if webcam hasn't confirmed yet
      scheduleTimeout(() => {
        if (!trialResolvedRef.current && part2ConfirmedRtRef.current === null) {
          setShowGazeFallbackPrompt(true);
        }
      }, STUDY_PARAMETERS.gazeFallbackTimeoutMs);

      if (plan.condition === 'TRADITIONAL_PERSISTENT') {
        // Persistent alarm blares for full 3500 ms regardless of gaze check
        scheduleTimeout(() => {
          finalizePart2Trial(
            plan,
            idx,
            part2ConfirmedRtRef.current,
            STUDY_PARAMETERS.traditionalAlarmMaxDurationMs,
            part2ConfirmedRtRef.current !== null ? trial.targetZone : 'TIMEOUT'
          );
        }, STUDY_PARAMETERS.traditionalAlarmMaxDurationMs);
      } else {
        // Gaze-Contingent 3D max safety timeout (8000 ms)
        scheduleTimeout(() => {
          if (!trialResolvedRef.current) {
            const elapsed = Math.round(performance.now() - trialOnsetPerfRef.current);
            finalizePart2Trial(plan, idx, null, elapsed, 'TIMEOUT');
          }
        }, 8000);
      }
    }, trial.interTrialDelayMs);
  };

  // Monitor mirror gaze during Part 2 AWAITING_RESPONSE
  useEffect(() => {
    if (phase !== 'PART2_RUNNING' || trialSubState !== 'AWAITING_RESPONSE') return;
    const plan = activePlanRef.current;
    if (!plan || trialResolvedRef.current) return;
    const trial = plan.trials[currentTrialIdxRef.current];
    if (!trial) return;

    if (
      currentGaze === 'LEFT_MIRROR' ||
      currentGaze === 'RIGHT_MIRROR' ||
      currentGaze === 'REAR_MIRROR'
    ) {
      const elapsedMs = Math.max(50, Math.round(performance.now() - trialOnsetPerfRef.current));
      if (trialFirstRespMsRef.current === null) {
        trialFirstRespMsRef.current = elapsedMs;
      }

      if (currentGaze === trial.targetZone) {
        if (part2ConfirmedRtRef.current === null) {
          part2ConfirmedRtRef.current = elapsedMs;
          gameWindowRef.current?.clearStudyHazards(true);

          if (plan.condition === 'GAZE_CONTINGENT_3D') {
            setStatusBanner(`✓ Gaze Verified in ${elapsedMs} ms • Alert Silenced!`);
            // Wait brief beat for C6 -> G6 confirmation chime, then finalize
            scheduleTimeout(() => {
              finalizePart2Trial(plan, currentTrialIdxRef.current, elapsedMs, elapsedMs, trial.targetZone);
            }, 420);
          } else {
            // Traditional Persistent keeps blaring until 3500ms timer expires!
            setStatusBanner(
              `👁 Mirror Checked at ${elapsedMs} ms — Traditional Alarm STILL Sounding until 3.5s!`
            );
          }
        }
      } else {
        // Glanced at a non-target mirror first
        trialWrongAttemptsRef.current += 1;
      }
    }
  }, [phase, trialSubState, currentGaze, finalizePart2Trial, gameWindowRef, scheduleTimeout]);

  // Allow keyboard 1/3/4 or mirror clicks when fallback is enabled or after gazeFallbackTimeoutMs
  useEffect(() => {
    if (phase !== 'PART2_RUNNING' || trialSubState !== 'AWAITING_RESPONSE') return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;
      if (!useSimFallback && !showGazeFallbackPrompt && isWebcamRunning) return;
      const gaze = getMirrorKeyGaze(e.key);
      if (gaze) {
        e.preventDefault();
        onSimulateGaze(gaze, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [phase, trialSubState, useSimFallback, showGazeFallbackPrompt, isWebcamRunning, onSimulateGaze]);

  // --- BLOCK COMPLETION & PROGRESSIVE SURVEY HANDLER ---
  const finishBlockAndOpenSurvey = (plan: ScheduledBlockPlan) => {
    clearAllTimers();
    audioEngine.stopStudyTrialAlert();
    gameWindowRef.current?.clearStudyHazards(false);

    const completedForPart =
      plan.part === 1 ? part1Order.slice(0, part1BlockIdx + 1) : part2Order.slice(0, part2BlockIdx + 1);

    setSurveyPart(plan.part);
    setSurveyCompletedConds(completedForPart);
    setSurveyModalOpen(true);
  };

  const handleSurveySubmit = async (updatedScoresByCond: Record<string, Record<string, number>>) => {
    const part = surveyPart;
    const applicableQs = SURVEY_QUESTIONS.filter((q) => q.applicableParts.includes(part));
    const latestCond = surveyCompletedConds[surveyCompletedConds.length - 1];

    // Record initial scores for the newly evaluated condition if not yet stored
    const nextInitialForPart = { ...(initialScoresMap[part] || {}) };
    if (latestCond && !nextInitialForPart[latestCond]) {
      nextInitialForPart[latestCond] = { ...(updatedScoresByCond[latestCond] || {}) };
    }
    const nextCurrentForPart = { ...(currentScoresMap[part] || {}), ...updatedScoresByCond };

    setInitialScoresMap((prev) => ({ ...prev, [part]: nextInitialForPart }));
    setCurrentScoresMap((prev) => ({ ...prev, [part]: nextCurrentForPart }));

    // Build updated StudySurveyRecord list for this part (stores latest recalibrated values + original initial_score)
    const nowIso = new Date().toISOString();
    const orderList = part === 1 ? part1Order : part2Order;
    const updatedPartSurveys: StudySurveyRecord[] = [];
    surveyCompletedConds.forEach((cond) => {
      const condOrder = orderList.indexOf(cond as never) + 1;
      applicableQs.forEach((q) => {
        const initScore = nextInitialForPart[cond]?.[q.id] ?? 5.0;
        const finalScore = nextCurrentForPart[cond]?.[q.id] ?? 5.0;
        updatedPartSurveys.push({
          participant_id: sessionBundleRef.current?.participant_id || participantId,
          part,
          question_id: q.id,
          condition: cond,
          condition_order: condOrder,
          initial_score: initScore,
          final_score: finalScore,
          score_delta: Math.round((finalScore - initScore) * 10) / 10,
          timestamp_iso: nowIso
        });
      });
    });

    const isPart1Last = part === 1 && part1BlockIdx >= part1Order.length - 1;
    const isPart2Last = part === 2 && part2BlockIdx >= part2Order.length - 1;

    const prevBundle = sessionBundleRef.current;
    if (prevBundle) {
      const otherPartSurveys = prevBundle.surveys.filter((s) => s.part !== part);
      const blockTag = `PART${part}#${latestCond}`;
      const completedBlocks = prevBundle.completed_blocks.includes(blockTag)
        ? prevBundle.completed_blocks
        : [...prevBundle.completed_blocks, blockTag];

      const nextBundle: StudySessionBundle = {
        ...prevBundle,
        part1_completed: prevBundle.part1_completed || isPart1Last,
        part2_completed: prevBundle.part2_completed || isPart2Last,
        completed_blocks: completedBlocks,
        surveys: [...otherPartSurveys, ...updatedPartSurveys],
        updated_at: nowIso
      };

      setSessionBundle(nextBundle);
      sessionBundleRef.current = nextBundle;
      saveSessionLocally(nextBundle);

      setIsSyncing(true);
      const res = await syncBlockToCloud(nextBundle, part, latestCond, studyPasscode);
      setIsSyncing(false);
      if (res.ok) {
        setSyncError(null);
        setSessionBundle((b) => (b ? { ...b, sync_status: 'SYNCED', s3_key: res.s3Key } : b));
      } else {
        setSyncError(res.error || 'Cloud sync failed after retries.');
        setSessionBundle((b) =>
          b ? { ...b, sync_status: 'LOCAL_FALLBACK', last_sync_error: res.error } : b
        );
      }
    }

    setSurveyModalOpen(false);

    if (part === 1) {
      if (part1BlockIdx + 1 < part1Order.length) {
        setPart1BlockIdx(part1BlockIdx + 1);
        setPhase('PART1_READY');
      } else {
        setPhase('PART1_TRANSITION');
      }
    } else {
      if (part2BlockIdx + 1 < part2Order.length) {
        setPart2BlockIdx(part2BlockIdx + 1);
        setPhase('PART2_READY');
      } else {
        audioEngine.setStudyAudioMode(null);
        onStudyVisualModeChange('OFF');
        gameWindowRef.current?.setStudyAutopilotMode(false, false);
        setPhase('STUDY_COMPLETE');
      }
    }
  };

  const handleRetrySync = async () => {
    if (!sessionBundleRef.current) return;
    setIsSyncing(true);
    const lastBlock =
      sessionBundleRef.current.completed_blocks[sessionBundleRef.current.completed_blocks.length - 1] ||
      'PART2#GAZE_CONTINGENT_3D';
    const [partStr, condStr] = lastBlock.split('#');
    const pNum = partStr === 'PART1' ? 1 : 2;
    const res = await syncBlockToCloud(
      sessionBundleRef.current,
      pNum,
      (condStr as StudyConditionType) || 'GAZE_CONTINGENT_3D',
      studyPasscode
    );
    setIsSyncing(false);
    if (res.ok) {
      setSyncError(null);
      setSessionBundle((b) => (b ? { ...b, sync_status: 'SYNCED', s3_key: res.s3Key } : b));
    } else {
      setSyncError(res.error || 'Cloud retry failed.');
    }
  };

  /**
   * Researcher E2E Verification Runner (enabled only when Participant ID === 'P_00'):
   * Exercises deterministic Part 1 + Progressive Surveys + Part 2 + AWS S3/DynamoDB ingest.
   */
  const handleRunAutomatedP00Test = async () => {
    const pid = 'P_00';
    const p1Ord = getPart1ConditionOrder(pid);
    const p2Ord = getPart2ConditionOrder(pid);
    const nowIso = new Date().toISOString();

    const trials: StudyTrialRecord[] = [];
    const surveys: StudySurveyRecord[] = [];
    const completedBlocks: string[] = [];

    // Part 1 deterministic simulated trials (Mono -> Stereo -> 3D Spatial)
    p1Ord.forEach((cond, cIdx) => {
      const plan = generateBlockSchedule(pid, 1, cond, cIdx + 1);
      completedBlocks.push(`PART1#${cond}`);
      plan.trials.forEach((t, tIdx) => {
        let resp: ProxyTarget = t.targetZone;
        if (cond === 'MONO_BASELINE' && tIdx % 3 !== 0) {
          resp = tIdx % 2 === 0 ? 'FRONT_WINDSHIELD' : 'REAR_MIRROR';
        } else if (cond === 'STEREO_BASELINE') {
          if (t.targetZone === 'FRONT_WINDSHIELD' && tIdx % 2 === 0) resp = 'REAR_MIRROR';
          if (t.targetZone === 'REAR_MIRROR' && tIdx % 2 === 1) resp = 'FRONT_WINDSHIELD';
        }
        const rt = cond === 'SPATIAL_3D' ? 680 + tIdx * 35 : cond === 'STEREO_BASELINE' ? 990 + tIdx * 45 : 1320 + tIdx * 55;
        const isCorrect = resp === t.targetZone;
        trials.push({
          participant_id: pid,
          session_seed: plan.sessionSeed,
          part: 1,
          condition: cond,
          condition_order: cIdx + 1,
          trial_index: t.trialIndex,
          target_zone: t.targetZone,
          threat_azimuth_deg: t.threatAzimuthDeg,
          onset_timestamp_ms: Date.now() - 60000 + tIdx * 3000,
          first_response_ms: rt,
          confirmed_rt_ms: rt,
          response_zone: resp,
          is_correct: isCorrect,
          is_front_back_reversal:
            (t.targetZone === 'FRONT_WINDSHIELD' && resp === 'REAR_MIRROR') ||
            (t.targetZone === 'REAR_MIRROR' && resp === 'FRONT_WINDSHIELD'),
          is_left_right_reversal: false,
          wrong_attempts_count: isCorrect ? 0 : 1,
          alarm_duration_ms: rt,
          wasted_alarm_ms: 0,
          beep_pulse_count: Math.max(1, Math.round(rt / 380)),
          eyes_off_road_ms: 0,
          cv_confidence_avg: 0.96,
          timestamp_iso: nowIso
        });
      });

      SURVEY_QUESTIONS.filter((q) => q.applicableParts.includes(1)).forEach((q) => {
        const init =
          cond === 'SPATIAL_3D'
            ? q.lowerIsBetter
              ? 2.0
              : 9.0
            : cond === 'STEREO_BASELINE'
            ? q.lowerIsBetter
              ? 5.5
              : 5.5
            : q.lowerIsBetter
            ? 7.5
            : 2.5;
        const fin = cond === 'MONO_BASELINE' && !q.lowerIsBetter ? Math.max(0, init - 0.5) : init;
        surveys.push({
          participant_id: pid,
          part: 1,
          question_id: q.id,
          condition: cond,
          condition_order: cIdx + 1,
          initial_score: init,
          final_score: fin,
          score_delta: Math.round((fin - init) * 10) / 10,
          timestamp_iso: nowIso
        });
      });
    });

    // Part 2 deterministic simulated trials (Traditional Persistent vs Gaze-Contingent 3D)
    p2Ord.forEach((cond, cIdx) => {
      const plan = generateBlockSchedule(pid, 2, cond, cIdx + 1);
      completedBlocks.push(`PART2#${cond}`);
      plan.trials.forEach((t, tIdx) => {
        const rt = cond === 'GAZE_CONTINGENT_3D' ? 620 + tIdx * 30 : 810 + tIdx * 35;
        const alarmDur = cond === 'TRADITIONAL_PERSISTENT' ? STUDY_PARAMETERS.traditionalAlarmMaxDurationMs : rt;
        const wasted = cond === 'TRADITIONAL_PERSISTENT' ? Math.max(0, alarmDur - rt) : 0;
        trials.push({
          participant_id: pid,
          session_seed: plan.sessionSeed,
          part: 2,
          condition: cond,
          condition_order: cIdx + 1,
          trial_index: t.trialIndex,
          target_zone: t.targetZone,
          threat_azimuth_deg: t.threatAzimuthDeg,
          onset_timestamp_ms: Date.now() - 25000 + tIdx * 4000,
          first_response_ms: rt - 300,
          confirmed_rt_ms: rt,
          response_zone: t.targetZone,
          is_correct: true,
          is_front_back_reversal: false,
          is_left_right_reversal: false,
          wrong_attempts_count: 0,
          alarm_duration_ms: alarmDur,
          wasted_alarm_ms: wasted,
          beep_pulse_count: cond === 'TRADITIONAL_PERSISTENT' ? 10 : 2,
          eyes_off_road_ms: 480,
          cv_confidence_avg: 0.96,
          timestamp_iso: nowIso
        });
      });

      SURVEY_QUESTIONS.filter((q) => q.applicableParts.includes(2)).forEach((q) => {
        const init = cond === 'GAZE_CONTINGENT_3D' ? (q.lowerIsBetter ? 1.5 : 9.0) : q.lowerIsBetter ? 8.0 : 4.5;
        surveys.push({
          participant_id: pid,
          part: 2,
          question_id: q.id,
          condition: cond,
          condition_order: cIdx + 1,
          initial_score: init,
          final_score: init,
          score_delta: 0,
          timestamp_iso: nowIso
        });
      });
    });

    const bundle: StudySessionBundle = {
      participant_id: pid,
      created_at: nowIso,
      updated_at: nowIso,
      hardware_info: {
        audio_output_device: audioOutputLabel,
        webcam_label: isWebcamRunning ? webcamLabel : 'E2E Calibration Self-Test',
        webcam_fps_avg: visionDiag?.fps || 30,
        cv_confidence_avg: 0.96,
        input_mode: isWebcamRunning ? 'WEBCAM_MEDIAPIPE' : 'SIMULATION_FALLBACK',
        user_agent: navigator.userAgent
      },
      part1_condition_order: p1Ord,
      part2_condition_order: p2Ord,
      part1_completed: true,
      part2_completed: true,
      completed_blocks: completedBlocks,
      trials,
      surveys,
      sync_status: 'PENDING'
    };

    setSessionBundle(bundle);
    sessionBundleRef.current = bundle;
    saveSessionLocally(bundle);
    setIsSyncing(true);
    const res = await syncBlockToCloud(bundle, 2, p2Ord[p2Ord.length - 1], studyPasscode);
    setIsSyncing(false);
    if (res.ok) {
      setSyncError(null);
      setSessionBundle((b) => (b ? { ...b, sync_status: 'SYNCED', s3_key: res.s3Key } : b));
    } else {
      setSyncError(res.error || 'Cloud sync failed.');
      setSessionBundle((b) => (b ? { ...b, sync_status: 'LOCAL_FALLBACK', last_sync_error: res.error } : b));
    }
    setPhase('STUDY_COMPLETE');
  };

  if (!isOpen) return null;

  const pidValid = isValidParticipantId(participantId);
  const fpsOk = (visionDiag?.fps ?? 0) >= STUDY_PARAMETERS.minRequiredWebcamFps;
  const canBeginStudy =
    pidValid &&
    stereoConfirmed &&
    (isWebcamRunning || useSimFallback) &&
    (practiceComplete || useSimFallback);

  const isRunningOnHighway = phase === 'PART1_RUNNING' || phase === 'PART2_RUNNING';

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 10000,
        pointerEvents: isRunningOnHighway ? 'none' : 'auto',
        display: 'flex',
        flexDirection: 'column',
        background: isRunningOnHighway ? 'transparent' : 'rgba(5, 8, 16, 0.88)',
        backdropFilter: isRunningOnHighway ? 'none' : 'blur(14px)'
      }}
    >
      {/* Persistent Webcam Video Node — kept mounted across Step 0 -> Part 1 -> Part 2 so MediaPipe stream never interrupts */}
      <div
        style={
          phase === 'STEP0_GATE'
            ? {
                position: 'fixed',
                right: 28,
                bottom: 24,
                width: 196,
                zIndex: 10010,
                display: isWebcamRunning ? 'block' : 'none',
                borderRadius: 10,
                overflow: 'hidden',
                border: `1.5px solid ${faceDetectedNow ? '#10b981' : '#f59e0b'}`,
                background: '#050914',
                boxShadow: '0 10px 30px rgba(0,0,0,0.7)',
                pointerEvents: 'none'
              }
            : isRunningOnHighway && isWebcamRunning
            ? {
                position: 'fixed',
                right: 16,
                bottom: 84,
                width: 160,
                zIndex: 10010,
                borderRadius: 10,
                overflow: 'hidden',
                border: `1.5px solid ${faceDetectedNow ? '#10b981' : '#f59e0b'}`,
                background: '#050914',
                boxShadow: '0 8px 24px rgba(0,0,0,0.75)',
                pointerEvents: 'none'
              }
            : {
                position: 'fixed',
                width: 1,
                height: 1,
                opacity: 0,
                pointerEvents: 'none'
              }
        }
      >
        <div style={{ position: 'relative', width: '100%', aspectRatio: '4 / 3' }}>
          <video
            ref={videoRef}
            playsInline
            muted
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              transform: 'scaleX(-1)'
            }}
          />
          <canvas
            ref={canvasRef}
            style={{
              position: 'absolute',
              inset: 0,
              width: '100%',
              height: '100%',
              pointerEvents: 'none'
            }}
          />
          {visionDiag && (
            <div
              style={{
                position: 'absolute',
                top: 4,
                left: 4,
                background: 'rgba(0,0,0,0.7)',
                padding: '2px 5px',
                borderRadius: 4,
                fontSize: 9,
                fontFamily: 'var(--font-mono)',
                color: fpsOk ? '#34d399' : '#fbbf24'
              }}
            >
              {visionDiag.fps} FPS • {currentGaze}
            </div>
          )}
        </div>
      </div>

      {/* ===================================================================== */}
      {/* STEP 0: HARDWARE & CALIBRATION GATE                                   */}
      {/* ===================================================================== */}
      {phase === 'STEP0_GATE' && (
        <div
          style={{
            margin: 'auto',
            width: '96%',
            maxWidth: 940,
            maxHeight: '92vh',
            overflowY: 'auto',
            background: '#0b1120',
            border: '1px solid rgba(0, 240, 255, 0.35)',
            borderRadius: 16,
            boxShadow: '0 24px 64px rgba(0,0,0,0.85), 0 0 35px rgba(0, 240, 255, 0.14)',
            padding: 24,
            display: 'flex',
            flexDirection: 'column',
            gap: 18
          }}
        >
          {/* Header */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              borderBottom: '1px solid rgba(255,255,255,0.08)',
              paddingBottom: 14
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div
                style={{
                  width: 40,
                  height: 40,
                  borderRadius: 10,
                  background: 'rgba(0, 240, 255, 0.14)',
                  border: '1px solid rgba(0, 240, 255, 0.4)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                <Activity size={20} color="#00f0ff" />
              </div>
              <div>
                <div style={{ fontSize: 11, fontWeight: 700, color: '#00f0ff', letterSpacing: '0.09em' }}>
                  KNU HCI LAB • EMPIRICAL EVALUATION PROTOCOL
                </div>
                <h1 style={{ fontSize: 19, fontWeight: 800, color: '#fff', marginTop: 2 }}>
                  Step 0 — Hardware Calibration & Counterbalanced Assignment
                </h1>
              </div>
            </div>

            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              {onOpenLegacySandboxStudy && (
                <button
                  className="btn"
                  style={{ fontSize: 11, padding: '6px 10px' }}
                  onClick={() => {
                    onClose();
                    onOpenLegacySandboxStudy();
                  }}
                >
                  Quick 10-Trial Demo
                </button>
              )}
              <button className="btn" onClick={onClose} style={{ padding: 6 }} title="Return to Cockpit">
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Participant ID + Passcode + Latin Square Preview */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1.6fr', gap: 12 }}>
            <div className="telemetry-item">
              <div className="telemetry-label">Participant ID (P_01..P_999)</div>
              <input
                type="text"
                value={participantId}
                onChange={(e) => setParticipantId(e.target.value.toUpperCase())}
                placeholder="P_01"
                style={{
                  width: '100%',
                  marginTop: 6,
                  padding: '7px 10px',
                  borderRadius: 6,
                  background: '#060a14',
                  border: `1px solid ${pidValid ? 'rgba(0,240,255,0.4)' : '#ef4444'}`,
                  color: '#fff',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 14,
                  fontWeight: 700,
                  outline: 'none'
                }}
              />
              {!pidValid && (
                <div style={{ fontSize: 10, color: '#f87171', marginTop: 4 }}>
                  Must match P_00 to P_999
                </div>
              )}
            </div>

            <div className="telemetry-item">
              <div className="telemetry-label">Study Access Token</div>
              <input
                type="password"
                value={studyPasscode}
                onChange={(e) => setStudyPasscode(e.target.value)}
                style={{
                  width: '100%',
                  marginTop: 6,
                  padding: '7px 10px',
                  borderRadius: 6,
                  background: '#060a14',
                  border: '1px solid rgba(255,255,255,0.16)',
                  color: '#fff',
                  fontFamily: 'var(--font-mono)',
                  fontSize: 14,
                  outline: 'none'
                }}
              />
            </div>

            <div className="telemetry-item" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div className="telemetry-label">Assigned Counterbalanced Sequence</div>
              <div style={{ fontSize: 11, color: '#cbd5e1', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                <strong style={{ color: '#00f0ff' }}>Part 1 (3×3):</strong>
                {part1Order.map((c, idx) => (
                  <span
                    key={c}
                    style={{
                      padding: '1px 6px',
                      borderRadius: 4,
                      background: CONDITION_META[c].badgeBg,
                      color: CONDITION_META[c].accentColor,
                      fontWeight: 700,
                      fontSize: 10
                    }}
                  >
                    {idx + 1}. {CONDITION_META[c].shortLabel}
                  </span>
                ))}
              </div>
              <div style={{ fontSize: 11, color: '#cbd5e1', display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                <strong style={{ color: '#10b981' }}>Part 2 (2×2):</strong>
                {part2Order.map((c, idx) => (
                  <span
                    key={c}
                    style={{
                      padding: '1px 6px',
                      borderRadius: 4,
                      background: CONDITION_META[c].badgeBg,
                      color: CONDITION_META[c].accentColor,
                      fontWeight: 700,
                      fontSize: 10
                    }}
                  >
                    {idx + 1}. {CONDITION_META[c].shortLabel}
                  </span>
                ))}
              </div>
            </div>
          </div>

          {/* Step 0 Gate Cards: 1. Stereo Headphone Check | 2. Webcam Gaze Calibration */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            {/* Card A: Stereo Audio Check */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.72)',
                border: `1px solid ${stereoConfirmed ? 'rgba(16, 185, 129, 0.5)' : 'rgba(255,255,255,0.1)'}`,
                borderRadius: 12,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 10
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', display: 'flex', gap: 8 }}>
                  <Headphones size={16} color="#00f0ff" /> 1. Stereo Headphone Check
                </span>
                {stereoConfirmed && <CheckCircle2 size={16} color="#10b981" />}
              </div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                Detected Output: <code style={{ color: '#38bdf8' }}>{audioOutputLabel}</code>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className={`btn ${leftEarTested ? 'btn-primary' : ''}`}
                  style={{ flex: 1, fontSize: 12 }}
                  onClick={() => {
                    audioEngine.playStereoChannelTest('LEFT');
                    setLeftEarTested(true);
                  }}
                >
                  <Volume2 size={14} /> Test Left Ear
                </button>
                <button
                  className={`btn ${rightEarTested ? 'btn-primary' : ''}`}
                  style={{ flex: 1, fontSize: 12 }}
                  onClick={() => {
                    audioEngine.playStereoChannelTest('RIGHT');
                    setRightEarTested(true);
                  }}
                >
                  <Volume2 size={14} /> Test Right Ear
                </button>
              </div>
              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 11.5,
                  color: '#e2e8f0',
                  cursor: 'pointer',
                  marginTop: 2
                }}
              >
                <input
                  type="checkbox"
                  checked={stereoConfirmed}
                  onChange={(e) => setStereoConfirmed(e.target.checked)}
                />
                I confirm stereo audio plays clearly in Left & Right channels
              </label>
            </div>

            {/* Card B: Webcam Gaze Tracking Gate */}
            <div
              style={{
                background: 'rgba(15, 23, 42, 0.72)',
                border: `1px solid ${
                  isWebcamRunning && faceDetectedNow
                    ? 'rgba(16, 185, 129, 0.5)'
                    : 'rgba(255,255,255,0.1)'
                }`,
                borderRadius: 12,
                padding: 16,
                display: 'flex',
                flexDirection: 'column',
                gap: 10
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: '#fff', display: 'flex', gap: 8 }}>
                  <Eye size={16} color="#10b981" /> 2. Webcam Gaze Calibration Gate
                </span>
                {isWebcamRunning && (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 800,
                      padding: '2px 7px',
                      borderRadius: 10,
                      background: faceDetectedNow ? 'rgba(16,185,129,0.2)' : 'rgba(245,158,11,0.2)',
                      color: faceDetectedNow ? '#34d399' : '#fbbf24'
                    }}
                  >
                    {faceDetectedNow ? `FACE LOCKED (${visionDiag?.fps || 0} FPS)` : 'ALIGN FACE'}
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                <button
                  className={`btn ${isWebcamRunning ? 'btn-primary' : 'btn-accent'}`}
                  style={{ flex: 1, fontSize: 12 }}
                  onClick={handleStartWebcam}
                >
                  <Camera size={14} />
                  {isWebcamRunning ? 'Webcam Active (MediaPipe)' : 'Enable Webcam Gaze Tracker'}
                </button>
              </div>

              {webcamError && (
                <div style={{ fontSize: 11, color: '#fca5a5', lineHeight: 1.4 }}>{webcamError}</div>
              )}

              <label
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  fontSize: 11,
                  color: 'var(--text-muted)',
                  cursor: 'pointer'
                }}
              >
                <input
                  type="checkbox"
                  checked={useSimFallback}
                  onChange={(e) => setUseSimFallback(e.target.checked)}
                />
                Enable Keyboard/Click Gaze Simulation Fallback (if no webcam available)
              </label>
            </div>
          </div>

          {/* 10s Interactive Practice Round */}
          <div
            style={{
              background: 'rgba(0, 240, 255, 0.06)',
              border: '1px solid rgba(0, 240, 255, 0.28)',
              borderRadius: 12,
              padding: 16,
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              gap: 16
            }}
          >
            <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#fff' }}>
                3. 10-Second Interactive Practice Round (Unlogged)
              </div>
              <div style={{ fontSize: 11.5, color: '#cbd5e1' }}>
                Test pressing <strong>W / A / S / D</strong> (or Arrow keys) for directional responses and holding a <strong>300 ms mirror glance</strong> to confirm the <code>C6 → G6</code> earcon.
              </div>
              <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11 }}>
                <span style={{ color: practiceKeyDone ? '#34d399' : '#94a3b8', fontWeight: 700 }}>
                  {practiceKeyDone ? '✓ WASD Key Verified' : '○ Press any W/A/S/D key'}
                </span>
                <span style={{ color: practiceGazeDone ? '#34d399' : '#94a3b8', fontWeight: 700 }}>
                  {practiceGazeDone ? '✓ 300ms Mirror Dwell Verified' : '○ Glance at Left/Right/Rear mirror'}
                </span>
              </div>
            </div>

            <button
              className={`btn ${practiceComplete ? 'btn-primary' : 'btn-accent'}`}
              disabled={isPracticeActive}
              onClick={handleStartPractice}
              style={{ minWidth: 195, padding: '10px 16px' }}
            >
              {isPracticeActive
                ? `Practice Running (${practiceSecondsLeft}s)...`
                : practiceComplete
                ? '✓ Practice Completed (Redo)'
                : '▶ Start 10s Practice'}
            </button>
          </div>

          {/* Launch Button */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4, gap: 10, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              All trials & survey ratings auto-save locally after every block and sync incrementally to AWS.
            </span>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              {participantId.trim().toUpperCase() === 'P_00' && (
                <button
                  className="btn btn-accent"
                  disabled={isSyncing}
                  onClick={handleRunAutomatedP00Test}
                  style={{ padding: '10px 16px', fontSize: 12.5 }}
                >
                  ⚡ {isSyncing ? 'Syncing P_00...' : 'Run Automated E2E Verification (P_00)'}
                </button>
              )}
              <button
                className="btn btn-primary"
                disabled={!canBeginStudy}
                onClick={handleBeginEmpiricalStudy}
                style={{
                  padding: '12px 24px',
                  fontSize: 14,
                  opacity: canBeginStudy ? 1 : 0.45,
                  cursor: canBeginStudy ? 'pointer' : 'not-allowed'
                }}
              >
                <Play size={16} /> Begin Part 1: Spatial Localization Study
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* PART 1 & PART 2 BLOCK INTRO CARDS                                     */}
      {/* ===================================================================== */}
      {(phase === 'PART1_READY' || phase === 'PART2_READY') && (
        <div
          style={{
            margin: 'auto',
            width: '94%',
            maxWidth: 640,
            background: '#0b1120',
            border: '1px solid rgba(0, 240, 255, 0.45)',
            borderRadius: 16,
            padding: 26,
            boxShadow: '0 24px 64px rgba(0,0,0,0.85)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }}
        >
          {(() => {
            const isPart1 = phase === 'PART1_READY';
            const blockNum = isPart1 ? part1BlockIdx + 1 : part2BlockIdx + 1;
            const totalBlocks = isPart1 ? part1Order.length : part2Order.length;
            const cond = isPart1 ? part1Order[part1BlockIdx] : part2Order[part2BlockIdx];
            const meta = CONDITION_META[cond];

            return (
              <>
                <div style={{ fontSize: 11, fontWeight: 800, color: meta.accentColor, letterSpacing: '0.09em' }}>
                  {isPart1 ? 'PART 1: SPATIAL LOCALIZATION BENCHMARK' : 'PART 2: ALARM FATIGUE VS. GAZE CANCELLATION'} • BLOCK {blockNum} OF {totalBlocks}
                </div>
                <h2 style={{ fontSize: 21, fontWeight: 800, color: '#fff' }}>{meta.label}</h2>
                <p style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.55 }}>{meta.description}</p>

                <div
                  style={{
                    background: 'rgba(15, 23, 42, 0.8)',
                    border: '1px solid rgba(255,255,255,0.08)',
                    borderRadius: 10,
                    padding: 14,
                    fontSize: 12,
                    color: '#e2e8f0',
                    lineHeight: 1.65
                  }}
                >
                  {isPart1 ? (
                    <>
                      <strong>Instructions ({STUDY_PARAMETERS.part1TrialsPerCondition} Trials):</strong>
                      <br />• The vehicle drives automatically on autopilot at <strong>100 km/h</strong> along the curved highway.
                      <br />• Listen carefully and press the hazard direction immediately:
                      <br />
                      <code>W / ↑</code> Front &nbsp;•&nbsp; <code>S / ↓</code> Rear &nbsp;•&nbsp; <code>A / ←</code> Left &nbsp;•&nbsp; <code>D / →</code> Right
                    </>
                  ) : (
                    <>
                      <strong>Instructions ({STUDY_PARAMETERS.part2TrialsPerCondition} Trials):</strong>
                      <br />• Keep eyes focused forward on the highway.
                      <br />• When an alert sounds, glance at the matching mirror (<strong>Left</strong>, <strong>Right</strong>, or <strong>Rear-View</strong>) and hold for <strong>300 ms</strong> to verify the vehicle.
                      {(useSimFallback || !isWebcamRunning) && (
                        <>
                          <br />• <em>Simulation Fallback Active:</em> Press keys <code>1</code> (Left), <code>3</code> (Right), <code>4</code> (Rear) or click a mirror.
                        </>
                      )}
                    </>
                  )}
                </div>

                <button
                  className="btn btn-primary"
                  style={{ padding: '12px 20px', fontSize: 14 }}
                  onClick={() => (isPart1 ? startPart1Block(part1BlockIdx) : startPart2Block(part2BlockIdx))}
                >
                  <Play size={16} /> Start Block {blockNum} ({meta.shortLabel})
                </button>
              </>
            );
          })()}
        </div>
      )}

      {/* ===================================================================== */}
      {/* ACTIVE HIGHWAY TRIAL HUD (FLOATS CLEANLY OVER LIVE 3D GAMEWINDOW)     */}
      {/* ===================================================================== */}
      {isRunningOnHighway && activePlan && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            pointerEvents: 'none',
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'space-between',
            padding: '54px 16px 14px 16px'
          }}
        >
          {/* Floating Study Trial Status Banner */}
          <div
            style={{
              alignSelf: 'center',
              background: 'rgba(6, 10, 20, 0.88)',
              backdropFilter: 'blur(12px)',
              border: `1px solid ${
                trialSubState === 'AWAITING_RESPONSE' ? '#f59e0b' : 'rgba(0, 240, 255, 0.45)'
              }`,
              borderRadius: 12,
              padding: '8px 18px',
              display: 'flex',
              alignItems: 'center',
              gap: 16,
              boxShadow: '0 8px 32px rgba(0,0,0,0.75)',
              pointerEvents: 'auto'
            }}
          >
            <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: '#94a3b8' }}>
              PID <strong style={{ color: '#fff' }}>{activePlan.participantId}</strong> • PART{' '}
              {activePlan.part} •{' '}
              <strong style={{ color: CONDITION_META[activePlan.condition].accentColor }}>
                {CONDITION_META[activePlan.condition].shortLabel}
              </strong>{' '}
              • TRIAL <strong style={{ color: '#00f0ff' }}>{currentTrialIdx + 1}</strong>/{activePlan.trials.length}
            </div>

            <div style={{ width: 1, height: 18, background: 'rgba(255,255,255,0.14)' }} />

            <div
              style={{
                fontSize: 12.5,
                fontWeight: 700,
                color: trialSubState === 'AWAITING_RESPONSE' ? '#fbbf24' : '#e2e8f0'
              }}
            >
              {statusBanner}
            </div>
          </div>

          {/* Part 1 Interactive Directional Response Dock (Bottom) */}
          {phase === 'PART1_RUNNING' && (
            <div
              style={{
                alignSelf: 'center',
                background: 'rgba(6, 10, 20, 0.9)',
                backdropFilter: 'blur(14px)',
                border: '1px solid rgba(0, 240, 255, 0.35)',
                borderRadius: 14,
                padding: '10px 14px',
                display: 'flex',
                gap: 10,
                pointerEvents: 'auto',
                boxShadow: '0 10px 34px rgba(0,0,0,0.85)'
              }}
            >
              <button
                className="btn btn-accent"
                disabled={trialSubState !== 'AWAITING_RESPONSE'}
                onClick={() => completePart1Trial('LEFT_MIRROR')}
                style={{ minWidth: 120 }}
              >
                ◀ Left (A / ←)
              </button>
              <button
                className="btn btn-accent"
                disabled={trialSubState !== 'AWAITING_RESPONSE'}
                onClick={() => completePart1Trial('FRONT_WINDSHIELD')}
                style={{ minWidth: 120 }}
              >
                ▲ Front (W / ↑)
              </button>
              <button
                className="btn btn-accent"
                disabled={trialSubState !== 'AWAITING_RESPONSE'}
                onClick={() => completePart1Trial('REAR_MIRROR')}
                style={{ minWidth: 120 }}
              >
                ▼ Rear (S / ↓)
              </button>
              <button
                className="btn btn-accent"
                disabled={trialSubState !== 'AWAITING_RESPONSE'}
                onClick={() => completePart1Trial('RIGHT_MIRROR')}
                style={{ minWidth: 120 }}
              >
                Right (D / →) ▶
              </button>
            </div>
          )}

          {/* Part 2 Mirror Fallback Controls (Shown if simulation mode or after 5000ms fallback timeout) */}
          {phase === 'PART2_RUNNING' && (useSimFallback || showGazeFallbackPrompt || !isWebcamRunning) && (
            <div
              style={{
                alignSelf: 'center',
                background: 'rgba(6, 10, 20, 0.9)',
                border: '1px solid rgba(16, 185, 129, 0.45)',
                borderRadius: 12,
                padding: '8px 14px',
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                pointerEvents: 'auto'
              }}
            >
              <span style={{ fontSize: 11, color: '#a7f3d0', fontWeight: 700 }}>
                {showGazeFallbackPrompt ? 'Fallback Response:' : 'Sim Mirror Check:'}
              </span>
              <button
                className="btn"
                style={{ fontSize: 11, padding: '5px 10px' }}
                disabled={trialSubState !== 'AWAITING_RESPONSE'}
                onClick={() => onSimulateGaze('LEFT_MIRROR', true)}
              >
                [1] Left Mirror
              </button>
              <button
                className="btn"
                style={{ fontSize: 11, padding: '5px 10px' }}
                disabled={trialSubState !== 'AWAITING_RESPONSE'}
                onClick={() => onSimulateGaze('REAR_MIRROR', true)}
              >
                [4] Rear Mirror
              </button>
              <button
                className="btn"
                style={{ fontSize: 11, padding: '5px 10px' }}
                disabled={trialSubState !== 'AWAITING_RESPONSE'}
                onClick={() => onSimulateGaze('RIGHT_MIRROR', true)}
              >
                [3] Right Mirror
              </button>
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* PART 1 -> PART 2 TRANSITION CARD                                      */}
      {/* ===================================================================== */}
      {phase === 'PART1_TRANSITION' && (
        <div
          style={{
            margin: 'auto',
            width: '94%',
            maxWidth: 660,
            background: '#0b1120',
            border: '1px solid rgba(16, 185, 129, 0.45)',
            borderRadius: 16,
            padding: 28,
            boxShadow: '0 24px 64px rgba(0,0,0,0.85)',
            display: 'flex',
            flexDirection: 'column',
            gap: 16
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <ShieldCheck size={24} color="#10b981" />
            <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>
              Part 1 Complete! Ready for Part 2
            </h2>
          </div>
          <p style={{ fontSize: 13, color: '#cbd5e1', lineHeight: 1.6 }}>
            All 3 Spatial Localization blocks ({part1Order.map((c) => CONDITION_META[c].shortLabel).join(' → ')}) have been saved. Next, Part 2 evaluates <strong>Persistent Alarm Fatigue</strong> vs. <strong>Closed-Loop Gaze Cancellation</strong> across 2 blocks using your real-time mirror gaze checks.
          </p>

          {syncError && (
            <div
              style={{
                background: 'rgba(244, 63, 94, 0.14)',
                border: '1px solid rgba(244, 63, 94, 0.45)',
                borderRadius: 10,
                padding: 12,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 10
              }}
            >
              <span style={{ fontSize: 12, color: '#fda4af' }}>
                Cloud upload failed ({syncError}). Data is safe locally.
              </span>
              {sessionBundle && (
                <button
                  className="btn btn-danger"
                  style={{ fontSize: 11 }}
                  onClick={() => downloadSessionJson(sessionBundle)}
                >
                  <Download size={14} /> Download Local Backup (.json)
                </button>
              )}
            </div>
          )}

          <button
            className="btn btn-primary"
            style={{ padding: '12px 20px', fontSize: 14 }}
            onClick={() => setPhase('PART2_READY')}
          >
            <Play size={16} /> Continue to Part 2 Setup
          </button>
        </div>
      )}

      {/* ===================================================================== */}
      {/* STUDY COMPLETE & RESILIENT SYNC SCREEN                                */}
      {/* ===================================================================== */}
      {phase === 'STUDY_COMPLETE' && sessionBundle && (
        <div
          style={{
            margin: 'auto',
            width: '96%',
            maxWidth: 760,
            maxHeight: '90vh',
            overflowY: 'auto',
            background: '#0b1120',
            border: '1px solid rgba(16, 185, 129, 0.5)',
            borderRadius: 16,
            padding: 28,
            boxShadow: '0 24px 64px rgba(0,0,0,0.88)',
            display: 'flex',
            flexDirection: 'column',
            gap: 18
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <CheckCircle2 size={28} color="#10b981" />
              <div>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#10b981', letterSpacing: '0.08em' }}>
                  SESSION COMPLETE • {sessionBundle.participant_id}
                </div>
                <h2 style={{ fontSize: 20, fontWeight: 800, color: '#fff' }}>
                  Thank You for Participating!
                </h2>
              </div>
            </div>

            {/* Cloud Sync Pill */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                padding: '6px 12px',
                borderRadius: 20,
                background:
                  sessionBundle.sync_status === 'SYNCED'
                    ? 'rgba(16, 185, 129, 0.16)'
                    : 'rgba(244, 63, 94, 0.18)',
                border: `1px solid ${
                  sessionBundle.sync_status === 'SYNCED' ? '#10b981' : '#f43f5e'
                }`,
                fontSize: 11.5,
                fontWeight: 700,
                color: sessionBundle.sync_status === 'SYNCED' ? '#34d399' : '#fda4af'
              }}
            >
              {sessionBundle.sync_status === 'SYNCED' ? <Cloud size={15} /> : <CloudOff size={15} />}
              <span>
                {sessionBundle.sync_status === 'SYNCED'
                  ? 'Synced to AWS S3 & DynamoDB'
                  : 'Local Backup Mode (Upload Failed)'}
              </span>
            </div>
          </div>

          {/* Resilient Fallback Banner if Cloud Upload Failed */}
          {sessionBundle.sync_status !== 'SYNCED' && (
            <div
              style={{
                background: 'rgba(244, 63, 94, 0.16)',
                border: '1.5px solid #f43f5e',
                borderRadius: 12,
                padding: 14,
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                gap: 12
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <AlertTriangle size={20} color="#fb7185" />
                <div style={{ fontSize: 12, color: '#fecdd3' }}>
                  <strong>Cloud upload failed after 2 retries:</strong> {syncError || sessionBundle.last_sync_error}.
                  <br />
                  Download the JSON backup below so zero participant telemetry is lost.
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn" onClick={handleRetrySync} disabled={isSyncing}>
                  <RefreshCw size={14} /> {isSyncing ? 'Retrying...' : 'Retry Sync'}
                </button>
                <button
                  className="btn btn-danger"
                  onClick={() => downloadSessionJson(sessionBundle)}
                >
                  <Download size={14} /> Download Local Backup (.json)
                </button>
              </div>
            </div>
          )}

          {/* Quick Session Summary Grid */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10 }}>
            {part1Order.map((cond) => {
              const trials = sessionBundle.trials.filter((t) => t.part === 1 && t.condition === cond);
              const acc = trials.length
                ? Math.round((trials.filter((t) => t.is_correct).length / trials.length) * 100)
                : 0;
              const fb = trials.filter((t) => t.is_front_back_reversal).length;
              return (
                <div key={cond} className="telemetry-item">
                  <div className="telemetry-label">Part 1 • {CONDITION_META[cond].shortLabel}</div>
                  <div className="telemetry-value" style={{ color: CONDITION_META[cond].accentColor }}>
                    {acc}% Acc
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                    {fb} Front-Back Reversals
                  </div>
                </div>
              );
            })}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            {part2Order.map((cond) => {
              const trials = sessionBundle.trials.filter((t) => t.part === 2 && t.condition === cond);
              const avgDur = trials.length
                ? Math.round(trials.reduce((a, b) => a + b.alarm_duration_ms, 0) / trials.length)
                : 0;
              const avgWasted = trials.length
                ? Math.round(trials.reduce((a, b) => a + b.wasted_alarm_ms, 0) / trials.length)
                : 0;
              return (
                <div key={cond} className="telemetry-item">
                  <div className="telemetry-label">Part 2 • {CONDITION_META[cond].shortLabel}</div>
                  <div className="telemetry-value" style={{ color: CONDITION_META[cond].accentColor }}>
                    {avgDur} ms Alarm
                  </div>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                    Mean Wasted Alarm: {avgWasted} ms
                  </div>
                </div>
              );
            })}
          </div>

          {/* Export & Finish Actions */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 6 }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="btn" onClick={() => downloadSessionJson(sessionBundle)}>
                <Download size={14} /> Download Session (.json)
              </button>
              <button
                className="btn"
                onClick={() =>
                  triggerFileDownload(
                    `aura_trials_${sessionBundle.participant_id}.csv`,
                    exportAllToTrialsCsv([sessionBundle]),
                    'text/csv'
                  )
                }
              >
                <Download size={14} /> Export Trials (.csv)
              </button>
            </div>

            <button className="btn btn-primary" onClick={onClose}>
              Return to AURA Drive Cockpit
            </button>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* PROGRESSIVE MULTI-BUBBLE 0-10 SURVEY MODAL                            */}
      {/* ===================================================================== */}
      <ProgressiveSurveyModal
        isOpen={surveyModalOpen}
        part={surveyPart}
        completedConditions={surveyCompletedConds}
        initialScoresByCondition={initialScoresMap[surveyPart] || {}}
        currentScoresByCondition={currentScoresMap[surveyPart] || {}}
        isSubmitting={isSyncing}
        onSubmit={handleSurveySubmit}
      />
    </div>
  );
};
