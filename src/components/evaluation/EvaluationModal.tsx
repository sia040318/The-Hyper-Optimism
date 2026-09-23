import React, { useState, useEffect, useRef } from 'react';
import { StudyCondition, TrialResult, ParticipantSession, ConditionSummary, SUSResponses, NasaTlxResponses } from '../../types/evaluation';
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
}

const TARGET_POOL: ProxyTarget[] = [
  'LEFT_MIRROR', 'RIGHT_MIRROR', 'REAR_MIRROR', 'LEFT_MIRROR', 'RIGHT_MIRROR',
  'REAR_MIRROR', 'FRONT_WINDSHIELD', 'LEFT_MIRROR', 'RIGHT_MIRROR', 'REAR_MIRROR'
];

export const EvaluationModal: React.FC<EvaluationModalProps> = ({ isOpen, onClose, audioEngine }) => {
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

  // Keyboard handler for trial responses
  useEffect(() => {
    if (!isOpen || state !== 'WAITING_FOR_RESPONSE') return;

    const handleKeyDown = (e: KeyboardEvent) => {
      let response: ProxyTarget | null = null;
      if (e.key === 'a' || e.key === 'A' || e.key === 'ArrowLeft') response = 'LEFT_MIRROR';
      if (e.key === 'd' || e.key === 'D' || e.key === 'ArrowRight') response = 'RIGHT_MIRROR';
      if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') response = 'REAR_MIRROR';
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') response = 'FRONT_WINDSHIELD';

      if (response) {
        handleUserResponse(response);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, state]);

  if (!isOpen) return null;

  const startStudy = async () => {
    await audioEngine.init();
    audioEngine.setPanningModel(condition === '3D_HRTF' ? 'HRTF' : 'equalpower');
    setTrialLogs([]);
    setTrialIndex(0);
    setState('RUNNING_TRIAL');
    runNextTrial(0, []);
  };

  const runNextTrial = (idx: number, currentLogs: TrialResult[]) => {
    if (idx >= 10) {
      finishStudy(currentLogs);
      return;
    }

    setTrialIndex(idx + 1);
    setState('RUNNING_TRIAL');

    // Random inter-trial pause between 1.0s and 1.8s
    const pauseMs = 1000 + Math.random() * 800;
    trialTimeoutRef.current = window.setTimeout(() => {
      const target = TARGET_POOL[idx % TARGET_POOL.length];
      activeTargetRef.current = target;
      
      // Trigger directional sound
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

    // Check front-back confusion
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

    // Proceed to next trial after brief delay
    runNextTrial(trialIndex, updatedLogs);
  };

  const finishStudy = (logs: TrialResult[]) => {
    setState('FINISHED');

    const total = logs.length;
    const correct = logs.filter((l) => l.isCorrect).length;
    const fbReversals = logs.filter((l) => l.isFrontBackReversal).length;
    const rts = logs.map((l) => l.reactionTimeMs);
    const meanRt = Math.round(rts.reduce((a, b) => a + b, 0) / (total || 1));
    const sortedRts = [...rts].sort((a, b) => a - b);
    const medianRt = sortedRts[Math.floor(sortedRts.length / 2)] || 0;

    const summary: ConditionSummary = {
      condition,
      totalTrials: total,
      correctTrials: correct,
      accuracyPercent: (correct / total) * 100,
      meanReactionTimeMs: meanRt,
      medianReactionTimeMs: medianRt,
      frontBackReversals: fbReversals,
      frontBackReversalRatePercent: (fbReversals / total) * 100
    };

    setSession((prev) => ({
      ...prev,
      participantId,
      trials: logs,
      hrtfSummary: summary
    }));
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
              HCI Empirical Evaluation: 3D Audio Reaction Study
            </h2>
          </div>
          <button className="btn" onClick={onClose} style={{ padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          {state === 'IDLE' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                This test evaluates human auditory spatial localization accuracy, reaction time (ms), and front-back confusion over 10 randomized trials.
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
                    <option value="3D_HRTF" style={{ background: '#0d121d' }}>3D HRTF (Proposed System)</option>
                    <option value="STEREO_BASELINE" style={{ background: '#0d121d' }}>Stereo Baseline (Conventional)</option>
                  </select>
                </div>
              </div>

              <div className="survey-item">
                <div className="survey-question">Trial Instructions:</div>
                <ul style={{ fontSize: 11, color: 'var(--text-muted)', paddingLeft: 18, lineHeight: 1.6 }}>
                  <li>Wear stereo headphones and set comfortable volume.</li>
                  <li>In each trial, a 3D audio hazard cue will sound from one of the vehicle mirror zones.</li>
                  <li>Immediately press the corresponding key or click the mirror button:</li>
                  <ul style={{ paddingLeft: 16 }}>
                    <li><strong>A or ←</strong> : Left Side Mirror (-90°)</li>
                    <li><strong>D or →</strong> : Right Side Mirror (+90°)</li>
                    <li><strong>S or ↓</strong> : Rear-View Mirror (180°)</li>
                    <li><strong>W or ↑</strong> : Forward Windshield (0°)</li>
                  </ul>
                </ul>
              </div>

              <button className="btn btn-primary" onClick={startStudy} style={{ padding: '10px 16px' }}>
                <Play size={16} />
                Start 10-Trial Reaction Benchmark
              </button>
            </div>
          )}

          {(state === 'RUNNING_TRIAL' || state === 'WAITING_FOR_RESPONSE') && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20, padding: '20px 0' }}>
              <div style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                Trial Progress: <span style={{ color: 'var(--accent-cyan)', fontWeight: 700 }}>{trialIndex} / 10</span>
              </div>

              <div style={{ fontSize: 18, fontWeight: 700, color: state === 'WAITING_FOR_RESPONSE' ? 'var(--accent-amber)' : '#fff' }}>
                {state === 'WAITING_FOR_RESPONSE' ? '⚡ Identify Direction NOW!' : '🎧 Preparing acoustic cue...'}
              </div>

              {/* Direction Response Buttons */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, width: '100%', maxWidth: 440 }}>
                <button
                  className="btn btn-accent"
                  disabled={state !== 'WAITING_FOR_RESPONSE'}
                  onClick={() => handleUserResponse('LEFT_MIRROR')}
                  style={{ height: 50, fontSize: 13 }}
                >
                  Left Mirror (A / ←)
                </button>
                <button
                  className="btn btn-accent"
                  disabled={state !== 'WAITING_FOR_RESPONSE'}
                  onClick={() => handleUserResponse('RIGHT_MIRROR')}
                  style={{ height: 50, fontSize: 13 }}
                >
                  Right Mirror (D / →)
                </button>
                <button
                  className="btn btn-accent"
                  disabled={state !== 'WAITING_FOR_RESPONSE'}
                  onClick={() => handleUserResponse('REAR_MIRROR')}
                  style={{ height: 50, fontSize: 13 }}
                >
                  Rear Mirror (S / ↓)
                </button>
                <button
                  className="btn btn-accent"
                  disabled={state !== 'WAITING_FOR_RESPONSE'}
                  onClick={() => handleUserResponse('FRONT_WINDSHIELD')}
                  style={{ height: 50, fontSize: 13 }}
                >
                  Forward Windshield (W / ↑)
                </button>
              </div>
            </div>
          )}

          {state === 'FINISHED' && (
            <StudyResultsView
              session={session}
              onResetStudy={() => setState('IDLE')}
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
