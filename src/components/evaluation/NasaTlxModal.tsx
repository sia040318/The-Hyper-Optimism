import React, { useState } from 'react';
import { NasaTlxResponses } from '../../types/evaluation';
import { Brain, Check } from 'lucide-react';

interface NasaTlxModalProps {
  onSubmit: (responses: NasaTlxResponses, overallScore: number) => void;
  onCancel: () => void;
}

export const NasaTlxModal: React.FC<NasaTlxModalProps> = ({ onSubmit, onCancel }) => {
  const [mental, setMental] = useState(25);
  const [physical, setPhysical] = useState(15);
  const [temporal, setTemporal] = useState(30);
  const [performance, setPerformance] = useState(15);
  const [effort, setEffort] = useState(20);
  const [frustration, setFrustration] = useState(10);

  const calculateOverall = (): number => {
    return Math.round((mental + physical + temporal + performance + effort + frustration) / 6);
  };

  const handleSubmit = () => {
    const responses: NasaTlxResponses = {
      mentalDemand: mental,
      physicalDemand: physical,
      temporalDemand: temporal,
      performance: performance,
      effort: effort,
      frustration: frustration
    };
    onSubmit(responses, calculateOverall());
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Brain color="var(--accent-violet)" size={20} />
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>
              NASA-TLX (Task Load Index) Cognitive Workload Assessment
            </h2>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Hart & Staveland Cognitive Workload Standard
          </span>
        </div>

        <div className="modal-body">
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Evaluate the subjective workload experienced during the spatial audio hazard orienting tasks (0 = Very Low, 100 = Very High).
          </p>

          {/* Mental Demand */}
          <div className="survey-item">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="survey-question">Mental Demand</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>{mental} / 100</span>
            </div>
            <p style={{ fontSize: 10, color: 'var(--text-dim)' }}>How much mental and perceptual activity was required (thinking, deciding, remembering)?</p>
            <input type="range" className="slider" min="0" max="100" value={mental} onChange={(e) => setMental(parseInt(e.target.value))} />
          </div>

          {/* Physical Demand */}
          <div className="survey-item">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="survey-question">Physical Demand</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>{physical} / 100</span>
            </div>
            <p style={{ fontSize: 10, color: 'var(--text-dim)' }}>How much physical activity was required (head turning, eye orienting)?</p>
            <input type="range" className="slider" min="0" max="100" value={physical} onChange={(e) => setPhysical(parseInt(e.target.value))} />
          </div>

          {/* Temporal Demand */}
          <div className="survey-item">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="survey-question">Temporal Demand (Time Pressure)</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>{temporal} / 100</span>
            </div>
            <p style={{ fontSize: 10, color: 'var(--text-dim)' }}>How much time pressure did you feel due to the rate of the auditory warnings?</p>
            <input type="range" className="slider" min="0" max="100" value={temporal} onChange={(e) => setTemporal(parseInt(e.target.value))} />
          </div>

          {/* Performance */}
          <div className="survey-item">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="survey-question">Performance (Self-Perceived Error)</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>{performance} / 100</span>
            </div>
            <p style={{ fontSize: 10, color: 'var(--text-dim)' }}>How successful were you in finding the danger direction (0 = Perfect, 100 = Complete Failure)?</p>
            <input type="range" className="slider" min="0" max="100" value={performance} onChange={(e) => setPerformance(parseInt(e.target.value))} />
          </div>

          {/* Effort */}
          <div className="survey-item">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="survey-question">Effort</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>{effort} / 100</span>
            </div>
            <p style={{ fontSize: 10, color: 'var(--text-dim)' }}>How hard did you have to work mentally and physically to achieve your level of performance?</p>
            <input type="range" className="slider" min="0" max="100" value={effort} onChange={(e) => setEffort(parseInt(e.target.value))} />
          </div>

          {/* Frustration */}
          <div className="survey-item">
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span className="survey-question">Frustration Level (Alarm Annoyance)</span>
              <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--accent-cyan)' }}>{frustration} / 100</span>
            </div>
            <p style={{ fontSize: 10, color: 'var(--text-dim)' }}>How irritated, stressed, or annoyed did you feel by the acoustic alerts?</p>
            <input type="range" className="slider" min="0" max="100" value={frustration} onChange={(e) => setFrustration(parseInt(e.target.value))} />
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>
            Skip / Close
          </button>
          <button className="btn btn-primary" onClick={handleSubmit}>
            <Check size={14} />
            Submit NASA-TLX (Cognitive Workload: {calculateOverall()}/100)
          </button>
        </div>
      </div>
    </div>
  );
};
