import React, { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  BUBBLE_BADGE_STYLES,
  CONDITION_META,
  STUDY_PARAMETERS,
  SURVEY_QUESTIONS,
  StudyConditionType,
  StudyPartNumber
} from '../../config/studyConfig';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { SlidersHorizontal, CheckCircle2, Info, AlertCircle } from 'lucide-react';

interface ProgressiveSurveyModalProps {
  isOpen: boolean;
  part: StudyPartNumber;
  /** Ordered list of conditions completed so far in this part (length 1, 2, or 3) */
  completedConditions: StudyConditionType[];
  /** Saved initial scores from when each condition was first rated: cond -> questionId -> score */
  initialScoresByCondition: Record<string, Record<string, number>>;
  /** Previously saved adjusted scores: cond -> questionId -> score */
  currentScoresByCondition: Record<string, Record<string, number>>;
  /** Optional blinded participant-facing labels keyed by StudyConditionType */
  blindedLabels?: Record<string, string>;
  stepContextLabel?: string;
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
  blindedLabels,
  stepContextLabel,
  isSubmitting = false,
  onSubmit
}) => {
  const applicableQuestions = SURVEY_QUESTIONS.filter((q) => q.applicableParts.includes(part));
  const latestCond = completedConditions[completedConditions.length - 1];

  const [scores, setScores] = useState<Record<string, Record<string, number>>>({});
  const [touchedCurrentMap, setTouchedCurrentMap] = useState<Record<string, boolean>>({});
  const [showUnratedWarning, setShowUnratedWarning] = useState(false);
  const [confirmDefaultsArmed, setConfirmDefaultsArmed] = useState(false);
  const [activeDrag, setActiveDrag] = useState<{ questionId: string; cond: StudyConditionType } | null>(
    null
  );
  const [hoveredThumb, setHoveredThumb] = useState<{ questionId: string; cond: StudyConditionType } | null>(
    null
  );

  const trackRefs = useRef<Record<string, HTMLDivElement | null>>({});

  useEffect(() => {
    if (!isOpen) return;
    const draft: Record<string, Record<string, number>> = {};
    const initialTouched: Record<string, boolean> = {};
    completedConditions.forEach((cond) => {
      draft[cond] = {};
      applicableQuestions.forEach((q) => {
        const existing = currentScoresByCondition[cond]?.[q.id];
        draft[cond][q.id] = typeof existing === 'number' ? existing : 5.0;
        if (cond === latestCond && typeof existing === 'number') {
          initialTouched[q.id] = true;
        }
      });
    });
    setScores(draft);
    setTouchedCurrentMap(initialTouched);
    setShowUnratedWarning(false);
    setConfirmDefaultsArmed(false);
  }, [isOpen, part, completedConditions.join('|')]);

  if (!isOpen) return null;

  const getDisplayLabel = (cond: StudyConditionType) =>
    blindedLabels?.[cond] || CONDITION_META[cond].shortLabel;

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
      setConfirmDefaultsArmed(false);
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

  const ratedCount = applicableQuestions.filter((q) => touchedCurrentMap[q.id]).length;
  const allRated = ratedCount === applicableQuestions.length;
  const blockIndex = completedConditions.length;
  const latestDisplayLabel = latestCond ? getDisplayLabel(latestCond) : '';

  const handleSubmitClick = () => {
    if (!allRated && !confirmDefaultsArmed) {
      setShowUnratedWarning(true);
      setConfirmDefaultsArmed(true);
      return;
    }
    onSubmit(scores);
  };

  return (
    <div className="fixed inset-0 z-[10500] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm sm:p-6">
      <motion.div
        initial={{ opacity: 0, y: 8, scale: 0.99 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ type: 'spring', stiffness: 420, damping: 36, mass: 0.8 }}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[14px] border border-border bg-card"
      >
        {/* Header */}
        <div className="flex flex-col justify-between gap-4 border-b border-border bg-popover/60 px-6 py-5 sm:flex-row sm:items-center">
          <div className="flex items-start gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-secondary">
              <SlidersHorizontal size={16} strokeWidth={1.75} className="text-[#38bdf8]" />
            </div>
            <div>
              <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#38bdf8]">
                {stepContextLabel || `Part ${part} • Evaluation #${blockIndex}`}
              </div>
              <h2 className="mt-1 font-heading text-lg font-semibold tracking-[-0.02em] text-foreground">
                Rate {latestDisplayLabel}
                {blockIndex > 1 ? ' & Calibrate Prior Ratings' : ''}
              </h2>
            </div>
          </div>

          {/* Blinded Condition Marker Pills */}
          <div className="flex flex-wrap items-center gap-2 sm:justify-end">
            {completedConditions.map((cond, idx) => {
              const badge = BUBBLE_BADGE_STYLES[idx] || BUBBLE_BADGE_STYLES[0];
              const isCurrent = idx === completedConditions.length - 1;
              return (
                <div
                  key={cond}
                  className="inline-flex items-center gap-2 rounded-full border px-2.5 py-1 font-mono text-[11px]"
                  style={{
                    borderColor: isCurrent ? badge.border : 'rgba(255,255,255,0.10)',
                    backgroundColor: isCurrent ? badge.tint : 'rgba(24,24,27,0.7)',
                    color: isCurrent ? '#fafafa' : '#a1a1aa'
                  }}
                >
                  <span
                    className="inline-flex size-4 items-center justify-center rounded-full text-[10px] font-semibold"
                    style={{
                      backgroundColor: isCurrent ? badge.solid : 'transparent',
                      border: `1.5px solid ${badge.solid}`,
                      color: isCurrent ? '#09090b' : badge.solid
                    }}
                  >
                    #{idx + 1}
                  </span>
                  <span>{getDisplayLabel(cond)}</span>
                </div>
              );
            })}
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 space-y-4 overflow-y-auto px-6 py-5">
          {blockIndex > 1 && (
            <div className="flex items-start gap-2.5 rounded-[10px] border border-border bg-popover px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
              <Info size={15} strokeWidth={1.75} className="mt-0.5 shrink-0 text-[#38bdf8]" />
              <span>
                Your ratings from previous blocks (
                {completedConditions
                  .slice(0, -1)
                  .map((_, i) => `#${i + 1}`)
                  .join(', ')}
                ) appear on each scale for side-by-side comparison. Drag any marker to adjust relative differences.
              </span>
            </div>
          )}

          {applicableQuestions.map((q) => {
            const values = completedConditions.map((c) => scores[c]?.[q.id] ?? 5.0);
            const yOffsets = computeVerticalOffsets(values);
            const currentIsTouched = Boolean(touchedCurrentMap[q.id]);

            return (
              <div
                key={q.id}
                className={`space-y-3 rounded-[10px] border bg-[#09090b]/70 p-4 transition-colors sm:p-5 ${
                  showUnratedWarning && !currentIsTouched
                    ? 'border-[#fbbf24]/50'
                    : 'border-border'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <span className="block font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
                      {q.category}
                    </span>
                    <div className="mt-1 text-sm font-medium leading-snug text-foreground">
                      {q.prompt}
                    </div>
                  </div>
                  <Badge
                    variant="outline"
                    className={`shrink-0 font-mono text-[10px] ${
                      currentIsTouched
                        ? 'border-[#34d399]/30 bg-[#34d399]/10 text-[#34d399]'
                        : showUnratedWarning
                          ? 'border-[#fbbf24]/40 bg-[#fbbf24]/10 text-[#fbbf24]'
                          : 'border-border text-muted-foreground'
                    }`}
                  >
                    {currentIsTouched ? 'Rated' : 'Default 5.0'}
                  </Badge>
                </div>

                {/* Horizontal 0–10 Multi-Marker Track */}
                <div className="px-3 pt-4 pb-3">
                  <div
                    ref={(el) => {
                      trackRefs.current[q.id] = el;
                    }}
                    onClick={(e) => {
                      if (!latestCond) return;
                      updateScore(q.id, latestCond, clientXToValue(q.id, e.clientX));
                    }}
                    className="relative h-2 cursor-pointer touch-none rounded-full border border-white/[0.10] bg-white/[0.06]"
                  >
                    {Array.from({ length: 11 }, (_, tick) => (
                      <div
                        key={tick}
                        className="pointer-events-none absolute -translate-x-1/2"
                        style={{
                          left: `${tick * 10}%`,
                          top: tick % 5 === 0 ? -3 : 0,
                          width: 1,
                          height: tick % 5 === 0 ? 14 : 8,
                          backgroundColor:
                            tick % 5 === 0 ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.10)'
                        }}
                      >
                        <span className="absolute top-4 left-1/2 -translate-x-1/2 font-mono text-[10px] tabular-nums text-[#71717a]">
                          {tick}
                        </span>
                      </div>
                    ))}

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
                          aria-label={`${q.category} rating for ${getDisplayLabel(cond)}`}
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
                          title={`#${idx + 1} ${getDisplayLabel(cond)}: ${val.toFixed(1)} / 10`}
                          className="absolute top-1/2 flex size-7 -translate-x-1/2 items-center justify-center rounded-full font-mono text-[11px] font-semibold tabular-nums select-none touch-none"
                          style={{
                            left: `${pct}%`,
                            transform: `translate(-50%, calc(-50% + ${yOffset}px)) scale(${
                              isDragging ? 1.12 : isHovered ? 1.06 : 1
                            })`,
                            backgroundColor:
                              isCurrent || isDragging || isHovered ? badge.solid : '#18181b',
                            border: `2px solid ${badge.border}`,
                            color:
                              isCurrent || isDragging || isHovered ? '#09090b' : badge.border,
                            cursor: isDragging ? 'grabbing' : 'grab',
                            zIndex,
                            transition: isDragging
                              ? 'none'
                              : 'transform 0.14s ease, background-color 0.14s ease'
                          }}
                        >
                          #{idx + 1}
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Endpoint Labels */}
                <div className="flex justify-between pt-1 text-xs text-muted-foreground">
                  <span>{q.lowLabel}</span>
                  <span>{q.highLabel}</span>
                </div>

                {/* Live Score & Comparative Delta Chips */}
                <div className="flex flex-wrap gap-2 pt-0.5">
                  {completedConditions.map((cond, idx) => {
                    const badge = BUBBLE_BADGE_STYLES[idx] || BUBBLE_BADGE_STYLES[0];
                    const curVal = values[idx];
                    const initVal = initialScoresByCondition[cond]?.[q.id];
                    const hasPrior = typeof initVal === 'number';
                    const delta = hasPrior ? Math.round((curVal - initVal) * 10) / 10 : 0;

                    return (
                      <div
                        key={cond}
                        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-popover px-2.5 py-1 font-mono text-[11px] tabular-nums"
                      >
                        <span className="font-semibold" style={{ color: badge.border }}>
                          #{idx + 1} {getDisplayLabel(cond)}:
                        </span>
                        <span className="font-semibold text-foreground">{curVal.toFixed(1)}</span>
                        {hasPrior && Math.abs(delta) >= 0.1 && (
                          <span
                            className="text-[10px]"
                            style={{ color: delta > 0 ? '#34d399' : '#fbbf24' }}
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

        <Separator />

        {/* Footer */}
        <div className="flex flex-col justify-between gap-3 bg-popover/60 px-6 py-4 sm:flex-row sm:items-center">
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            {showUnratedWarning && !allRated ? (
              <>
                <AlertCircle size={14} className="shrink-0 text-[#fbbf24]" />
                <span className="text-[#fbbf24]">
                  {applicableQuestions.length - ratedCount} question(s) still at default 5.0 — drag sliders or click again to confirm defaults.
                </span>
              </>
            ) : (
              <span className="font-mono tabular-nums">
                {ratedCount}/{applicableQuestions.length} rated • Click track or drag markers
              </span>
            )}
          </div>

          <Button
            type="button"
            variant="default"
            disabled={isSubmitting}
            onClick={handleSubmitClick}
            className="h-9 px-5 text-sm font-medium"
          >
            <CheckCircle2 size={15} strokeWidth={1.75} />
            {isSubmitting
              ? 'Saving...'
              : confirmDefaultsArmed && !allRated
                ? 'Confirm Defaults & Continue'
                : 'Save Ratings & Continue'}
          </Button>
        </div>
      </motion.div>
    </div>
  );
};
