import React, { useState } from 'react';
import { motion } from 'framer-motion';
import {
  CONDITION_META,
  Part1Condition,
  Part2Condition,
  STUDY_PARAMETERS
} from '../../config/studyConfig';
import { GazeZone, InBrowserVisionDiagnostics } from '../../types/gaze';
import { StudySessionBundle, isValidParticipantId } from '../../services/StudyTelemetryService';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import {
  Activity,
  Camera,
  ChevronDown,
  ChevronUp,
  Crosshair,
  Eye,
  Headphones,
  Keyboard,
  Play,
  RotateCcw,
  Volume2,
  X
} from 'lucide-react';

interface StudyCalibrationStepProps {
  participantId: string;
  onParticipantIdChange: (raw: string) => void;
  onNormalizeParticipantId: () => void;
  existingSession: StudySessionBundle | null;
  onResumeExistingSession: () => void;
  onSuggestNextId: () => void;
  studyPasscode: string;
  onStudyPasscodeChange: (token: string) => void;
  part1Order: Part1Condition[];
  part2Order: Part2Condition[];
  audioOutputLabel: string;
  volume: number;
  onVolumeChange: (vol: number) => void;
  leftEarTested: boolean;
  rightEarTested: boolean;
  stereoVerified: boolean;
  onTestEar: (channel: 'LEFT' | 'RIGHT') => void;
  onToggleStereoOverride: (checked: boolean) => void;
  trackingMode: 'WEBCAM' | 'SIMULATION';
  onSelectTrackingMode: (mode: 'WEBCAM' | 'SIMULATION') => void;
  isWebcamRunning: boolean;
  webcamLoading: boolean;
  webcamError: string | null;
  faceDetectedNow: boolean;
  visionDiag: InBrowserVisionDiagnostics | null;
  currentGaze: GazeZone;
  isCalibrated: boolean;
  onStartWebcam: () => void;
  onCalibrateCenter: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  practiceKeyDone: boolean;
  practiceGazeDone: boolean;
  practiceSkipped: boolean;
  onPlaySampleCue: () => void;
  onTriggerPracticeMirror: () => void;
  onSkipPractice: () => void;
  onRunAutomatedP00Test: () => void;
  isSyncing: boolean;
  canBeginStudy: boolean;
  onBeginStudy: () => void;
  onClose: () => void;
}

