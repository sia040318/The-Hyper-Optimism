import React, { useState } from 'react';
import { SUSResponses } from '../../types/evaluation';
import { Award, Check } from 'lucide-react';

interface SUSModalProps {
  onSubmit: (responses: SUSResponses, finalScore: number) => void;
  onCancel: () => void;
}

const SUS_QUESTIONS = [
  "1. I think that I would like to use this 3D audio ADAS system frequently while driving.",
  "2. I found the warning system unnecessarily complex.",
  "3. I thought the spatial audio system was easy to use and intuitive.",
  "4. I think that I would need the support of a technical person to be able to use this system.",
  "5. I found the various functions (gaze-cancellation, mirror proxy mapping) were well integrated.",
  "6. I thought there was too much inconsistency in this system.",
  "7. I would imagine that most drivers would learn to use this system very quickly.",
  "8. I found the system very cumbersome/annoying to use.",
  "9. I felt very confident using the spatial audio cues to direct my gaze to hazards.",
  "10. I needed to learn a lot of things before I could get going with this system."
];

export const SUSModal: React.FC<SUSModalProps> = ({ onSubmit, onCancel }) => {
  const [answers, setAnswers] = useState<number[]>([4, 1, 5, 1, 5, 1, 5, 1, 5, 1]);

  const handleSelect = (qIdx: number, val: number) => {
    const updated = [...answers];
    updated[qIdx] = val;
    setAnswers(updated);
  };

  const calculateScore = (): number => {
    // Official SUS formula:
    // Odd items: score - 1
    // Even items: 5 - score
    // Sum * 2.5
    let sum = 0;
    answers.forEach((val, idx) => {
      if ((idx + 1) % 2 !== 0) {
        sum += (val - 1);
      } else {
        sum += (5 - val);
      }
    });
    return Math.round(sum * 2.5);
  };

  const handleSubmit = () => {
    const susResp: SUSResponses = {
      q1_frequentUse: answers[0],
      q2_complexity: answers[1],
      q3_easeOfUse: answers[2],
      q4_needTechSupport: answers[3],
      q5_wellIntegrated: answers[4],
      q6_inconsistency: answers[5],
      q7_quickLearn: answers[6],
      q8_cumbersome: answers[7],
      q9_confidence: answers[8],
      q10_learningEffort: answers[9]
    };
    onSubmit(susResp, calculateScore());
  };

  return (
    <div className="modal-overlay">
      <div className="modal-content">
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Award color="var(--accent-cyan)" size={20} />
            <h2 style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>
              System Usability Scale (SUS) Questionnaire
            </h2>
          </div>
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            HCI ISO 9241-11 Benchmark (15–30 Participants)
          </span>
        </div>

        <div className="modal-body">
          <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Please rate your level of agreement with each statement regarding the 3D HRTF Gaze-Contingent Audio ADAS system (1 = Strongly Disagree, 5 = Strongly Agree).
          </p>

          {SUS_QUESTIONS.map((q, idx) => (
            <div key={idx} className="survey-item">
              <div className="survey-question">{q}</div>
              <div className="likert-scale">
                {[1, 2, 3, 4, 5].map((val) => (
                  <label key={val} className="likert-option">
                    <input
                      type="radio"
                      name={`sus_q_${idx}`}
                      checked={answers[idx] === val}
                      onChange={() => handleSelect(idx, val)}
                    />
                    <span>{val === 1 ? '1 (Disagree)' : val === 5 ? '5 (Agree)' : val}</span>
                  </label>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="modal-footer">
          <button className="btn" onClick={onCancel}>
            Skip / Close
          </button>
          <button className="btn btn-primary" onClick={handleSubmit}>
            <Check size={14} />
            Submit SUS Survey (Score: {calculateScore()}/100)
          </button>
        </div>
      </div>
    </div>
  );
};
