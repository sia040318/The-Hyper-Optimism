import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  Part1Condition,
  Part2Condition,
  STUDY_PARAMETERS,
  SURVEY_QUESTIONS,
  StudyConditionType,
  StudyPartNumber,
  getBlindedConditionLabel
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
  isValidParticipantId,
  loadLocalSession,
  normalizeParticipantId,
  saveSessionLocally,
  suggestNextParticipantId,
  syncBlockToCloud
} from '../../services/StudyTelemetryService';
import { ProgressiveSurveyModal } from './ProgressiveSurveyModal';
import { StudyCalibrationStep } from './StudyCalibrationStep';
import { StudyCompleteView } from './StudyCompleteView';
import { GazeZone, InBrowserVisionDiagnostics } from '../../types/gaze';
import { ProxyTarget } from '../../types/threats';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  LogOut,
  Play,
  ShieldCheck
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
  volume: number;
  onVolumeChange: (vol: number) => void;
  onSimulateGaze: (zone: GazeZone, force?: boolean) => void;
  onAudioActiveChange: (active: boolean) => void;
  onStudyVisualModeChange: (mode: StudyVisualMode) => void;
}

type OrchestratorPhase =
  | 'STEP0_GATE'
  | 'PART1_READY'
  | 'PART1_RUNNING'
  | 'PART1_TRANSITION'
  | 'PART2_READY'
  | 'PART2_RUNNING'
  | 'STUDY_COMPLETE';

