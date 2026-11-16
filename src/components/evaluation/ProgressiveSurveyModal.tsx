import React, { useState, useEffect, useRef } from 'react';
import {
  BUBBLE_BADGE_STYLES,
  CONDITION_META,
  STUDY_PARAMETERS,
  SURVEY_QUESTIONS,
  StudyConditionType,
  StudyPartNumber
} from '../../config/studyConfig';
import { Sliders, CheckCircle2, Info } from 'lucide-react';

interface ProgressiveSurveyModalProps {
  isOpen: boolean;
  part: StudyPartNumber;
  /** Ordered list of conditions completed so far in this part (length 1, 2, or 3) */
  completedConditions: StudyConditionType[];
  /** Saved initial scores from when each condition was first rated: cond -> questionId -> score */
  initialScoresByCondition: Record<string, Record<string, number>>;
  /** Previously saved adjusted scores: cond -> questionId -> score */
  currentScoresByCondition: Record<string, Record<string, number>>;
  isSubmitting?: boolean;
  onSubmit: (updatedScoresByCondition: Record<string, Record<string, number>>) => void;
}

function clampAndSnap(val: number): number {
  const min = STUDY_PARAMETERS.sliderMin;
  const max = STUDY_PARAMETERS.sliderMax;
  const step = STUDY_PARAMETERS.sliderStep;
  const clamped = Math.max(min, Math.min(max, val));
  return Math.round(clamped / step) * step;
}

/**
 * Computes vertical offsets (px) for bubbles within ±0.4 units on the 0–10 track
 * so overlapping bubbles fan out cleanly and never block one another.
 */
function computeVerticalOffsets(values: number[]): number[] {
  const n = values.length;
  const offsets = new Array<number>(n).fill(0);
  if (n <= 1) return offsets;

  const threshold = STUDY_PARAMETERS.overlapThresholdUnits;
  // Sort indices by value while preserving stable index tie-breaking
  const sorted = values
    .map((v, idx) => ({ v, idx }))
    .sort((a, b) => (Math.abs(a.v - b.v) < 1e-6 ? a.idx - b.idx : a.v - b.v));

  let cluster: number[] = [sorted[0].idx];
  const flushCluster = (items: number[]) => {
    if (items.length === 2) {
      offsets[items[0]] = -8;
      offsets[items[1]] = 8;
    } else if (items.length >= 3) {
      offsets[items[0]] = -10;
      offsets[items[1]] = 0;
      offsets[items[2]] = 10;
    }
  };

  for (let i = 1; i < sorted.length; i++) {
    const prevVal = values[cluster[cluster.length - 1]];
    if (Math.abs(sorted[i].v - prevVal) <= threshold) {
      cluster.push(sorted[i].idx);
    } else {
      flushCluster(cluster);
      cluster = [sorted[i].idx];
    }
  }
  flushCluster(cluster);
  return offsets;
}

