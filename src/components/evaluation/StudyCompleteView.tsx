import React from 'react';
import { motion } from 'framer-motion';
import {
  CONDITION_META,
  Part1Condition,
  Part2Condition
} from '../../config/studyConfig';
import {
  StudySessionBundle,
  downloadSessionJson,
  exportAllToSurveysCsv,
  exportAllToTrialsCsv,
  triggerFileDownload
} from '../../services/StudyTelemetryService';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import {
  AlertTriangle,
  CheckCircle2,
  Cloud,
  CloudOff,
  Download,
  RefreshCw,
  UserPlus
} from 'lucide-react';

interface StudyCompleteViewProps {
  sessionBundle: StudySessionBundle;
  part1Order: Part1Condition[];
  part2Order: Part2Condition[];
  isSyncing: boolean;
  syncError: string | null;
  onRetrySync: () => void;
  onStartNextParticipant: () => void;
  onReturnToCockpit: () => void;
}

export const StudyCompleteView: React.FC<StudyCompleteViewProps> = ({
  sessionBundle,
  part1Order,
  part2Order,
  isSyncing,
  syncError,
  onRetrySync,
  onStartNextParticipant,
  onReturnToCockpit
}) => {
  const isSynced = sessionBundle.sync_status === 'SYNCED';

  return (
    <motion.div
      initial={{ opacity: 0, y: 8, scale: 0.99 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 420, damping: 36, mass: 0.8 }}
      className="mx-auto my-auto flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-[14px] border border-border bg-card"
    >
      {/* Header */}
      <div className="flex flex-col justify-between gap-4 border-b border-border bg-popover/50 px-6 py-5 sm:flex-row sm:items-center">
        <div className="flex items-center gap-3">
          <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-[#34d399]/30 bg-[#34d399]/10">
            <CheckCircle2 size={18} strokeWidth={1.75} className="text-[#34d399]" />
          </div>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-[#34d399]">
              Session Complete • {sessionBundle.participant_id}
            </div>
            <h2 className="mt-0.5 font-heading text-xl font-semibold tracking-[-0.025em] text-foreground">
              Thank You for Participating
            </h2>
          </div>
        </div>

        {/* Cloud Sync Pill */}
        <Badge
          variant="outline"
          className={`gap-1.5 rounded-full px-3 py-1 font-mono text-[11px] ${
            isSynced
              ? 'border-[#34d399]/35 bg-[#34d399]/10 text-[#34d399]'
              : isSyncing
                ? 'border-[#38bdf8]/35 bg-[#38bdf8]/10 text-[#38bdf8]'
                : 'border-[#fbbf24]/35 bg-[#fbbf24]/10 text-[#fbbf24]'
          }`}
        >
          {isSynced ? (
            <Cloud size={13} />
          ) : isSyncing ? (
            <RefreshCw size={13} className="animate-spin" />
          ) : (
            <CloudOff size={13} />
          )}
          <span>
            {isSynced
              ? 'Synced to AWS'
              : isSyncing
                ? 'Syncing...'
                : 'Saved Locally'}
          </span>
        </Badge>
      </div>

      {/* Body */}
      <div className="flex-1 space-y-5 overflow-y-auto p-6">
        {!isSynced && !isSyncing && (
          <div className="flex flex-col justify-between gap-3 rounded-[10px] border border-[#f87171]/35 bg-[#f87171]/10 p-4 sm:flex-row sm:items-center">
            <div className="flex items-start gap-2.5 text-xs text-foreground">
              <AlertTriangle size={16} className="mt-0.5 shrink-0 text-[#f87171]" />
              <div>
                <div className="font-medium">Cloud upload unavailable — local backup intact.</div>
                <div className="mt-0.5 text-muted-foreground">
                  {syncError || sessionBundle.last_sync_error || 'Retry upload or download the JSON backup below.'}
                </div>
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onRetrySync} className="h-8 text-xs">
                <RefreshCw size={13} /> Retry Sync
              </Button>
              <Button
                type="button"
                variant="destructive"
                size="sm"
                onClick={() => downloadSessionJson(sessionBundle)}
                className="h-8 text-xs"
              >
                <Download size={13} /> Backup JSON
              </Button>
            </div>
          </div>
        )}

        {/* Condition Debrief — Part 1 */}
        <div className="space-y-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            Part 1 Debrief • Directional Localization Accuracy
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {part1Order.map((cond) => {
              const trials = sessionBundle.trials.filter((t) => t.part === 1 && t.condition === cond);
              const acc = trials.length
                ? Math.round((trials.filter((t) => t.is_correct).length / trials.length) * 100)
                : 0;
              const fb = trials.filter((t) => t.is_front_back_reversal).length;
              const meta = CONDITION_META[cond];
              return (
                <div
                  key={cond}
                  className="rounded-[10px] border border-border bg-[#09090b]/60 p-4"
                >
                  <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                    {meta.shortLabel}
                  </div>
                  <div
                    className="mt-1 font-mono text-2xl font-semibold tabular-nums"
                    style={{ color: meta.accentColor }}
                  >
                    {acc}%
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                    {fb} front–back reversal{fb === 1 ? '' : 's'}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Condition Debrief — Part 2 */}
        <div className="space-y-2">
          <div className="font-mono text-[11px] uppercase tracking-[0.08em] text-muted-foreground">
            Part 2 Debrief • Alarm Duration & Wasted Post-Glance Blare
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {part2Order.map((cond) => {
              const trials = sessionBundle.trials.filter((t) => t.part === 2 && t.condition === cond);
              const avgDur = trials.length
                ? Math.round(trials.reduce((a, b) => a + b.alarm_duration_ms, 0) / trials.length)
                : 0;
              const avgWasted = trials.length
                ? Math.round(trials.reduce((a, b) => a + b.wasted_alarm_ms, 0) / trials.length)
                : 0;
              const meta = CONDITION_META[cond];
              return (
                <div
                  key={cond}
                  className="rounded-[10px] border border-border bg-[#09090b]/60 p-4"
                >
                  <div className="font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                    {meta.label}
                  </div>
                  <div
                    className="mt-1 font-mono text-2xl font-semibold tabular-nums"
                    style={{ color: meta.accentColor }}
                  >
                    {avgDur} ms
                  </div>
                  <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                    Mean wasted alarm: {avgWasted} ms
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Dataset Exports */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => downloadSessionJson(sessionBundle)}
            className="h-8 text-xs"
          >
            <Download size={13} /> Session (.json)
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              triggerFileDownload(
                `aura_trials_${sessionBundle.participant_id}.csv`,
                exportAllToTrialsCsv([sessionBundle]),
                'text/csv'
              )
            }
            className="h-8 text-xs"
          >
            <Download size={13} /> Trials (.csv)
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              triggerFileDownload(
                `aura_surveys_${sessionBundle.participant_id}.csv`,
                exportAllToSurveysCsv([sessionBundle]),
                'text/csv'
              )
            }
            className="h-8 text-xs"
          >
            <Download size={13} /> Surveys (.csv)
          </Button>
        </div>
      </div>

      <Separator />

      {/* Footer Actions */}
      <div className="flex flex-col justify-between gap-3 bg-popover/50 px-6 py-4 sm:flex-row sm:items-center">
        <Button
          type="button"
          variant="outline"
          onClick={onReturnToCockpit}
          className="h-9 text-sm"
        >
          Return to Cockpit
        </Button>

        <Button
          type="button"
          variant="default"
          onClick={onStartNextParticipant}
          className="h-9 px-5 text-sm font-medium"
        >
          <UserPlus size={15} strokeWidth={1.75} />
          Start Next Participant
        </Button>
      </div>
    </motion.div>
  );
};