type TrialSubState = 'INTER_TRIAL' | 'WAITING_FOR_CENTER' | 'AWAITING_RESPONSE' | 'TRIAL_FEEDBACK';

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
  volume,
  onVolumeChange,
  onSimulateGaze,
  onAudioActiveChange,
  onStudyVisualModeChange
}) => {
  // Participant & Passcode State
  const [participantId, setParticipantId] = useState(() =>
    initialParticipantId && isValidParticipantId(initialParticipantId)
      ? initialParticipantId
      : suggestNextParticipantId()
  );
  const [studyPasscode, setStudyPasscode] = useState(
    initialPasscode || STUDY_PARAMETERS.defaultStudyPasscode
  );
  const [phase, setPhase] = useState<OrchestratorPhase>('STEP0_GATE');

  // Step 0 Calibration State
  const [audioOutputLabel, setAudioOutputLabel] = useState('Default Stereo Output');
  const [leftEarTested, setLeftEarTested] = useState(false);
  const [rightEarTested, setRightEarTested] = useState(false);
  const [stereoOverride, setStereoOverride] = useState(false);

  const [trackingMode, setTrackingMode] = useState<'WEBCAM' | 'SIMULATION'>(() =>
    inBrowserVision.getIsRunning() ? 'WEBCAM' : 'WEBCAM'
  );
  const [isWebcamRunning, setIsWebcamRunning] = useState(() => inBrowserVision.getIsRunning());
  const [webcamLoading, setWebcamLoading] = useState(false);
  const [webcamLabel, setWebcamLabel] = useState('In-Browser Webcam (MediaPipe)');
  const [webcamError, setWebcamError] = useState<string | null>(null);
  const [visionDiag, setVisionDiag] = useState<InBrowserVisionDiagnostics | null>(null);
  const [faceDetectedNow, setFaceDetectedNow] = useState(false);
  const [isCalibrated, setIsCalibrated] = useState(() => inBrowserVision.getCalibrationState().isCalibrated);

  // Instant Readiness Check State (no forced 10s wait)
  const [practiceKeyDone, setPracticeKeyDone] = useState(false);
  const [practiceGazeDone, setPracticeGazeDone] = useState(false);
  const [practiceSkipped, setPracticeSkipped] = useState(false);

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
  const [isExitConfirmOpen, setIsExitConfirmOpen] = useState(false);

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

  // Session & Background Sync Telemetry
  const [sessionBundle, setSessionBundle] = useState<StudySessionBundle | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [syncError, setSyncError] = useState<string | null>(null);

  // Video & Overlay Refs (Step 0 inline vs Highway PIP)
  const step0VideoRef = useRef<HTMLVideoElement | null>(null);
  const step0CanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pipVideoRef = useRef<HTMLVideoElement | null>(null);
  const pipCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Trial Timing & Cumulative CV Sampling Refs (fixes stale closures & overwriting metrics)
  const timerIdsRef = useRef<number[]>([]);
  const trialOnsetPerfRef = useRef<number>(0);
  const trialOnsetWallMsRef = useRef<number>(Date.now());
  const trialFirstRespMsRef = useRef<number | null>(null);
  const trialWrongAttemptsRef = useRef<number>(0);
  const trialConfidenceSamplesRef = useRef<number[]>([]);
  const trialFpsSamplesRef = useRef<number[]>([]);
  const trialEyesOffRoadMsRef = useRef<number>(0);
  const lastSamplePerfRef = useRef<number>(0);
  const trialResolvedRef = useRef<boolean>(false);
  const part2ConfirmedRtRef = useRef<number | null>(null);

  const sessionFpsSumRef = useRef<number>(0);
  const sessionFpsCountRef = useRef<number>(0);
  const sessionConfSumRef = useRef<number>(0);
  const sessionConfCountRef = useRef<number>(0);

  const currentGazeRef = useRef<GazeZone>(currentGaze);
  const activePlanRef = useRef<ScheduledBlockPlan | null>(null);
  const currentTrialIdxRef = useRef<number>(0);
  const trialSubStateRef = useRef<TrialSubState>('INTER_TRIAL');
  const sessionBundleRef = useRef<StudySessionBundle | null>(null);
  const phaseRef = useRef<OrchestratorPhase>(phase);
  const part1OrderRef = useRef<Part1Condition[]>(part1Order);
  const part2OrderRef = useRef<Part2Condition[]>(part2Order);
  const part1BlockIdxRef = useRef<number>(part1BlockIdx);
  const part2BlockIdxRef = useRef<number>(part2BlockIdx);
  const isWebcamRunningRef = useRef<boolean>(isWebcamRunning);
  const useSimFallbackRef = useRef<boolean>(trackingMode === 'SIMULATION');

  useEffect(() => { currentGazeRef.current = currentGaze; }, [currentGaze]);
  useEffect(() => { activePlanRef.current = activePlan; }, [activePlan]);
  useEffect(() => { currentTrialIdxRef.current = currentTrialIdx; }, [currentTrialIdx]);
  useEffect(() => { trialSubStateRef.current = trialSubState; }, [trialSubState]);
  useEffect(() => { sessionBundleRef.current = sessionBundle; }, [sessionBundle]);
  useEffect(() => { phaseRef.current = phase; }, [phase]);
  useEffect(() => { part1OrderRef.current = part1Order; }, [part1Order]);
  useEffect(() => { part2OrderRef.current = part2Order; }, [part2Order]);
  useEffect(() => { part1BlockIdxRef.current = part1BlockIdx; }, [part1BlockIdx]);
  useEffect(() => { part2BlockIdxRef.current = part2BlockIdx; }, [part2BlockIdx]);
  useEffect(() => { isWebcamRunningRef.current = isWebcamRunning; }, [isWebcamRunning]);
  useEffect(() => { useSimFallbackRef.current = trackingMode === 'SIMULATION'; }, [trackingMode]);

  const stereoConfirmed = (leftEarTested && rightEarTested) || stereoOverride;
  const useSimFallback = trackingMode === 'SIMULATION';
  const isRunningOnHighway = phase === 'PART1_RUNNING' || phase === 'PART2_RUNNING';

  // Keep orders updated when participantId changes in Step 0
  useEffect(() => {
    setPart1Order(getPart1ConditionOrder(participantId));
    setPart2Order(getPart2ConditionOrder(participantId));
  }, [participantId]);

  const existingLocalSession = useMemo(() => {
    const clean = participantId.trim().toUpperCase();
    if (!isValidParticipantId(clean) || clean === 'P_00') return null;
    if (sessionBundle && sessionBundle.participant_id === clean) return null;
    return loadLocalSession(clean);
  }, [participantId, sessionBundle]);

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

  // Re-attach existing MediaStream to active <video> node whenever phase or webcam state changes
  useEffect(() => {
    if (!isOpen || !isWebcamRunning) return;
    const targetVideo = phase === 'STEP0_GATE' ? step0VideoRef.current : isRunningOnHighway ? pipVideoRef.current : null;
    if (targetVideo) {
      inBrowserVision.attachVideoElement(targetVideo);
    }
  }, [isOpen, isWebcamRunning, phase, isRunningOnHighway, trackingMode]);

  // Ambient engine audio ONLY during active driving trials (never loud drone during Step 0 / surveys!)
  useEffect(() => {
    if (!isOpen) return;
    const activeDriving = isRunningOnHighway && !surveyModalOpen && !isExitConfirmOpen;
    audioEngine.setAmbientEnabled(activeDriving);
  }, [isOpen, isRunningOnHighway, surveyModalOpen, isExitConfirmOpen, audioEngine]);

  // Detect Audio Output & Video Devices on open
  useEffect(() => {
    if (!isOpen) return;
    setIsWebcamRunning(inBrowserVision.getIsRunning());
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

        const conf = msg.face_detected ? msg.confidence : 0;
        trialConfidenceSamplesRef.current.push(conf);
        sessionConfSumRef.current += conf;
        sessionConfCountRef.current += 1;

        if (msg.diagnostics?.fps) {
          trialFpsSamplesRef.current.push(msg.diagnostics.fps);
          sessionFpsSumRef.current += msg.diagnostics.fps;
          sessionFpsCountRef.current += 1;
        }
        if (msg.gaze_zone !== 'CENTER' && dt > 0) {
          trialEyesOffRoadMsRef.current += dt;
        }
      }
    });

    let rafId: number;
    const drawOverlay = () => {
      const v = phaseRef.current === 'STEP0_GATE' ? step0VideoRef.current : pipVideoRef.current;
      const c = phaseRef.current === 'STEP0_GATE' ? step0CanvasRef.current : pipCanvasRef.current;
      if (inBrowserVision.getIsRunning() && c && v && v.videoWidth > 0 && v.videoHeight > 0) {
        if (c.width !== v.videoWidth || c.height !== v.videoHeight) {
          c.width = v.videoWidth;
          c.height = v.videoHeight;
        }
        inBrowserVision.drawDebugOverlay(c);
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
      audioEngine.setAmbientEnabled(false);
      audioEngine.setStudyAudioMode(null);
      onStudyVisualModeChange('OFF');
      gameWindowRef.current?.setStudyAutopilotMode(false, false);
    }
  }, [isOpen, clearAllTimers, audioEngine, onStudyVisualModeChange, gameWindowRef]);

  const handleStartWebcam = async () => {
    setWebcamError(null);
    if (!step0VideoRef.current) return;
    if (inBrowserVision.getIsRunning()) {
      inBrowserVision.attachVideoElement(step0VideoRef.current);
      setIsWebcamRunning(true);
      setTrackingMode('WEBCAM');
      return;
    }
    setWebcamLoading(true);
    const ok = await inBrowserVision.start(step0VideoRef.current);
    setWebcamLoading(false);
    if (ok) {
      setIsWebcamRunning(true);
      setTrackingMode('WEBCAM');
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
      setWebcamError('Webcam access denied or unavailable. Switch to Key / Click mode above to continue.');
    }
  };

  const handleCalibrateCenter = () => {
    inBrowserVision.calibrateCenter();
    setIsCalibrated(true);
    audioEngine.ensureReadyWithoutAmbient().then(() => audioEngine.playAcknowledgeEarcon());
  };

  // Step 0 Readiness Check Listeners (no forced 10s timer)
  useEffect(() => {
    if (!isOpen || phase !== 'STEP0_GATE') return;
    if (
      (currentGaze === 'LEFT_MIRROR' || currentGaze === 'RIGHT_MIRROR' || currentGaze === 'REAR_MIRROR') &&
      !practiceGazeDone
    ) {
      audioEngine.ensureReadyWithoutAmbient().then(() => audioEngine.playAcknowledgeEarcon());
      setPracticeGazeDone(true);
    }
  }, [isOpen, phase, currentGaze, practiceGazeDone, audioEngine]);

  useEffect(() => {
    if (!isOpen || phase !== 'STEP0_GATE') return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (getDirectionFromKey(e.key)) {
        setPracticeKeyDone(true);
      }
      const gaze = getMirrorKeyGaze(e.key);
      if (gaze && trackingMode === 'SIMULATION') {
        onSimulateGaze(gaze, true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, phase, trackingMode, onSimulateGaze]);

  // --- BLOCK COMPLETION & PROGRESSIVE SURVEY HANDLER ---
  const finishBlockAndOpenSurvey = useCallback(
    (plan: ScheduledBlockPlan) => {
      clearAllTimers();
      audioEngine.stopStudyTrialAlert();
      audioEngine.setAmbientEnabled(false);
      gameWindowRef.current?.clearStudyHazards(false);

      const orderList = plan.part === 1 ? part1OrderRef.current : part2OrderRef.current;
      // Use plan.conditionOrder (1-based) to avoid any stale state index closure bug!
      const completedForPart = orderList.slice(0, plan.conditionOrder);

      setSurveyPart(plan.part);
      setSurveyCompletedConds(completedForPart);
      setSurveyModalOpen(true);
    },
    [audioEngine, clearAllTimers, gameWindowRef]
  );

  // --- INITIALIZE STUDY SESSION & ENTER PART 1 ---
  const handleBeginEmpiricalStudy = async () => {
    const cleanPid = normalizeParticipantId(participantId);
    setParticipantId(cleanPid);
    if (!isValidParticipantId(cleanPid)) return;

    await audioEngine.ensureReadyWithoutAmbient();
    onAudioActiveChange(true);
    audioEngine.stopStudyTrialAlert();

    const p1Order = getPart1ConditionOrder(cleanPid);
    const p2Order = getPart2ConditionOrder(cleanPid);
    setPart1Order(p1Order);
    setPart2Order(p2Order);
    part1OrderRef.current = p1Order;
    part2OrderRef.current = p2Order;

    sessionFpsSumRef.current = 0;
    sessionFpsCountRef.current = 0;
    sessionConfSumRef.current = 0;
    sessionConfCountRef.current = 0;

    const hardwareInfo: StudyHardwareInfo = {
      audio_output_device: audioOutputLabel,
      webcam_label: isWebcamRunning ? webcamLabel : 'Simulation Fallback',
      webcam_fps_avg: visionDiag?.fps || 0,
      cv_confidence_avg: isWebcamRunning ? 0.95 : 1.0,
      input_mode: isWebcamRunning && trackingMode === 'WEBCAM' ? 'WEBCAM_MEDIAPIPE' : 'SIMULATION_FALLBACK',
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
    sessionBundleRef.current = initialBundle;
    setPart1BlockIdx(0);
    setPart2BlockIdx(0);
    part1BlockIdxRef.current = 0;
    part2BlockIdxRef.current = 0;
    setInitialScoresMap({ 1: {}, 2: {} });
    setCurrentScoresMap({ 1: {}, 2: {} });

    onStudyVisualModeChange('PART1_BLIND_AUDIO');
    gameWindowRef.current?.setStudyAutopilotMode(true, true);
    setPhase('PART1_READY');
  };

  // --- RESUME EXISTING LOCAL SESSION ---
  const handleResumeExistingSession = async () => {
    if (!existingLocalSession) return;
    await audioEngine.ensureReadyWithoutAmbient();
    onAudioActiveChange(true);
    audioEngine.stopStudyTrialAlert();

    const bundle = existingLocalSession;
    const p1Ord = bundle.part1_condition_order?.length
      ? bundle.part1_condition_order
      : getPart1ConditionOrder(bundle.participant_id);
    const p2Ord = bundle.part2_condition_order?.length
      ? bundle.part2_condition_order
      : getPart2ConditionOrder(bundle.participant_id);

    setPart1Order(p1Ord);
    setPart2Order(p2Ord);
    part1OrderRef.current = p1Ord;
    part2OrderRef.current = p2Ord;

    // Hydrate survey maps
    const initMap: Record<StudyPartNumber, Record<string, Record<string, number>>> = { 1: {}, 2: {} };
    const currMap: Record<StudyPartNumber, Record<string, Record<string, number>>> = { 1: {}, 2: {} };
    (bundle.surveys || []).forEach((s) => {
      if (!initMap[s.part][s.condition]) initMap[s.part][s.condition] = {};
      if (!currMap[s.part][s.condition]) currMap[s.part][s.condition] = {};
      initMap[s.part][s.condition][s.question_id] = s.initial_score;
      currMap[s.part][s.condition][s.question_id] = s.final_score;
    });
    setInitialScoresMap(initMap);
    setCurrentScoresMap(currMap);
    setSessionBundle(bundle);
    sessionBundleRef.current = bundle;

    const doneBlocks = new Set(bundle.completed_blocks || []);
    const nextP1Idx = p1Ord.findIndex((c) => !doneBlocks.has(`PART1#${c}`));
    if (nextP1Idx !== -1) {
      setPart1BlockIdx(nextP1Idx);
      part1BlockIdxRef.current = nextP1Idx;
      onStudyVisualModeChange('PART1_BLIND_AUDIO');
      gameWindowRef.current?.setStudyAutopilotMode(true, true);
      setPhase('PART1_READY');
      return;
    }

    const nextP2Idx = p2Ord.findIndex((c) => !doneBlocks.has(`PART2#${c}`));
    if (nextP2Idx !== -1) {
      setPart1BlockIdx(p1Ord.length - 1);
      part1BlockIdxRef.current = p1Ord.length - 1;
      setPart2BlockIdx(nextP2Idx);
      part2BlockIdxRef.current = nextP2Idx;
      onStudyVisualModeChange('PART2_MIRROR_HAZARD');
      gameWindowRef.current?.setStudyAutopilotMode(true, true);
      setPhase('PART2_READY');
      return;
    }

    setPhase('STUDY_COMPLETE');
  };

  // --- PART 1 EXECUTION ---
  const runPart1Trial = useCallback(
    (plan: ScheduledBlockPlan, idx: number) => {
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

      setStatusBanner(`Cruising at 100 km/h • Listen for cue (${idx + 1}/${plan.trials.length})`);
      audioEngine.stopStudyTrialAlert();

      scheduleTimeout(() => {
        if (phaseRef.current !== 'PART1_RUNNING') return;
        trialOnsetPerfRef.current = performance.now();
        trialOnsetWallMsRef.current = Date.now();
        lastSamplePerfRef.current = trialOnsetPerfRef.current;
        setTrialSubState('AWAITING_RESPONSE');
        trialSubStateRef.current = 'AWAITING_RESPONSE';
        setStatusBanner('Identify hazard direction now (W / A / S / D)');

        audioEngine.triggerStudyTrialAlert(trial.targetZone, 7.5);

        scheduleTimeout(() => {
          if (!trialResolvedRef.current && trialSubStateRef.current === 'AWAITING_RESPONSE') {
            completePart1Trial('TIMEOUT');
          }
        }, STUDY_PARAMETERS.part1ResponseTimeoutMs);
      }, trial.interTrialDelayMs);
    },
    [audioEngine, clearAllTimers, finishBlockAndOpenSurvey, scheduleTimeout]
  );

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
    phaseRef.current = 'PART1_RUNNING';
    runPart1Trial(plan, 0);
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
          : isWebcamRunningRef.current
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
        onset_timestamp_ms: trialOnsetWallMsRef.current,
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
        const avgFps =
          sessionFpsCountRef.current > 0
            ? Math.round(sessionFpsSumRef.current / sessionFpsCountRef.current)
            : prev.hardware_info.webcam_fps_avg;
        const avgConf =
          sessionConfCountRef.current > 0
            ? Math.round((sessionConfSumRef.current / sessionConfCountRef.current) * 100) / 100
            : prev.hardware_info.cv_confidence_avg;
        const updated: StudySessionBundle = {
          ...prev,
          hardware_info: {
            ...prev.hardware_info,
            webcam_fps_avg: avgFps,
            cv_confidence_avg: avgConf
          },
          trials: [...prev.trials, record]
        };
        saveSessionLocally(updated);
        sessionBundleRef.current = updated;
        return updated;
      });

      setTrialSubState('TRIAL_FEEDBACK');
      trialSubStateRef.current = 'TRIAL_FEEDBACK';
      setStatusBanner(
        response === 'TIMEOUT'
          ? 'Response window elapsed — advancing'
          : `Recorded (${rtMs} ms)`
      );

      scheduleTimeout(() => {
        runPart1Trial(plan, idx + 1);
      }, 420);
    },
    [audioEngine, clearAllTimers, runPart1Trial, scheduleTimeout]
  );

  // Keyboard listener for Part 1 directional response
  useEffect(() => {
    if (phase !== 'PART1_RUNNING' || trialSubState !== 'AWAITING_RESPONSE' || isExitConfirmOpen) return;
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
  }, [phase, trialSubState, isExitConfirmOpen, completePart1Trial]);

  // --- PART 2 EXECUTION (PERSISTENT ALARM FATIGUE VS GAZE-CONTINGENT 3D) ---
  const triggerPart2Onset = useCallback(
    (plan: ScheduledBlockPlan, idx: number) => {
      if (phaseRef.current !== 'PART2_RUNNING') return;
      const trial = plan.trials[idx];
      if (!trial) return;

      trialOnsetPerfRef.current = performance.now();
      trialOnsetWallMsRef.current = Date.now();
      lastSamplePerfRef.current = trialOnsetPerfRef.current;
      setTrialSubState('AWAITING_RESPONSE');
      trialSubStateRef.current = 'AWAITING_RESPONSE';

      gameWindowRef.current?.spawnStudyHazardCar(trial.targetZone, trial.trialIndex);
      audioEngine.triggerStudyTrialAlert(trial.targetZone, 7.5);
      setStatusBanner(
        plan.condition === 'GAZE_CONTINGENT_3D'
          ? 'Verify threat in matching mirror (300 ms dwell)'
          : 'Alert active — check the matching mirror'
      );

      scheduleTimeout(() => {
        if (!trialResolvedRef.current && part2ConfirmedRtRef.current === null) {
          setShowGazeFallbackPrompt(true);
        }
      }, STUDY_PARAMETERS.gazeFallbackTimeoutMs);

      if (plan.condition === 'TRADITIONAL_PERSISTENT') {
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
        scheduleTimeout(() => {
          if (!trialResolvedRef.current) {
            const elapsed = Math.round(performance.now() - trialOnsetPerfRef.current);
            finalizePart2Trial(plan, idx, null, elapsed, 'TIMEOUT');
          }
        }, 8000);
      }
    },
    [audioEngine, gameWindowRef, scheduleTimeout]
  );

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
          : isWebcamRunningRef.current
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
        onset_timestamp_ms: trialOnsetWallMsRef.current,
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
        const avgFps =
          sessionFpsCountRef.current > 0
            ? Math.round(sessionFpsSumRef.current / sessionFpsCountRef.current)
            : prev.hardware_info.webcam_fps_avg;
        const avgConf =
          sessionConfCountRef.current > 0
            ? Math.round((sessionConfSumRef.current / sessionConfCountRef.current) * 100) / 100
            : prev.hardware_info.cv_confidence_avg;
        const updated: StudySessionBundle = {
          ...prev,
          hardware_info: {
            ...prev.hardware_info,
            webcam_fps_avg: avgFps,
            cv_confidence_avg: avgConf
          },
          trials: [...prev.trials, record]
        };
        saveSessionLocally(updated);
        sessionBundleRef.current = updated;
        return updated;
      });

      setTrialSubState('TRIAL_FEEDBACK');
      trialSubStateRef.current = 'TRIAL_FEEDBACK';
      setShowGazeFallbackPrompt(false);
      onSimulateGaze('CENTER', true);

      scheduleTimeout(() => {
        runPart2Trial(plan, idx + 1);
      }, 650);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [audioEngine, clearAllTimers, gameWindowRef, onSimulateGaze, scheduleTimeout]
  );

  const runPart2Trial = useCallback(
    (plan: ScheduledBlockPlan, idx: number) => {
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
      onSimulateGaze('CENTER', true);
      setStatusBanner(`Eyes forward on highway • Trial ${idx + 1}/${plan.trials.length}`);

      scheduleTimeout(() => {
        if (phaseRef.current !== 'PART2_RUNNING') return;
        // Eyes-on-road gate: wait until participant returns gaze to CENTER before onset
        if (
          isWebcamRunningRef.current &&
          !useSimFallbackRef.current &&
          currentGazeRef.current !== 'CENTER'
        ) {
          setTrialSubState('WAITING_FOR_CENTER');
          trialSubStateRef.current = 'WAITING_FOR_CENTER';
          setStatusBanner('Look forward at the highway to begin next trial');
          return;
        }
        triggerPart2Onset(plan, idx);
      }, trial.interTrialDelayMs);
    },
    [audioEngine, clearAllTimers, finishBlockAndOpenSurvey, gameWindowRef, onSimulateGaze, scheduleTimeout, triggerPart2Onset]
  );

  // Resume Part 2 onset as soon as gaze returns to CENTER
  useEffect(() => {
    if (phase === 'PART2_RUNNING' && trialSubState === 'WAITING_FOR_CENTER' && currentGaze === 'CENTER') {
      const plan = activePlanRef.current;
      if (plan) {
        triggerPart2Onset(plan, currentTrialIdxRef.current);
      }
    }
  }, [phase, trialSubState, currentGaze, triggerPart2Onset]);

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
    // Suppress visual directional spoilers in BOTH Part 1 & Part 2!
    gameWindowRef.current?.setStudyAutopilotMode(true, true);
    gameWindowRef.current?.clearStudyHazards(false);
    onSimulateGaze('CENTER', true);

    setPhase('PART2_RUNNING');
    phaseRef.current = 'PART2_RUNNING';
    runPart2Trial(plan, 0);
  };

  // Monitor mirror gaze during Part 2 AWAITING_RESPONSE
  useEffect(() => {
    if (phase !== 'PART2_RUNNING' || trialSubState !== 'AWAITING_RESPONSE' || isExitConfirmOpen) return;
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
            // Clear the 8000ms safety timeout BEFORE scheduling the 420ms earcon beat (prevents timeout race!)
            clearAllTimers();
            setStatusBanner(`Gaze verified in ${elapsedMs} ms • Alert silenced`);
            scheduleTimeout(() => {
              finalizePart2Trial(plan, currentTrialIdxRef.current, elapsedMs, elapsedMs, trial.targetZone);
            }, 420);
          } else {
            setStatusBanner(
              `Mirror checked at ${elapsedMs} ms — persistent alarm continues until 3.5s`
            );
          }
        }
      } else if (part2ConfirmedRtRef.current === null) {
        trialWrongAttemptsRef.current += 1;
      }
    }
  }, [phase, trialSubState, isExitConfirmOpen, currentGaze, clearAllTimers, finalizePart2Trial, gameWindowRef, scheduleTimeout]);

  // Allow keyboard 1/3/4 or mirror clicks when simulation mode or fallback timeout triggers
  useEffect(() => {
    if (phase !== 'PART2_RUNNING' || trialSubState !== 'AWAITING_RESPONSE' || isExitConfirmOpen) return;
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
  }, [phase, trialSubState, isExitConfirmOpen, useSimFallback, showGazeFallbackPrompt, isWebcamRunning, onSimulateGaze]);

  // --- SURVEY SUBMIT WITH NON-BLOCKING BACKGROUND AWS SYNC ---
  const handleSurveySubmit = (updatedScoresByCond: Record<string, Record<string, number>>) => {
    const part = surveyPart;
    const applicableQs = SURVEY_QUESTIONS.filter((q) => q.applicableParts.includes(part));
    const latestCond = surveyCompletedConds[surveyCompletedConds.length - 1];

    const nextInitialForPart = { ...(initialScoresMap[part] || {}) };
    if (latestCond && !nextInitialForPart[latestCond]) {
      nextInitialForPart[latestCond] = { ...(updatedScoresByCond[latestCond] || {}) };
    }
    const nextCurrentForPart = { ...(currentScoresMap[part] || {}), ...updatedScoresByCond };

    setInitialScoresMap((prev) => ({ ...prev, [part]: nextInitialForPart }));
    setCurrentScoresMap((prev) => ({ ...prev, [part]: nextCurrentForPart }));

    const nowIso = new Date().toISOString();
    const orderList = part === 1 ? part1OrderRef.current : part2OrderRef.current;
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

    const isPart1Last = part === 1 && part1BlockIdxRef.current >= orderList.length - 1;
    const isPart2Last = part === 2 && part2BlockIdxRef.current >= orderList.length - 1;

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
        updated_at: nowIso,
        sync_status: 'PENDING'
      };

      setSessionBundle(nextBundle);
      sessionBundleRef.current = nextBundle;
      saveSessionLocally(nextBundle);

      // Fire cloud sync in background so UI never freezes waiting for retries
      setIsSyncing(true);
      syncBlockToCloud(nextBundle, part, latestCond, studyPasscode).then((res) => {
        setIsSyncing(false);
        if (res.ok) {
          setSyncError(null);
          setSessionBundle((b) => (b ? { ...b, sync_status: 'SYNCED', s3_key: res.s3Key } : b));
        } else {
          setSyncError(res.error || 'Cloud sync failed.');
          setSessionBundle((b) =>
            b ? { ...b, sync_status: 'LOCAL_FALLBACK', last_sync_error: res.error } : b
          );
        }
      });
    }

    setSurveyModalOpen(false);

    if (part === 1) {
      if (part1BlockIdxRef.current + 1 < part1OrderRef.current.length) {
        const nextIdx = part1BlockIdxRef.current + 1;
        setPart1BlockIdx(nextIdx);
        part1BlockIdxRef.current = nextIdx;
        setPhase('PART1_READY');
      } else {
        setPhase('PART1_TRANSITION');
      }
    } else {
      if (part2BlockIdxRef.current + 1 < part2OrderRef.current.length) {
        const nextIdx = part2BlockIdxRef.current + 1;
        setPart2BlockIdx(nextIdx);
        part2BlockIdxRef.current = nextIdx;
        setPhase('PART2_READY');
      } else {
        audioEngine.setStudyAudioMode(null);
        audioEngine.setAmbientEnabled(false);
        onStudyVisualModeChange('OFF');
        gameWindowRef.current?.setStudyAutopilotMode(false, false);
        setPhase('STUDY_COMPLETE');
      }
    }
  };

  // --- PAUSE / EXIT CONFIRMATION HANDLERS ---
  const handleRequestPauseExit = () => {
    clearAllTimers();
    audioEngine.stopStudyTrialAlert();
    audioEngine.setAmbientEnabled(false);
    gameWindowRef.current?.clearStudyHazards(false);
    setIsExitConfirmOpen(true);
  };

  const handleRestartCurrentBlock = () => {
    setIsExitConfirmOpen(false);
    const plan = activePlanRef.current;
    if (!plan) return;
    // Discard incomplete trials from current interrupted block so dataset stays balanced
    setSessionBundle((prev) => {
      if (!prev) return prev;
      const cleaned: StudySessionBundle = {
        ...prev,
        trials: prev.trials.filter((t) => !(t.part === plan.part && t.condition === plan.condition))
      };
      saveSessionLocally(cleaned);
      sessionBundleRef.current = cleaned;
      return cleaned;
    });
    if (plan.part === 1) {
      startPart1Block(part1BlockIdxRef.current);
    } else {
      startPart2Block(part2BlockIdxRef.current);
    }
  };

  const handleSaveCompletedAndExit = () => {
    setIsExitConfirmOpen(false);
    const plan = activePlanRef.current;
    if (plan) {
      setSessionBundle((prev) => {
        if (!prev) return prev;
        const cleaned: StudySessionBundle = {
          ...prev,
          trials: prev.trials.filter((t) => !(t.part === plan.part && t.condition === plan.condition))
        };
        saveSessionLocally(cleaned);
        sessionBundleRef.current = cleaned;
        return cleaned;
      });
    }
    onClose();
  };

  // --- START NEXT PARTICIPANT RESET ---
  const handleStartNextParticipant = () => {
    clearAllTimers();
    audioEngine.stopStudyTrialAlert();
    audioEngine.setAmbientEnabled(false);
    audioEngine.setStudyAudioMode(null);
    onStudyVisualModeChange('OFF');
    gameWindowRef.current?.setStudyAutopilotMode(false, false);

    const nextPid = suggestNextParticipantId();
    setParticipantId(nextPid);
    setSessionBundle(null);
    sessionBundleRef.current = null;
    setActivePlan(null);
    activePlanRef.current = null;
    setPart1BlockIdx(0);
    setPart2BlockIdx(0);
    setInitialScoresMap({ 1: {}, 2: {} });
    setCurrentScoresMap({ 1: {}, 2: {} });
    setSyncError(null);
    setPracticeKeyDone(false);
    setPracticeGazeDone(false);
    setPracticeSkipped(false);
    setLeftEarTested(false);
    setRightEarTested(false);
    setStereoOverride(false);
    setPhase('STEP0_GATE');
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
   * Researcher E2E Verification Runner (P_00 only)
   */
  const handleRunAutomatedP00Test = async () => {
    const pid = 'P_00';
    const p1Ord = getPart1ConditionOrder(pid);
    const p2Ord = getPart2ConditionOrder(pid);
    const nowIso = new Date().toISOString();

    const trials: StudyTrialRecord[] = [];
    const surveys: StudySurveyRecord[] = [];
    const completedBlocks: string[] = [];

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
          beep_pulse_count: Math.max(1, Math.round(rt / 360)),
          eyes_off_road_ms: 0,
          cv_confidence_avg: 0.95,
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
              ? 5.5
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
          cv_confidence_avg: 0.95,
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
        cv_confidence_avg: 0.95,
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
    setPhase('STUDY_COMPLETE');
    const res = await syncBlockToCloud(bundle, 2, p2Ord[p2Ord.length - 1], studyPasscode);
    setIsSyncing(false);
    if (res.ok) {
      setSyncError(null);
      setSessionBundle((b) => (b ? { ...b, sync_status: 'SYNCED', s3_key: res.s3Key } : b));
    } else {
      setSyncError(res.error || 'Cloud sync failed.');
      setSessionBundle((b) => (b ? { ...b, sync_status: 'LOCAL_FALLBACK', last_sync_error: res.error } : b));
    }
  };

  // Build blinded condition label map for surveys so participants remain naive to condition hypotheses
  const blindedLabelsMap = useMemo(() => {
    const map: Record<string, string> = {};
    part1Order.forEach((cond, i) => {
      map[cond] = getBlindedConditionLabel(1, i + 1);
    });
    part2Order.forEach((cond, i) => {
      map[cond] = getBlindedConditionLabel(2, i + 1);
    });
    return map;
  }, [part1Order, part2Order]);

  if (!isOpen) return null;

  const pidValid = isValidParticipantId(participantId);
  const readinessOk = (practiceKeyDone && practiceGazeDone) || practiceSkipped;
  const trackingReady = trackingMode === 'SIMULATION' || isWebcamRunning;
  const canBeginStudy = pidValid && stereoConfirmed && trackingReady && readinessOk;
  const fpsOk = (visionDiag?.fps ?? 0) >= STUDY_PARAMETERS.minRequiredWebcamFps;

  return (
    <div
      className={`fixed inset-0 z-[10000] flex flex-col p-4 sm:p-6 ${
        isRunningOnHighway ? 'pointer-events-none bg-transparent' : 'bg-[#09090b]/90 backdrop-blur-md'
      }`}
    >
      {/* STEP 0: HARDWARE & CALIBRATION GATE */}
      {phase === 'STEP0_GATE' && (
        <StudyCalibrationStep
          participantId={participantId}
          onParticipantIdChange={(raw) => setParticipantId(raw.toUpperCase())}
          onNormalizeParticipantId={() => setParticipantId((p) => normalizeParticipantId(p))}
          existingSession={existingLocalSession}
          onResumeExistingSession={handleResumeExistingSession}
          onSuggestNextId={() => setParticipantId(suggestNextParticipantId())}
          studyPasscode={studyPasscode}
          onStudyPasscodeChange={setStudyPasscode}
          part1Order={part1Order}
          part2Order={part2Order}
          audioOutputLabel={audioOutputLabel}
          volume={volume}
          onVolumeChange={onVolumeChange}
          leftEarTested={leftEarTested}
          rightEarTested={rightEarTested}
          stereoVerified={stereoConfirmed}
          onTestEar={(ch) => {
            audioEngine.playStereoChannelTest(ch);
            if (ch === 'LEFT') setLeftEarTested(true);
            else setRightEarTested(true);
          }}
          onToggleStereoOverride={setStereoOverride}
          trackingMode={trackingMode}
          onSelectTrackingMode={(mode) => {
            setTrackingMode(mode);
            if (mode === 'SIMULATION') {
              setWebcamError(null);
            }
          }}
          isWebcamRunning={isWebcamRunning}
          webcamLoading={webcamLoading}
          webcamError={webcamError}
          faceDetectedNow={faceDetectedNow}
          visionDiag={visionDiag}
          currentGaze={currentGaze}
          isCalibrated={isCalibrated}
          onStartWebcam={handleStartWebcam}
          onCalibrateCenter={handleCalibrateCenter}
          videoRef={step0VideoRef}
          canvasRef={step0CanvasRef}
          practiceKeyDone={practiceKeyDone}
          practiceGazeDone={practiceGazeDone}
          practiceSkipped={practiceSkipped}
          onPlaySampleCue={() => {
            audioEngine.ensureReadyWithoutAmbient().then(() => {
              audioEngine.setStudyAudioMode('SPATIAL_3D');
              audioEngine.testDirection('LEFT_MIRROR');
            });
          }}
          onTriggerPracticeMirror={() => {
            onSimulateGaze('LEFT_MIRROR', true);
          }}
          onSkipPractice={() => setPracticeSkipped(true)}
          onRunAutomatedP00Test={handleRunAutomatedP00Test}
          isSyncing={isSyncing}
          canBeginStudy={canBeginStudy}
          onBeginStudy={handleBeginEmpiricalStudy}
          onClose={onClose}
        />
      )}

      {/* PART 1 & PART 2 BLINDED BLOCK INTRO BRIEFING */}
      {(phase === 'PART1_READY' || phase === 'PART2_READY') && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 36, mass: 0.8 }}
          className="mx-auto my-auto flex w-full max-w-xl flex-col gap-5 rounded-[14px] border border-border bg-card p-6 sm:p-8"
        >
          {(() => {
            const isPart1 = phase === 'PART1_READY';
            const blockNum = isPart1 ? part1BlockIdx + 1 : part2BlockIdx + 1;
            const totalBlocks = isPart1 ? part1Order.length : part2Order.length;
            const blindedLabel = getBlindedConditionLabel(isPart1 ? 1 : 2, blockNum);

            return (
              <>
                <div>
                  <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#38bdf8]">
                    {isPart1 ? 'Part 1 • Spatial Localization' : 'Part 2 • Mirror Verification'} • Block{' '}
                    {blockNum} of {totalBlocks}
                  </div>
                  <h2 className="mt-1.5 font-heading text-2xl font-semibold tracking-[-0.03em] text-foreground">
                    {blindedLabel}
                  </h2>
                  <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                    {isPart1
                      ? 'The vehicle cruises autonomously at 100 km/h. Listen to each audio warning and indicate which direction the alert came from as quickly and accurately as possible.'
                      : 'Keep your eyes ahead on the highway. When an audio alert sounds, glance at the matching mirror and hold your gaze for 300 ms to inspect the vehicle.'}
                  </p>
                </div>

                <div className="space-y-2 rounded-[10px] border border-border bg-[#09090b]/60 p-4 text-[13px] leading-relaxed text-muted-foreground">
                  {isPart1 ? (
                    <>
                      <div className="font-medium text-foreground">
                        Controls ({STUDY_PARAMETERS.part1TrialsPerCondition} trials)
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1 font-mono text-xs text-foreground">
                        <span className="rounded border border-border bg-secondary px-2 py-1">W / ↑ Front</span>
                        <span className="rounded border border-border bg-secondary px-2 py-1">A / ← Left</span>
                        <span className="rounded border border-border bg-secondary px-2 py-1">S / ↓ Rear</span>
                        <span className="rounded border border-border bg-secondary px-2 py-1">D / → Right</span>
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="font-medium text-foreground">
                        Instructions ({STUDY_PARAMETERS.part2TrialsPerCondition} trials)
                      </div>
                      <ul className="list-disc space-y-1 pl-4">
                        <li>Maintain forward focus between trials.</li>
                        <li>Look at Left Wing, Right Wing, or Rear-View mirror on alert onset.</li>
                        {(useSimFallback || !isWebcamRunning) && (
                          <li>
                            Fallback keys:{' '}
                            <span className="font-mono text-foreground">1</span> Left •{' '}
                            <span className="font-mono text-foreground">4</span> Rear •{' '}
                            <span className="font-mono text-foreground">3</span> Right (or click mirror).
                          </li>
                        )}
                      </ul>
                    </>
                  )}
                </div>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <Button type="button" variant="outline" onClick={onClose} className="h-9 text-sm">
                    Exit Study
                  </Button>
                  <Button
                    type="button"
                    variant="default"
                    onClick={() => (isPart1 ? startPart1Block(part1BlockIdx) : startPart2Block(part2BlockIdx))}
                    className="h-9 px-5 text-sm font-medium"
                  >
                    <Play size={15} strokeWidth={1.75} />
                    Start {blindedLabel}
                  </Button>
                </div>
              </>
            );
          })()}
        </motion.div>
      )}

      {/* ACTIVE HIGHWAY TRIAL HUD (Slim top bar above 13.5% Rear-View Mirror — zero overlap!) */}
      {isRunningOnHighway && activePlan && (
        <div className="pointer-events-none fixed inset-0 flex flex-col justify-between px-4 pt-2.5 pb-4">
          {/* Compact Top Status Bar */}
          <div className="pointer-events-auto mx-auto flex max-w-4xl items-center gap-3 rounded-lg border border-white/[0.10] bg-[#111114]/92 px-3.5 py-1.5 backdrop-blur-md">
            <div className="flex items-center gap-2 font-mono text-[11px] tabular-nums text-muted-foreground">
              <span className="font-semibold text-foreground">{activePlan.participantId}</span>
              <span className="opacity-30">|</span>
              <span className="text-[#38bdf8]">
                {getBlindedConditionLabel(activePlan.part, activePlan.conditionOrder)}
              </span>
              <span className="opacity-30">|</span>
              <span>
                Trial <strong className="text-foreground">{currentTrialIdx + 1}</strong>/{activePlan.trials.length}
              </span>
            </div>

            <div className="hidden h-3.5 w-px bg-white/[0.08] sm:block" />

            <div
              className={`text-xs font-medium ${
                trialSubState === 'AWAITING_RESPONSE' || trialSubState === 'WAITING_FOR_CENTER'
                  ? 'text-[#fbbf24]'
                  : trialSubState === 'TRIAL_FEEDBACK'
                    ? 'text-[#34d399]'
                    : 'text-foreground'
              }`}
            >
              {statusBanner}
            </div>

            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={handleRequestPauseExit}
              className="ml-1 h-6 gap-1 px-2 text-[11px] text-muted-foreground hover:text-foreground"
            >
              <LogOut size={12} /> Exit
            </Button>
          </div>

          {/* Compact Highway Webcam PIP (Bottom Right, tucked cleanly above dock) */}
          {isWebcamRunning && trackingMode === 'WEBCAM' && (
            <div
              className={`pointer-events-none fixed right-4 bottom-20 w-[148px] overflow-hidden rounded-[10px] border bg-[#09090b] ${
                faceDetectedNow ? 'border-[#34d399]/60' : 'border-[#fbbf24]/60'
              }`}
            >
              <div className="relative aspect-[4/3] w-full">
                <video
                  ref={pipVideoRef}
                  playsInline
                  muted
                  className="h-full w-full -scale-x-100 object-cover"
                />
                <canvas ref={pipCanvasRef} className="pointer-events-none absolute inset-0 h-full w-full" />
                {visionDiag && (
                  <div
                    className={`absolute top-1 left-1 rounded bg-black/75 px-1.5 py-0.5 font-mono text-[9px] tabular-nums ${
                      fpsOk ? 'text-[#34d399]' : 'text-[#fbbf24]'
                    }`}
                  >
                    {visionDiag.fps} FPS • {currentGaze}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Bottom Directional Response Dock (Part 1) */}
          {phase === 'PART1_RUNNING' && (
            <div className="pointer-events-auto mx-auto flex flex-wrap items-center justify-center gap-2 rounded-[10px] border border-white/[0.10] bg-[#111114]/92 p-2 backdrop-blur-md">
              <Button
                type="button"
                variant="outline"
                disabled={trialSubState !== 'AWAITING_RESPONSE'}
                onClick={() => completePart1Trial('LEFT_MIRROR')}
                className="h-9 min-w-[112px] gap-1.5 font-mono text-xs"
              >
                <ArrowLeft size={14} /> Left [A]
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={trialSubState !== 'AWAITING_RESPONSE'}
                onClick={() => completePart1Trial('FRONT_WINDSHIELD')}
                className="h-9 min-w-[112px] gap-1.5 font-mono text-xs"
              >
                <ArrowUp size={14} /> Front [W]
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={trialSubState !== 'AWAITING_RESPONSE'}
                onClick={() => completePart1Trial('REAR_MIRROR')}
                className="h-9 min-w-[112px] gap-1.5 font-mono text-xs"
              >
                <ArrowDown size={14} /> Rear [S]
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={trialSubState !== 'AWAITING_RESPONSE'}
                onClick={() => completePart1Trial('RIGHT_MIRROR')}
                className="h-9 min-w-[112px] gap-1.5 font-mono text-xs"
              >
                Right [D] <ArrowRight size={14} />
              </Button>
            </div>
          )}

          {/* Part 2 Mirror Fallback Controls */}
          {phase === 'PART2_RUNNING' && (useSimFallback || showGazeFallbackPrompt || !isWebcamRunning) && (
            <div className="pointer-events-auto mx-auto flex flex-wrap items-center justify-center gap-2 rounded-[10px] border border-white/[0.10] bg-[#111114]/92 px-3 py-2 backdrop-blur-md">
              <span className="font-mono text-[11px] text-muted-foreground">
                {showGazeFallbackPrompt ? 'Fallback:' : 'Mirror Check:'}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={trialSubState !== 'AWAITING_RESPONSE'}
                onClick={() => onSimulateGaze('LEFT_MIRROR', true)}
                className="h-8 font-mono text-xs"
              >
                [1] Left
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={trialSubState !== 'AWAITING_RESPONSE'}
                onClick={() => onSimulateGaze('REAR_MIRROR', true)}
                className="h-8 font-mono text-xs"
              >
                [4] Rear
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={trialSubState !== 'AWAITING_RESPONSE'}
                onClick={() => onSimulateGaze('RIGHT_MIRROR', true)}
                className="h-8 font-mono text-xs"
              >
                [3] Right
              </Button>
            </div>
          )}
        </div>
      )}

      {/* PART 1 -> PART 2 TRANSITION BRIEFING */}
      {phase === 'PART1_TRANSITION' && (
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 36, mass: 0.8 }}
          className="mx-auto my-auto flex w-full max-w-xl flex-col gap-5 rounded-[14px] border border-border bg-card p-6 sm:p-8"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-[#34d399]/30 bg-[#34d399]/10">
              <ShieldCheck size={18} strokeWidth={1.75} className="text-[#34d399]" />
            </div>
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#34d399]">
                Part 1 Complete
              </div>
              <h2 className="mt-0.5 font-heading text-xl font-semibold tracking-[-0.025em] text-foreground">
                Ready for Part 2: Mirror Verification
              </h2>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">
            All 3 spatial audio localization blocks have been saved. Next, Part 2 evaluates two alert interaction systems across 2 blocks using your mirror checks.
          </p>

          <div className="flex items-center justify-end gap-3 pt-1">
            <Button
              type="button"
              variant="default"
              onClick={() => {
                onStudyVisualModeChange('PART2_MIRROR_HAZARD');
                setPhase('PART2_READY');
              }}
              className="h-9 px-5 text-sm font-medium"
            >
              <Play size={15} strokeWidth={1.75} /> Continue to Part 2
            </Button>
          </div>
        </motion.div>
      )}

      {/* STUDY COMPLETE & EXPORT VIEW */}
      {phase === 'STUDY_COMPLETE' && sessionBundle && (
        <StudyCompleteView
          sessionBundle={sessionBundle}
          part1Order={part1Order}
          part2Order={part2Order}
          isSyncing={isSyncing}
          syncError={syncError}
          onRetrySync={handleRetrySync}
          onStartNextParticipant={handleStartNextParticipant}
          onReturnToCockpit={onClose}
        />
      )}

      {/* PROGRESSIVE MULTI-BUBBLE 0-10 SURVEY MODAL */}
      <ProgressiveSurveyModal
        isOpen={surveyModalOpen}
        part={surveyPart}
        completedConditions={surveyCompletedConds}
        initialScoresByCondition={initialScoresMap[surveyPart] || {}}
        currentScoresByCondition={currentScoresMap[surveyPart] || {}}
        blindedLabels={blindedLabelsMap}
        stepContextLabel={`Part ${surveyPart} • Evaluation #${surveyCompletedConds.length}`}
        isSubmitting={false}
        onSubmit={handleSurveySubmit}
      />

      {/* PAUSE / EXIT CONFIRMATION DIALOG */}
      <Dialog open={isExitConfirmOpen} onOpenChange={setIsExitConfirmOpen}>
        <DialogContent className="z-[10800] sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Study Block Paused</DialogTitle>
            <DialogDescription>
              Completed blocks and surveys remain saved locally. Choose whether to restart this block cleanly or exit back to the cockpit.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              onClick={handleSaveCompletedAndExit}
            >
              Save Completed & Exit
            </Button>
            <Button
              type="button"
              variant="default"
              onClick={handleRestartCurrentBlock}
            >
              Restart Current Block
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};