export const ProgressiveSurveyModal: React.FC<ProgressiveSurveyModalProps> = ({
  isOpen,
  part,
  completedConditions,
  initialScoresByCondition,
  currentScoresByCondition,
  isSubmitting = false,
  onSubmit
}) => {
  const applicableQuestions = SURVEY_QUESTIONS.filter((q) => q.applicableParts.includes(part));
  const latestCond = completedConditions[completedConditions.length - 1];

  const [scores, setScores] = useState<Record<string, Record<string, number>>>({});
  const [touchedCurrentMap, setTouchedCurrentMap] = useState<Record<string, boolean>>({});
  const [activeDrag, setActiveDrag] = useState<{ questionId: string; cond: StudyConditionType } | null>(
    null
  );
  const [hoveredThumb, setHoveredThumb] = useState<{ questionId: string; cond: StudyConditionType } | null>(
    null
  );

  const trackRefs = useRef<Record<string, HTMLDivElement | null>>({});

  // Initialize local draft whenever the modal opens for a newly finished block
  useEffect(() => {
    if (!isOpen) return;
    const draft: Record<string, Record<string, number>> = {};
    completedConditions.forEach((cond) => {
      draft[cond] = {};
      applicableQuestions.forEach((q) => {
        const existing = currentScoresByCondition[cond]?.[q.id];
        draft[cond][q.id] = typeof existing === 'number' ? existing : 5.0;
      });
    });
    setScores(draft);
    setTouchedCurrentMap({});
  }, [isOpen, part, completedConditions.join('|')]);

  if (!isOpen) return null;

  const updateScore = (questionId: string, cond: StudyConditionType, nextVal: number) => {
    const snapped = clampAndSnap(nextVal);
    setScores((prev) => ({
      ...prev,
      [cond]: {
        ...(prev[cond] || {}),
        [questionId]: snapped
      }
    }));
    if (cond === latestCond) {
      setTouchedCurrentMap((prev) => ({ ...prev, [questionId]: true }));
    }
  };

  const clientXToValue = (questionId: string, clientX: number): number => {
    const trackEl = trackRefs.current[questionId];
    if (!trackEl) return 5.0;
    const rect = trackEl.getBoundingClientRect();
    if (rect.width <= 0) return 5.0;
    const ratio = (clientX - rect.left) / rect.width;
    return clampAndSnap(
      STUDY_PARAMETERS.sliderMin + ratio * (STUDY_PARAMETERS.sliderMax - STUDY_PARAMETERS.sliderMin)
    );
  };

  const handleThumbPointerDown = (
    e: React.PointerEvent<HTMLDivElement>,
    questionId: string,
    cond: StudyConditionType
  ) => {
    e.stopPropagation();
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    setActiveDrag({ questionId, cond });
    updateScore(questionId, cond, clientXToValue(questionId, e.clientX));
  };

  const handleThumbPointerMove = (
    e: React.PointerEvent<HTMLDivElement>,
    questionId: string,
    cond: StudyConditionType
  ) => {
    if (!activeDrag || activeDrag.questionId !== questionId || activeDrag.cond !== cond) return;
    updateScore(questionId, cond, clientXToValue(questionId, e.clientX));
  };

  const handleThumbPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    setActiveDrag(null);
  };

  const handleThumbKeyDown = (
    e: React.KeyboardEvent<HTMLDivElement>,
    questionId: string,
    cond: StudyConditionType,
    curVal: number
  ) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      updateScore(questionId, cond, curVal - STUDY_PARAMETERS.sliderStep);
    } else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      updateScore(questionId, cond, curVal + STUDY_PARAMETERS.sliderStep);
    }
  };

  const latestMeta = latestCond ? CONDITION_META[latestCond] : null;
  const blockIndex = completedConditions.length;

  return (
    <div
      className="modal-overlay"
      style={{ zIndex: 10500, background: 'rgba(3, 6, 13, 0.88)', backdropFilter: 'blur(14px)' }}
    >
      <div
        className="modal-content"
        style={{
          maxWidth: '820px',
          width: '96%',
          border: '1px solid rgba(0, 240, 255, 0.45)',
          background: 'linear-gradient(180deg, #0b1120 0%, #070b15 100%)'
        }}
      >
        {/* Header */}
        <div
          className="modal-header"
          style={{
            background: 'rgba(15, 23, 42, 0.72)',
            borderBottom: '1px solid rgba(255, 255, 255, 0.08)'
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div
              style={{
                width: 36,
                height: 36,
                borderRadius: 10,
                background: 'rgba(0, 240, 255, 0.14)',
                border: '1px solid rgba(0, 240, 255, 0.35)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Sliders size={18} color="#00f0ff" />
            </div>
            <div>
              <div style={{ fontSize: 11, fontWeight: 700, color: '#00f0ff', letterSpacing: '0.08em' }}>
                PART {part} • POST-BLOCK COMPARATIVE EVALUATION (TEST #{blockIndex})
              </div>
              <h2 style={{ fontSize: 16, fontWeight: 800, color: '#fff', marginTop: 2 }}>
                Rate {latestMeta?.label || latestCond}
                {blockIndex > 1 ? ' & Recalibrate Previous Ratings' : ''}
              </h2>
            </div>
          </div>

          {/* Condition Bubbles Key */}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            {completedConditions.map((cond, idx) => {
              const badge = BUBBLE_BADGE_STYLES[idx] || BUBBLE_BADGE_STYLES[0];
              const isCurrent = idx === completedConditions.length - 1;
              return (
                <div
                  key={cond}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '4px 10px',
                    borderRadius: 20,
                    background: isCurrent ? badge.tint : 'rgba(255,255,255,0.04)',
                    border: `1px ${isCurrent ? 'solid' : 'dashed'} ${badge.border}`,
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#f8fafc'
                  }}
                >
                  <span
                    style={{
                      width: 18,
                      height: 18,
                      borderRadius: '50%',
                      background: isCurrent ? badge.solid : 'transparent',
                      border: `2px solid ${badge.solid}`,
                      color: isCurrent ? '#040711' : badge.solid,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontSize: 10,
                      fontWeight: 800
                    }}
                  >
                    #{idx + 1}
                  </span>
                  <span>{CONDITION_META[cond].shortLabel}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="modal-body" style={{ gap: 18, padding: '18px 22px' }}>
          {blockIndex > 1 && (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                background: 'rgba(168, 85, 247, 0.12)',
                border: '1px solid rgba(168, 85, 247, 0.32)',
                borderRadius: 10,
                padding: '9px 14px',
                fontSize: 12,
                color: '#e9d5ff'
              }}
            >
              <Info size={16} color="#c084fc" style={{ flexShrink: 0 }} />
              <span>
                Your previous rating{blockIndex > 2 ? 's' : ''} ({completedConditions.slice(0, -1).map((_, i) => `#${i + 1}`).join(', ')}) appear on each scale for direct comparison. Drag <strong>any bubble</strong> to fine-tune relative differences after experiencing Test #{blockIndex}.
              </span>
            </div>
          )}

          {applicableQuestions.map((q) => {
            const values = completedConditions.map((c) => scores[c]?.[q.id] ?? 5.0);
            const yOffsets = computeVerticalOffsets(values);
            const currentIsTouched = touchedCurrentMap[q.id];

            return (
              <div
                key={q.id}
                style={{
                  background: 'rgba(15, 23, 42, 0.72)',
                  border: '1px solid rgba(255, 255, 255, 0.08)',
                  borderRadius: 12,
                  padding: '14px 18px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 10
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 12 }}>
                  <div>
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 800,
                        letterSpacing: '0.09em',
                        color: '#38bdf8',
                        display: 'block',
                        marginBottom: 3
                      }}
                    >
                      {q.category}
                    </span>
                    <div style={{ fontSize: 13.5, fontWeight: 600, color: '#f8fafc', lineHeight: 1.4 }}>
                      {q.prompt}
                    </div>
                  </div>
                </div>

                {/* Horizontal 0–10 Multi-Bubble Track */}
                <div style={{ padding: '18px 12px 10px 12px' }}>
                  <div
                    ref={(el) => {
                      trackRefs.current[q.id] = el;
                    }}
                    onClick={(e) => {
                      if (!latestCond) return;
                      updateScore(q.id, latestCond, clientXToValue(q.id, e.clientX));
                    }}
                    style={{
                      position: 'relative',
                      height: 10,
                      borderRadius: 999,
                      background: 'linear-gradient(90deg, rgba(148,163,184,0.22) 0%, rgba(0,240,255,0.28) 100%)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      cursor: 'pointer',
                      touchAction: 'none'
                    }}
                  >
                    {/* Tick Marks 0..10 */}
                    {Array.from({ length: 11 }, (_, tick) => (
                      <div
                        key={tick}
                        style={{
                          position: 'absolute',
                          left: `${tick * 10}%`,
                          top: tick % 5 === 0 ? -4 : 0,
                          width: 1,
                          height: tick % 5 === 0 ? 18 : 10,
                          background: tick % 5 === 0 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)',
                          transform: 'translateX(-50%)',
                          pointerEvents: 'none'
                        }}
                      >
                        <span
                          style={{
                            position: 'absolute',
                            top: 20,
                            left: '50%',
                            transform: 'translateX(-50%)',
                            fontSize: 9,
                            fontFamily: 'var(--font-mono)',
                            color: 'rgba(148, 163, 184, 0.7)'
                          }}
                        >
                          {tick}
                        </span>
                      </div>
                    ))}

                    {/* Independent Draggable Bubble Thumbs (#1, #2, #3) */}
                    {completedConditions.map((cond, idx) => {
                      const val = values[idx];
                      const pct =
                        ((val - STUDY_PARAMETERS.sliderMin) /
                          (STUDY_PARAMETERS.sliderMax - STUDY_PARAMETERS.sliderMin)) *
                        100;
                      const badge = BUBBLE_BADGE_STYLES[idx] || BUBBLE_BADGE_STYLES[0];
                      const isCurrent = idx === completedConditions.length - 1;
                      const isDragging =
                        activeDrag?.questionId === q.id && activeDrag?.cond === cond;
                      const isHovered =
                        hoveredThumb?.questionId === q.id && hoveredThumb?.cond === cond;
                      const zIndex = isDragging ? 35 : isHovered ? 30 : isCurrent ? 20 : 10 + idx;
                      const yOffset = yOffsets[idx] || 0;

                      return (
                        <div
                          key={cond}
                          role="slider"
                          tabIndex={0}
                          aria-label={`${q.category} rating for ${CONDITION_META[cond].label}`}
                          aria-valuemin={STUDY_PARAMETERS.sliderMin}
                          aria-valuemax={STUDY_PARAMETERS.sliderMax}
                          aria-valuenow={val}
                          onPointerDown={(e) => handleThumbPointerDown(e, q.id, cond)}
                          onPointerMove={(e) => handleThumbPointerMove(e, q.id, cond)}
                          onPointerUp={handleThumbPointerUp}
                          onPointerCancel={handleThumbPointerUp}
                          onMouseEnter={() => setHoveredThumb({ questionId: q.id, cond })}
                          onMouseLeave={() => setHoveredThumb(null)}
                          onKeyDown={(e) => handleThumbKeyDown(e, q.id, cond, val)}
                          onClick={(e) => e.stopPropagation()}
                          title={`#${idx + 1} ${CONDITION_META[cond].label}: ${val.toFixed(1)} / 10`}
                          style={{
                            position: 'absolute',
                            left: `${pct}%`,
                            top: '50%',
                            transform: `translate(-50%, calc(-50% + ${yOffset}px)) scale(${
                              isDragging ? 1.18 : isHovered ? 1.1 : 1
                            })`,
                            width: 28,
                            height: 28,
                            borderRadius: '50%',
                            background:
                              isCurrent || isDragging || isHovered
                                ? badge.solid
                                : 'rgba(11, 17, 32, 0.85)',
                            border: `2.5px solid ${badge.border}`,
                            opacity: isCurrent || isDragging || isHovered ? 1 : 0.78,
                            boxShadow:
                              isCurrent && !currentIsTouched
                                ? `0 0 0 4px ${badge.tint}, 0 0 18px ${badge.glow}`
                                : `0 4px 14px ${badge.glow}`,
                            color:
                              isCurrent || isDragging || isHovered ? '#030712' : badge.border,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: 10.5,
                            fontWeight: 900,
                            fontFamily: 'var(--font-mono)',
                            cursor: isDragging ? 'grabbing' : 'grab',
                            zIndex,
                            transition: isDragging
                              ? 'none'
                              : 'transform 0.14s ease, opacity 0.14s ease, background 0.14s ease',
                            userSelect: 'none',
                            touchAction: 'none'
                          }}
                        >
                          #{idx + 1}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Endpoint Labels */}
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    fontSize: 10.5,
                    color: 'var(--text-muted)',
                    marginTop: 6
                  }}
                >
                  <span>{q.lowLabel}</span>
                  <span>{q.highLabel}</span>
                </div>

                {/* Live Score & Comparative Delta Chips */}
                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 2 }}>
                  {completedConditions.map((cond, idx) => {
                    const badge = BUBBLE_BADGE_STYLES[idx] || BUBBLE_BADGE_STYLES[0];
                    const curVal = values[idx];
                    const initVal = initialScoresByCondition[cond]?.[q.id];
                    const hasPrior = typeof initVal === 'number';
                    const delta = hasPrior ? Math.round((curVal - initVal) * 10) / 10 : 0;

                    return (
                      <div
                        key={cond}
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          gap: 6,
                          padding: '3px 9px',
                          borderRadius: 6,
                          background: 'rgba(255, 255, 255, 0.04)',
                          border: `1px solid ${badge.tint}`,
                          fontSize: 11,
                          fontFamily: 'var(--font-mono)'
                        }}
                      >
                        <span style={{ color: badge.border, fontWeight: 800 }}>
                          #{idx + 1} {CONDITION_META[cond].shortLabel}:
                        </span>
                        <span style={{ color: '#fff', fontWeight: 800 }}>{curVal.toFixed(1)}</span>
                        {hasPrior && Math.abs(delta) >= 0.1 && (
                          <span
                            style={{
                              fontSize: 10,
                              color: delta > 0 ? '#34d399' : '#fbbf24'
                            }}
                          >
                            (Δ {delta > 0 ? `+${delta.toFixed(1)}` : delta.toFixed(1)})
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          className="modal-footer"
          style={{
            background: 'rgba(15, 23, 42, 0.72)',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}
        >
          <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Tip: You can click anywhere along a scale or use Left/Right Arrow keys when a bubble is focused.
          </span>
          <button
            className="btn btn-primary"
            disabled={isSubmitting}
            onClick={() => onSubmit(scores)}
            style={{ padding: '10px 20px', fontSize: 13 }}
          >
            <CheckCircle2 size={16} />
            {isSubmitting ? 'Saving & Syncing...' : 'Save Ratings & Continue'}
          </button>
        </div>
      </div>
    </div>
  );
};
