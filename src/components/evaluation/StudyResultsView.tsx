import React from 'react';
import { ParticipantSession } from '../../types/evaluation';
import { Download, CheckCircle, RotateCcw } from 'lucide-react';

interface StudyResultsViewProps {
  session: ParticipantSession;
  onResetStudy: () => void;
  onOpenSUS: () => void;
  onOpenNASA: () => void;
}

export const StudyResultsView: React.FC<StudyResultsViewProps> = ({
  session,
  onResetStudy,
  onOpenSUS,
  onOpenNASA
}) => {
  const hrtf = session.hrtfSummary;

  const exportCSV = () => {
    if (!session.trials.length) return;

    let csv = "Participant_ID,Trial_Number,Condition,Target_Proxy,Response_Proxy,Is_Correct,Is_Front_Back_Reversal,Reaction_Time_MS,Sound_Azimuth_Deg,Timestamp\n";
    session.trials.forEach((t) => {
      csv += `${session.participantId},${t.trialNumber},${t.condition},${t.targetProxy},${t.responseProxy},${t.isCorrect ? 1 : 0},${t.isFrontBackReversal ? 1 : 0},${t.reactionTimeMs},${t.soundAzimuthDeg},"${t.timestamp}"\n`;
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

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <CheckCircle size={22} color="var(--accent-emerald)" />
        <h3 style={{ fontSize: 16, color: '#fff' }}>HCI Reaction Study Completed!</h3>
      </div>

      <div className="telemetry-grid">
        <div className="telemetry-item">
          <div className="telemetry-label">Direction Accuracy</div>
          <div className="telemetry-value" style={{ color: 'var(--accent-emerald)' }}>
            {hrtf ? `${hrtf.accuracyPercent.toFixed(1)}%` : '--'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
            {hrtf ? `${hrtf.correctTrials} / ${hrtf.totalTrials} correct` : ''}
          </div>
        </div>

        <div className="telemetry-item">
          <div className="telemetry-label">Mean Reaction Time</div>
          <div className="telemetry-value" style={{ color: 'var(--accent-cyan)' }}>
            {hrtf ? `${hrtf.meanReactionTimeMs} ms` : '--'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
            Auditory onset to gaze focus
          </div>
        </div>

        <div className="telemetry-item">
          <div className="telemetry-label">Front-Back Reversals</div>
          <div className="telemetry-value" style={{ color: 'var(--accent-amber)' }}>
            {hrtf ? `${hrtf.frontBackReversalRatePercent.toFixed(1)}%` : '--'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
            Cone of Confusion rate
          </div>
        </div>

        <div className="telemetry-item">
          <div className="telemetry-label">Subjective SUS Score</div>
          <div className="telemetry-value" style={{ color: session.susScore ? 'var(--accent-emerald)' : 'var(--text-dim)' }}>
            {session.susScore !== undefined ? `${session.susScore} / 100` : 'Pending'}
          </div>
          <div style={{ fontSize: 10, color: 'var(--text-dim)', marginTop: 2 }}>
            ISO 9241-11 Usability
          </div>
        </div>
      </div>

      {/* Action Buttons */}
      <div style={{ display: 'flex', gap: 10, marginTop: 8 }}>
        <button className="btn btn-primary" onClick={exportCSV} style={{ flex: 1 }}>
          <Download size={15} />
          Export Dataset to CSV (SPSS/R)
        </button>

        {!session.susScore && (
          <button className="btn btn-accent" onClick={onOpenSUS} style={{ flex: 1 }}>
            Fill SUS Survey
          </button>
        )}

        {!session.overallTlxScore && (
          <button className="btn btn-accent" onClick={onOpenNASA} style={{ flex: 1 }}>
            Fill NASA-TLX
          </button>
        )}

        <button className="btn" onClick={onResetStudy} style={{ padding: '8px 12px' }}>
          <RotateCcw size={15} />
          Retest
        </button>
      </div>
    </div>
  );
};