export const StudyCalibrationStep: React.FC<StudyCalibrationStepProps> = ({
  participantId,
  onParticipantIdChange,
  onNormalizeParticipantId,
  existingSession,
  onResumeExistingSession,
  onSuggestNextId,
  studyPasscode,
  onStudyPasscodeChange,
  part1Order,
  part2Order,
  audioOutputLabel,
  volume,
  onVolumeChange,
  leftEarTested,
  rightEarTested,
  stereoVerified,
  onTestEar,
  onToggleStereoOverride,
  trackingMode,
  onSelectTrackingMode,
  isWebcamRunning,
  webcamLoading,
  webcamError,
  faceDetectedNow,
  visionDiag,
  currentGaze,
  isCalibrated,
  onStartWebcam,
  onCalibrateCenter,
  videoRef,
  canvasRef,
  practiceKeyDone,
  practiceGazeDone,
  practiceSkipped,
  onPlaySampleCue,
  onTriggerPracticeMirror,
  onSkipPractice,
  onRunAutomatedP00Test,
  isSyncing,
  canBeginStudy,
  onBeginStudy,
  onClose
}) => {
  const [showResearcherOptions, setShowResearcherOptions] = useState(false);

  const pidValid = isValidParticipantId(participantId);
  const fps = visionDiag?.fps ?? 0;
  const fpsOk = fps >= STUDY_PARAMETERS.minRequiredWebcamFps;
  const readinessOk = (practiceKeyDone && practiceGazeDone) || practiceSkipped;
  const trackingReady = trackingMode === 'SIMULATION' || isWebcamRunning;

  const missingSteps: string[] = [];
  if (!pidValid) missingSteps.push('valid Participant ID');
  if (!stereoVerified) missingSteps.push('L/R stereo test');
  if (!trackingReady) missingSteps.push('webcam or Keyboard mode');
  if (!readinessOk) missingSteps.push('readiness check');

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 36, mass: 0.8 }}
      className="mx-auto my-auto flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-[14px] border border-border bg-card"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-4 border-b border-border bg-popover/50 px-6 py-5">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary">
            <Activity size={16} strokeWidth={1.75} className="text-[#38bdf8]" />
          </div>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#38bdf8]">
              KNU HCI Lab • Empirical Evaluation
            </div>
            <h1 className="mt-0.5 font-heading text-xl font-semibold tracking-[-0.025em] text-foreground">
              Step 0 — Hardware & Gaze Calibration
            </h1>
          </div>
        </div>

        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={onClose}
          title="Return to Cockpit"
        >
          <X size={16} strokeWidth={1.75} />
        </Button>
      </div>

      {/* Scrollable Body */}
      <div className="flex-1 space-y-5 overflow-y-auto p-6">
        {/* Participant ID Row */}
        <div className="rounded-[10px] border border-border bg-[#09090b]/60 p-4">
          <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <label
                htmlFor="study-participant-id"
                className="block font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground"
              >
                Participant ID (e.g. P_01 or type 1)
              </label>
              <div className="flex items-center gap-2">
                <Input
                  id="study-participant-id"
                  type="text"
                  value={participantId}
                  onChange={(e) => onParticipantIdChange(e.target.value)}
                  onBlur={onNormalizeParticipantId}
                  placeholder="P_01"
                  className={`h-9 max-w-[180px] font-mono text-sm font-semibold ${
                    !pidValid ? 'border-[#f87171]/60' : ''
                  }`}
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onSuggestNextId}
                  className="h-9 text-xs text-muted-foreground"
                >
                  Next Free ID
                </Button>
              </div>
              {!pidValid && (
                <p className="text-xs text-[#f87171]">
                  Format must be P_00 through P_999 (typing a number auto-formats on blur).
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="font-mono text-[11px] text-muted-foreground">
                Part 1: {STUDY_PARAMETERS.part1TrialsPerCondition}×3 trials
              </Badge>
              <Badge variant="outline" className="font-mono text-[11px] text-muted-foreground">
                Part 2: {STUDY_PARAMETERS.part2TrialsPerCondition}×2 trials
              </Badge>
            </div>
          </div>

          {/* Duplicate / Resume Notice */}
          {existingSession && participantId.trim().toUpperCase() !== 'P_00' && (
            <div className="mt-3 flex flex-col justify-between gap-2 rounded-md border border-[#fbbf24]/30 bg-[#fbbf24]/10 px-3 py-2.5 text-xs sm:flex-row sm:items-center">
              <span className="text-[#fafafa]">
                Local session exists for <strong className="font-mono">{existingSession.participant_id}</strong>{' '}
                ({existingSession.completed_blocks.length}/5 blocks completed).
              </span>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={onResumeExistingSession}
                  className="border-[#fbbf24]/40 bg-card text-foreground"
                >
                  Resume Progress
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="xs"
                  onClick={onSuggestNextId}
                  className="text-muted-foreground"
                >
                  Use Next ID
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* Asymmetric 2-Card Calibration Grid */}
        <div className="grid grid-cols-1 gap-4 md:grid-cols-12">
          {/* Card 1: Audio & Stereo Headphone Check (5 cols) */}
          <div
            className={`flex flex-col justify-between gap-4 rounded-[10px] border bg-[#09090b]/60 p-4 md:col-span-5 ${
              stereoVerified ? 'border-[#34d399]/35' : 'border-border'
            }`}
          >
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Headphones size={15} strokeWidth={1.75} className="text-[#38bdf8]" />
                  <span>1. Stereo & Volume</span>
                </div>
                {stereoVerified && (
                  <Badge
                    variant="outline"
                    className="border-[#34d399]/35 bg-[#34d399]/10 font-mono text-[10px] text-[#34d399]"
                  >
                    Verified
                  </Badge>
                )}
              </div>

              <div className="truncate font-mono text-[11px] text-muted-foreground" title={audioOutputLabel}>
                Output: {audioOutputLabel}
              </div>

              {/* Volume Control */}
              <div className="space-y-1.5 rounded-md border border-border bg-card p-3">
                <div className="flex items-center justify-between font-mono text-[11px]">
                  <span className="text-muted-foreground">COMFORT VOLUME</span>
                  <span className="font-semibold tabular-nums text-foreground">
                    {Math.round(volume * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  aria-label="Study Master Volume"
                  min={10}
                  max={100}
                  value={Math.round(volume * 100)}
                  onChange={(e) => onVolumeChange(parseInt(e.target.value, 10) / 100)}
                  className="h-1.5 w-full cursor-pointer accent-[#38bdf8]"
                />
              </div>

              {/* Left / Right Channel Test */}
              <div className="grid grid-cols-2 gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onTestEar('LEFT')}
                  className={`h-9 text-xs ${
                    leftEarTested ? 'border-[#38bdf8]/45 bg-[#38bdf8]/10 text-foreground' : ''
                  }`}
                >
                  <Volume2 size={14} strokeWidth={1.75} />
                  {leftEarTested ? 'Left OK' : 'Test Left'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => onTestEar('RIGHT')}
                  className={`h-9 text-xs ${
                    rightEarTested ? 'border-[#38bdf8]/45 bg-[#38bdf8]/10 text-foreground' : ''
                  }`}
                >
                  <Volume2 size={14} strokeWidth={1.75} />
                  {rightEarTested ? 'Right OK' : 'Test Right'}
                </Button>
              </div>
            </div>

            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={stereoVerified}
                onChange={(e) => onToggleStereoOverride(e.target.checked)}
                className="accent-[#38bdf8]"
              />
              <span>Stereo L/R channels verified clearly</span>
            </label>
          </div>

          {/* Card 2: Gaze Tracking & Inline Calibration (7 cols) */}
          <div
            className={`flex flex-col justify-between gap-3 rounded-[10px] border bg-[#09090b]/60 p-4 md:col-span-7 ${
              trackingReady && (trackingMode === 'SIMULATION' || faceDetectedNow)
                ? 'border-[#34d399]/35'
                : 'border-border'
            }`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Eye size={15} strokeWidth={1.75} className="text-[#38bdf8]" />
                <span>2. Mirror Gaze Tracker</span>
              </div>

              {/* Mode Switch */}
              <div className="inline-flex rounded-md border border-border bg-card p-0.5">
                <button
                  type="button"
                  onClick={() => onSelectTrackingMode('WEBCAM')}
                  className={`inline-flex items-center gap-1.5 rounded-[4px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    trackingMode === 'WEBCAM'
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Camera size={12} /> Webcam
                </button>
                <button
                  type="button"
                  onClick={() => onSelectTrackingMode('SIMULATION')}
                  className={`inline-flex items-center gap-1.5 rounded-[4px] px-2.5 py-1 text-[11px] font-medium transition-colors ${
                    trackingMode === 'SIMULATION'
                      ? 'bg-secondary text-foreground'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <Keyboard size={12} /> Key / Click
                </button>
              </div>
            </div>

            {trackingMode === 'WEBCAM' ? (
              <div className="space-y-3">
                {/* Inline Live Preview (Always mounted inside Card 2 when WEBCAM selected) */}
                <div className="relative aspect-[16/10] w-full overflow-hidden rounded-lg border border-border bg-black">
                  <video
                    ref={videoRef}
                    playsInline
                    muted
                    className={`h-full w-full -scale-x-100 object-cover ${
                      isWebcamRunning ? 'block' : 'hidden'
                    }`}
                  />
                  <canvas
                    ref={canvasRef}
                    className={`pointer-events-none absolute inset-0 h-full w-full ${
                      isWebcamRunning ? 'block' : 'hidden'
                    }`}
                  />

                  {!isWebcamRunning && (
                    <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
                      <Camera size={22} strokeWidth={1.5} className="text-muted-foreground" />
                      <p className="max-w-xs text-xs text-muted-foreground">
                        Runs locally in browser via MediaPipe WebAssembly. Enable camera to calibrate neutral gaze.
                      </p>
                    </div>
                  )}

                  {isWebcamRunning && (
                    <>
                      <div className="absolute top-2 left-2 rounded bg-black/75 px-2 py-0.5 font-mono text-[10px] tabular-nums text-foreground">
                        <span className={fpsOk ? 'text-[#34d399]' : 'text-[#fbbf24]'}>{fps} FPS</span>
                        {' • '}
                        {currentGaze}
                      </div>
                      <div
                        className={`absolute top-2 right-2 rounded px-2 py-0.5 font-mono text-[10px] ${
                          faceDetectedNow
                            ? 'bg-[#34d399]/15 text-[#34d399]'
                            : 'bg-[#fbbf24]/15 text-[#fbbf24]'
                        }`}
                      >
                        {faceDetectedNow ? 'FACE LOCKED' : 'ALIGN FACE'}
                      </div>
                    </>
                  )}
                </div>

                {webcamError && (
                  <p className="text-xs leading-relaxed text-[#f87171]">{webcamError}</p>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {!isWebcamRunning ? (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onStartWebcam}
                      disabled={webcamLoading}
                      className="h-9 flex-1 text-xs"
                    >
                      <Camera size={14} strokeWidth={1.75} />
                      {webcamLoading ? 'Starting MediaPipe...' : 'Enable Webcam Tracker'}
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="outline"
                      onClick={onCalibrateCenter}
                      disabled={!faceDetectedNow}
                      className={`h-9 flex-1 text-xs ${
                        isCalibrated ? 'border-[#34d399]/40 bg-[#34d399]/10 text-[#34d399]' : ''
                      }`}
                    >
                      <Crosshair size={14} strokeWidth={1.75} />
                      {isCalibrated ? 'Neutral Gaze Centered (Recalibrate)' : 'Recenter Neutral Gaze'}
                    </Button>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col justify-center gap-2 rounded-lg border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
                <div className="font-medium text-foreground">Keyboard / Click Mirror Mode Active</div>
                <p>
                  During Part 2 mirror verification, look at mirrors using keys{' '}
                  <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-foreground">1</kbd> Left,{' '}
                  <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-foreground">4</kbd> Rear,{' '}
                  <kbd className="rounded border border-border bg-secondary px-1.5 py-0.5 font-mono text-[11px] text-foreground">3</kbd> Right, or click any mirror directly.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* 3. Instant Readiness Check (No Forced 10-second Timer!) */}
        <div className="flex flex-col justify-between gap-4 rounded-[10px] border border-border bg-popover/60 p-4 sm:flex-row sm:items-center">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <span>3. Interactive Readiness Check</span>
              {readinessOk && (
                <Badge
                  variant="outline"
                  className="border-[#34d399]/35 bg-[#34d399]/10 font-mono text-[10px] text-[#34d399]"
                >
                  Ready
                </Badge>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              Press any direction key (<span className="font-mono text-foreground">W A S D</span> / Arrows) and confirm one mirror check (<span className="font-mono text-foreground">C6→G6</span> chime).
            </p>
            <div className="flex flex-wrap items-center gap-4 pt-1 font-mono text-[11px]">
              <span className={practiceKeyDone ? 'text-[#34d399]' : 'text-muted-foreground'}>
                {practiceKeyDone ? '✓ Direction key ok' : '○ Press W / A / S / D'}
              </span>
              <span className={practiceGazeDone ? 'text-[#34d399]' : 'text-muted-foreground'}>
                {practiceGazeDone
                  ? '✓ Mirror check ok'
                  : trackingMode === 'WEBCAM'
                    ? '○ Glance at a mirror'
                    : '○ Press 1 / 3 / 4 or Test Mirror'}
              </span>
            </div>
          </div>

          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onPlaySampleCue}
              className="h-8 text-xs"
            >
              <Volume2 size={13} /> Sample Cue
            </Button>
            {trackingMode === 'SIMULATION' && !practiceGazeDone && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={onTriggerPracticeMirror}
                className="h-8 text-xs"
              >
                Test Mirror
              </Button>
            )}
            {!readinessOk && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onSkipPractice}
                className="h-8 text-xs text-muted-foreground"
              >
                Skip
              </Button>
            )}
          </div>
        </div>

        {/* Collapsible Researcher Options (Blinded from Participants by Default) */}
        <div className="rounded-[10px] border border-border bg-[#09090b]/40">
          <button
            type="button"
            onClick={() => setShowResearcherOptions((v) => !v)}
            className="flex w-full items-center justify-between px-4 py-2.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <span>Researcher Options (Token, Latin Square & Self-Test)</span>
            {showResearcherOptions ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
          </button>

          {showResearcherOptions && (
            <div className="space-y-3 border-t border-border px-4 py-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1">
                  <label
                    htmlFor="study-access-token"
                    className="block font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground"
                  >
                    Study Access Token
                  </label>
                  <Input
                    id="study-access-token"
                    type="password"
                    value={studyPasscode}
                    onChange={(e) => onStudyPasscodeChange(e.target.value)}
                    className="h-8 font-mono text-xs"
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                    Assigned Counterbalance ({participantId})
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {part1Order.map((c, idx) => (
                      <Badge key={c} variant="outline" className="font-mono text-[10px]">
                        P1.{idx + 1} {CONDITION_META[c].shortLabel}
                      </Badge>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[11px]">
                    {part2Order.map((c, idx) => (
                      <Badge key={c} variant="outline" className="font-mono text-[10px]">
                        P2.{idx + 1} {CONDITION_META[c].shortLabel}
                      </Badge>
                    ))}
                  </div>
                </div>
              </div>

              {participantId.trim().toUpperCase() === 'P_00' && (
                <div className="flex items-center justify-between border-t border-border pt-2.5">
                  <span className="text-xs text-muted-foreground">
                    Synthetic E2E Pipeline Verification (P_00)
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={isSyncing}
                    onClick={onRunAutomatedP00Test}
                    className="h-8 text-xs"
                  >
                    <RotateCcw size={13} />
                    {isSyncing ? 'Syncing P_00...' : 'Run P_00 Self-Test'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <Separator />

      {/* Footer Launch */}
      <div className="flex flex-col justify-between gap-3 bg-popover/50 px-6 py-4 sm:flex-row sm:items-center">
        <span className="text-xs text-muted-foreground">
          {canBeginStudy
            ? 'Auto-saved locally after every block with background AWS sync.'
            : `Complete: ${missingSteps.join(', ')}`}
        </span>

        <Button
          type="button"
          variant="default"
          disabled={!canBeginStudy}
          onClick={onBeginStudy}
          className="h-9 px-5 text-sm font-medium"
        >
          <Play size={15} strokeWidth={1.75} />
          Begin Part 1
        </Button>
      </div>
    </motion.div>
  );
};
