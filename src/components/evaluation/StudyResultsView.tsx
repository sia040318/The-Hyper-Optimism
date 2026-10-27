import React from 'react';
import { ParticipantSession, StudyCondition } from '../../types/evaluation';
import { Download, CheckCircle, RotateCcw, ArrowRightLeft } from 'lucide-react';

interface StudyResultsViewProps {
  session: ParticipantSession;
  activeCondition?: StudyCondition;
  onResetStudy: () => void;
  onRunCounterpart?: (condition: StudyCondition) => void;
  onOpenSUS: () => void;
  onOpenNASA: () => void;
}

export const StudyResultsView: React.FC<StudyResultsViewProps> = ({
  session,
  activeCondition = '3D_HRTF',
  onResetStudy,
  onRunCounterpart,
  onOpenSUS,
  onOpenNASA
}) => {
  const currentSummary =
    activeCondition === 'STEREO_BASELINE'
      ? session.stereoSummary || session.hrtfSummary
      : session.hrtfSummary || session.stereoSummary;

  const hrtf = session.hrtfSummary;
  const stereo = session.stereoSummary;

  const exportCSV = () => {
    if (!session.trials.length) return;

    let csv =
      'Participant_ID,Trial_Number,Condition,Target_Proxy,Response_Proxy,Is_Correct,Is_Front_Back_Reversal,Reaction_Time_MS,Sound_Azimuth_Deg,Timestamp\n';
    session.trials.forEach((t) => {
      csv += `${session.participantId},${t.trialNumber},${t.condition},${t.targetProxy},${t.responseProxy},${
        t.isCorrect ? 1 : 0
      },${t.isFrontBackReversal ? 1 : 0},${t.reactionTimeMs},${t.soundAzimuthDeg},"${t.timestamp}"\n`;
    });

    if (session.susScore !== undefined) {
      csv += `\n# System Usability Scale (SUS) Score: ${session.susScore} / 100\n`;
    }
    if (session.overallTlxScore !== undefined) {
      csv += `# NASA-TLX Cognitive Workload Score: ${session.overallTlxScore} / 100\n`;
    }

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `HCI_ADAS_Study_${session.participantId}_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const missingCondition: StudyCondition | null = !hrtf
    ? '3D_HRTF'
    : !stereo
    ? 'STEREO_BASELINE'
    : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <CheckCircle size={22} color="var(--accent-emerald)" />
          <h3 style={{ fontSize: 16, color: '#fff' }}>
            HCI Reaction Benchmark Complete ({currentSummary?.condition === '3D_HRTF' ? '3D HRTF' : 'Stereo Baseline'})
          </h3>
        </div>
        {missingCondition && onRunCounterpart && (
          <button
            className="btn btn-accent"
            onClick={() => onRunCounterpart(missingCondition)}
            style={{ fontSize: 11, padding: '5px 10px' }}
          >
            <ArrowRightLeft size={13} />
            Run {missingCondition === '3D_HRTF' ? '3D HRTF' : 'Stereo Baseline'} for A/B Comparison
          </button>
        )}
      </div>

      <div className="telemetry-grid">
        <div className="telemetry-item">
          <div className="telemetry-label">Direction Accuracy</div>
          <div className="telemetry-value" style={{ color: 'var(--accent-emerald)' }}>
            {currentSummary ? `${currentSummary.accuracyPercent.toFixed(1)}%` : '--'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
            {currentSummary
              ? `${currentSummary.correctTrials} / ${currentSummary.totalTrials} correct`
              : ''}
          </div>
        </div>

        <div className="telemetry-item">
          <div className="telemetry-label">Mean Reaction Time</div>
          <div className="telemetry-value" style={{ color: 'var(--accent-cyan)' }}>
            {currentSummary ? `${currentSummary.meanReactionTimeMs} ms` : '--'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
            Median: {currentSummary ? `${currentSummary.medianReactionTimeMs} ms` : '--'}
          </div>
        </div>

        <div className="telemetry-item">
          <div className="telemetry-label">Front-Back Reversals</div>
          <div className="telemetry-value" style={{ color: 'var(--accent-amber)' }}>
            {currentSummary ? `${currentSummary.frontBackReversalRatePercent.toFixed(1)}%` : '--'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
            Cone of Confusion error rate
          </div>
        </div>

        <div className="telemetry-item">
          <div className="telemetry-label">SUS & NASA-TLX</div>
          <div
            className="telemetry-value"
            style={{
              fontSize: 13,
              color:
                session.susScore !== undefined || session.overallTlxScore !== undefined
                  ? 'var(--accent-emerald)'
                  : 'var(--text-dim)'
            }}
          >
            SUS: {session.susScore !== undefined ? `${session.susScore}` : '--'} | TLX:{' '}
            {session.overallTlxScore !== undefined ? `${session.overallTlxScore}` : '--'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
            ISO 9241-11 & Workload
          </div>
        </div>
      </div>

      {/* Side-by-Side Empirical A/B Comparison Table when both conditions are completed */}
      {hrtf && stereo && (
        <div
          className="survey-item"
          style={{ borderColor: 'rgba(0, 240, 255, 0.35)', background: 'rgba(0, 240, 255, 0.04)' }}
        >
          <div style={{ fontSize: 12, fontWeight: 700, color: '#00f0ff', marginBottom: 4 }}>
            📊 Empirical A/B Comparison: 3D HRTF vs. Conventional Stereo
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1.3fr 1fr 1fr', gap: 6, fontSize: 11 }}>
            <div style={{ color: 'var(--text-dim)', fontWeight: 700 }}>METRIC</div>
            <div style={{ color: '#10b981', fontWeight: 700 }}>3D HRTF (PROPOSED)</div>
            <div style={{ color: '#f59e0b', fontWeight: 700 }}>STEREO BASELINE</div>

            <div>Localization Accuracy</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
              {hrtf.accuracyPercent.toFixed(1)}%
            </div>
            <div style={{ fontFamily: 'var(--font-mono)' }}>{stereo.accuracyPercent.toFixed(1)}%</div>

            <div>Mean Reaction Time</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
              {hrtf.meanReactionTimeMs} ms
            </div>
            <div style={{ fontFamily: 'var(--font-mono)' }}>{stereo.meanReactionTimeMs} ms</div>

            <div>Front-Back Confusion Rate</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
              {hrtf.frontBackReversalRatePercent.toFixed(1)}%
            </div>
            <div style={{ fontFamily: 'var(--font-mono)' }}>
              {stereo.frontBackReversalRatePercent.toFixed(1)}%
            </div>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 10, marginTop: 4, flexWrap: 'wrap' }}>
        <button className="btn btn-primary" onClick={exportCSV} style={{ flex: 1 }}>
          <Download size={15} />
          Export CSV Dataset ({session.trials.length} Trials)
        </button>

        {session.susScore === undefined && (
          <button className="btn btn-accent" onClick={onOpenSUS} style={{ flex: 1 }}>
            Fill SUS Survey
          </button>
        )}

        {session.overallTlxScore === undefined && (
          <button className="btn btn-accent" onClick={onOpenNASA} style={{ flex: 1 }}>
            Fill NASA-TLX
          </button>
        )}

        <button className="btn" onClick={onResetStudy} style={{ padding: '8px 12px' }}>
          <RotateCcw size={15} />
          Configure / Retest
        </button>
      </div>
    </div>
  );
};
