import React, { useState, useEffect, useRef } from 'react';
import {
  StudyCondition,
  TrialResult,
  ParticipantSession,
  ConditionSummary,
  SUSResponses,
  NasaTlxResponses
} from '../../types/evaluation';
import { ProxyTarget } from '../../types/threats';
import { SpatialAudioEngine } from '../../audio/SpatialAudioEngine';
import { StudyResultsView } from './StudyResultsView';
import { SUSModal } from './SUSModal';
import { NasaTlxModal } from './NasaTlxModal';
import { Activity, X, Play } from 'lucide-react';

interface EvaluationModalProps {
  isOpen: boolean;
  onClose: () => void;
  audioEngine: SpatialAudioEngine;
  isAudioActive: boolean;
  onAudioActiveChange: (active: boolean) => void;
}

const TARGET_POOL: ProxyTarget[] = [
  'LEFT_MIRROR',
  'RIGHT_MIRROR',
  'REAR_MIRROR',
  'FRONT_WINDSHIELD',
  'LEFT_MIRROR',
  'REAR_MIRROR',
  'RIGHT_MIRROR',
  'FRONT_WINDSHIELD',
  'LEFT_MIRROR',
  'REAR_MIRROR'
];

export const EvaluationModal: React.FC<EvaluationModalProps> = ({
  isOpen,
  onClose,
  audioEngine,
  isAudioActive,
  onAudioActiveChange
}) => {
  const [participantId, setParticipantId] = useState('P_01');
  const [condition, setCondition] = useState<StudyCondition>('3D_HRTF');
  const [state, setState] = useState<'IDLE' | 'RUNNING_TRIAL' | 'WAITING_FOR_RESPONSE' | 'FINISHED'>('IDLE');
  const [trialIndex, setTrialIndex] = useState(0);
  const [trialLogs, setTrialLogs] = useState<TrialResult[]>([]);
  const [session, setSession] = useState<ParticipantSession>({
    participantId: 'P_01',
    trials: [],
    hrtfSummary: null,
    stereoSummary: null
  });

  const [showSUS, setShowSUS] = useState(false);
  const [showNASA, setShowNASA] = useState(false);

  const activeTargetRef = useRef<ProxyTarget | null>(null);
  const soundStartTimeRef = useRef<number>(0);
  const trialTimeoutRef = useRef<number | null>(null);
  const initialAudioActiveRef = useRef<boolean>(false);

  useEffect(() => {
    if (isOpen) {
      initialAudioActiveRef.current = isAudioActive;
      audioEngine.setThreatAlertsSuspended(true);
    } else {
      if (trialTimeoutRef.current) {
        clearTimeout(trialTimeoutRef.current);
        trialTimeoutRef.current = null;
      }
      activeTargetRef.current = null;
      setState('IDLE');

      if (!initialAudioActiveRef.current) {
        audioEngine.stop();
        onAudioActiveChange(false);
      }
      audioEngine.setThreatAlertsSuspended(false);
    }
  }, [isOpen]);

  // Keyboard handler for trial responses (supports both 1/2/3/4 and WASD/Arrows)
  useEffect(() => {
    if (!isOpen || state !== 'WAITING_FOR_RESPONSE') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      let response: ProxyTarget | null = null;
      if (e.key === '1' || e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft')
        response = 'LEFT_MIRROR';
      if (e.key === '3' || e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight')
        response = 'RIGHT_MIRROR';
      if (e.key === '4' || e.key === 's' || e.key === 'S' || e.key === 'ArrowDown')
        response = 'REAR_MIRROR';
      if (e.key === '2' || e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp')
        response = 'FRONT_WINDSHIELD';

      if (response) {
        e.preventDefault();
        handleUserResponse(response);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  if (!isOpen) return null;

  const handleCloseModal = () => {
    if (trialTimeoutRef.current) {
      clearTimeout(trialTimeoutRef.current);
      trialTimeoutRef.current = null;
    }
    activeTargetRef.current = null;
    if (!initialAudioActiveRef.current) {
      audioEngine.stop();
      onAudioActiveChange(false);
    }
    audioEngine.setThreatAlertsSuspended(false);
    onClose();
  };

  const startStudyWithCondition = async (cond: StudyCondition) => {
    setCondition(cond);
    await audioEngine.init();
    audioEngine.setThreatAlertsSuspended(true);
    audioEngine.setPanningModel(cond === '3D_HRTF' ? 'HRTF' : 'equalpower');
    setTrialLogs([]);
    setTrialIndex(0);
    setState('RUNNING_TRIAL');
    runNextTrial(0, [], cond);
  };

  const runNextTrial = (idx: number, currentLogs: TrialResult[], activeCond: StudyCondition) => {
    if (idx >= 10) {
      finishStudy(currentLogs, activeCond);
      return;
    }

    setTrialIndex(idx + 1);
    setState('RUNNING_TRIAL');

    const pauseMs = 900 + Math.random() * 700;
    trialTimeoutRef.current = window.setTimeout(() => {
      const target = TARGET_POOL[idx % TARGET_POOL.length];
      activeTargetRef.current = target;

      audioEngine.testDirection(target);
      soundStartTimeRef.current = performance.now();
      setState('WAITING_FOR_RESPONSE');
    }, pauseMs);
  };

  const handleUserResponse = (response: ProxyTarget) => {
    if (state !== 'WAITING_FOR_RESPONSE' || !activeTargetRef.current) return;

    const rt = Math.round(performance.now() - soundStartTimeRef.current);
    const target = activeTargetRef.current;
    const isCorrect = response === target;

    const isFrontBackReversal =
      (target === 'REAR_MIRROR' && response === 'FRONT_WINDSHIELD') ||
      (target === 'FRONT_WINDSHIELD' && response === 'REAR_MIRROR');

    let az = 0;
    if (target === 'LEFT_MIRROR') az = -90;
    if (target === 'RIGHT_MIRROR') az = 90;
    if (target === 'REAR_MIRROR') az = 180;

    const result: TrialResult = {
      trialNumber: trialIndex,
      condition,
      targetProxy: target,
      responseProxy: response,
      isCorrect,
      isFrontBackReversal,
      reactionTimeMs: rt,
      soundAzimuthDeg: az,
      timestamp: new Date().toISOString()
    };

    const updatedLogs = [...trialLogs, result];
    setTrialLogs(updatedLogs);
    activeTargetRef.current = null;

    runNextTrial(trialIndex, updatedLogs, condition);
  };

  const finishStudy = (logs: TrialResult[], completedCond: StudyCondition) => {
    if (trialTimeoutRef.current) {
      clearTimeout(trialTimeoutRef.current);
      trialTimeoutRef.current = null;
    }
    activeTargetRef.current = null;

    audioEngine.setThreatAlertsSuspended(true);
    if (!initialAudioActiveRef.current) {
      audioEngine.stop();
      onAudioActiveChange(false);
    }

    setState('FINISHED');

    const total = logs.length;
    const correct = logs.filter((l) => l.isCorrect).length;
    const fbReversals = logs.filter((l) => l.isFrontBackReversal).length;
    const rts = logs.map((l) => l.reactionTimeMs);
    const meanRt = Math.round(rts.reduce((a, b) => a + b, 0) / (total || 1));
    const sortedRts = [...rts].sort((a, b) => a - b);
    const medianRt = sortedRts[Math.floor(sortedRts.length / 2)] || 0;

    const summary: ConditionSummary = {
      condition: completedCond,
      totalTrials: total,
      correctTrials: correct,
      accuracyPercent: (correct / total) * 100,
      meanReactionTimeMs: meanRt,
      medianReactionTimeMs: medianRt,
      frontBackReversals: fbReversals,
      frontBackReversalRatePercent: (fbReversals / total) * 100
    };

    setSession((prev) => {
      const otherTrials = prev.trials.filter((t) => t.condition !== completedCond);
      return {
        ...prev,
        participantId,
        trials: [...otherTrials, ...logs],
        hrtfSummary: completedCond === '3D_HRTF' ? summary : prev.hrtfSummary,
        stereoSummary: completedCond === 'STEREO_BASELINE' ? summary : prev.stereoSummary
      };
    });
  };

  const handleResetStudy = () => {
    if (trialTimeoutRef.current) {
      clearTimeout(trialTimeoutRef.current);
      trialTimeoutRef.current = null;
    }
    activeTargetRef.current = null;
    setState('IDLE');
    if (!initialAudioActiveRef.current) {
      audioEngine.stop();
      onAudioActiveChange(false);
    }
  };

  const handleSUSSubmit = (responses: SUSResponses, score: number) => {
    setSession((prev) => ({ ...prev, susResponses: responses, susScore: score }));
    setShowSUS(false);
  };

  const handleNasaSubmit = (responses: NasaTlxResponses, score: number) => {
    setSession((prev) => ({ ...prev, nasaTlxResponses: responses, overallTlxScore: score }));
    setShowNASA(false);
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Activity color="var(--accent-cyan)" size={20} />
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>
              HCI Empirical Evaluation: 3D Audio Reaction & A/B Study
            </h2>
          </div>
          <button className="btn" onClick={handleCloseModal} style={{ padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {state === 'IDLE' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                Evaluates human auditory spatial localization accuracy, reaction time (ms), and front-back confusion over 10 randomized trials across 3D HRTF and Stereo Baseline conditions.
              </p>

              <div className="telemetry-grid">
                <div className="telemetry-item">
                  <div className="telemetry-label">Participant ID</div>
                  <input
                    type="text"
                    value={participantId}
                    onChange={(e) => setParticipantId(e.target.value)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: '#fff',
                      fontSize: 14,
                      fontFamily: 'var(--font-mono)',
                      outline: 'none',
                      marginTop: 4,
                      width: '100%'
                    }}
                  />
                </div>

                <div className="telemetry-item">
                  <div className="telemetry-label">Acoustic Condition</div>
                  <select
                    value={condition}
                    onChange={(e) => setCondition(e.target.value as StudyCondition)}
                    style={{
                      background: 'transparent',
                      border: 'none',
                      color: 'var(--accent-cyan)',
                      fontSize: 13,
                      outline: 'none',
                      marginTop: 4,
                      width: '100%',
                      cursor: 'pointer'
                    }}
                  >
                    <option value="3D_HRTF" style={{ background: '#0d121d' }}>
                      Condition B: 3D HRTF + Pinna Filter (Proposed)
                    </option>
                    <option value="STEREO_BASELINE" style={{ background: '#0d121d' }}>
                      Condition A: Stereo Baseline (Conventional)
                    </option>
                  </select>
                </div>
              </div>

              <div className="survey-item">
                <div className="survey-question">Trial Instructions:</div>
                <ul style={{ fontSize: 11, color: 'var(--text-muted)', paddingLeft: 18, lineHeight: 1.6 }}>
                  <li>Wear stereo headphones and set a comfortable volume.</li>
                  <li>In each trial, an acoustic hazard cue will sound from one of the 4 vehicle zones.</li>
                  <li>Immediately press the matching key or click the target button:</li>
                  <ul style={{ paddingLeft: 16 }}>
                    <li>
                      <strong>Key 1 / A / ←</strong> : Left Side Mirror (-90°)
                    </li>
                    <li>
                      <strong>Key 3 / D / →</strong> : Right Side Mirror (+90°)
                    </li>
                    <li>
                      <strong>Key 4 / S / ↓</strong> : Rear-View Mirror (180°)
                    </li>
                    <li>
                      <strong>Key 2 / W / ↑</strong> : Forward Windshield (0°)
                    </li>
                  </ul>
                </ul>
              </div>

              <button
                className="btn btn-primary"
                onClick={() => startStudyWithCondition(condition)}
                style={{ padding: '10px 16px' }}
              >
                <Play size={16} />
                Start 10-Trial Benchmark ({condition === '3D_HRTF' ? '3D HRTF' : 'Stereo Baseline'})
              </button>
            </div>
          )}

          {(state === 'RUNNING_TRIAL' || state === 'WAITING_FOR_RESPONSE') && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 20,
                padding: '20px 0'
              }}
            >
              <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                Condition:{' '}
                <strong style={{ color: '#fff' }}>
                  {condition === '3D_HRTF' ? '3D HRTF Spatial' : 'Stereo Baseline'}
                </strong>{' '}
                • Trial:{' '}
                <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>{trialIndex} / 10</span>
              </div>

              <div
                style={{
                  fontSize: 18,
                  fontWeight: 700,
                  color: state === 'WAITING_FOR_RESPONSE' ? 'var(--accent-amber)' : '#fff'
                }}
              >
                {state === 'WAITING_FOR_RESPONSE'
                  ? '⚡ Identify Hazard Direction NOW!'
                  : '🎧 Preparing acoustic stimulus...'}
              </div>

              {/* Direction Response Buttons */}
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr',
                  gap: 12,
                  width: '100%',
                  maxWidth: 460
                }}
              >
                <button
                  className="btn btn-accent"
                  disabled={state !== 'WAITING_FOR_RESPONSE'}
                  onClick={() => handleUserResponse('LEFT_MIRROR')}
                  style={{ height: 50, fontSize: 13 }}
                >
                  ◀ Left Mirror (1 / A / ←)
                </button>
                <button
                  className="btn btn-accent"
                  disabled={state !== 'WAITING_FOR_RESPONSE'}
                  onClick={() => handleUserResponse('RIGHT_MIRROR')}
                  style={{ height: 50, fontSize: 13 }}
                >
                  Right Mirror (3 / D / →) ▶
                </button>
                <button
                  className="btn btn-accent"
                  disabled={state !== 'WAITING_FOR_RESPONSE'}
                  onClick={() => handleUserResponse('REAR_MIRROR')}
                  style={{ height: 50, fontSize: 13 }}
                >
                  ▼ Rear Mirror (4 / S / ↓)
                </button>
                <button
                  className="btn btn-accent"
                  disabled={state !== 'WAITING_FOR_RESPONSE'}
                  onClick={() => handleUserResponse('FRONT_WINDSHIELD')}
                  style={{ height: 50, fontSize: 13 }}
                >
                  ▲ Forward Windshield (2 / W / ↑)
                </button>
              </div>
            </div>
          )}

          {state === 'FINISHED' && (
            <StudyResultsView
              session={session}
              activeCondition={condition}
              onResetStudy={handleResetStudy}
              onRunCounterpart={(counterpartCond) => startStudyWithCondition(counterpartCond)}
              onOpenSUS={() => setShowSUS(true)}
              onOpenNASA={() => setShowNASA(true)}
            />
          )}
        </div>
      </div>

      {showSUS && <SUSModal onSubmit={handleSUSSubmit} onCancel={() => setShowSUS(false)} />}
      {showNASA && <NasaTlxModal onSubmit={handleNasaSubmit} onCancel={() => setShowNASA(false)} />}
    </div>
  );
};
