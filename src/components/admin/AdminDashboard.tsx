import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion } from 'framer-motion';
import {
  CONDITION_META,
  Part1Condition,
  Part2Condition,
  STUDY_PARAMETERS,
  StudyConditionType
} from '../../config/studyConfig';
import {
  StudySessionBundle,
  exportAllToSurveysCsv,
  exportAllToTrialsCsv,
  loadAllLocalSessions,
  triggerFileDownload
} from '../../services/StudyTelemetryService';
import {
  ZONES_ORDER,
  aggregateByCondition,
  aggregateSurveys,
  buildConfusionMatrix,
  computePairedComparison
} from '../../utils/studyStats';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle
} from '@/components/ui/dialog';
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  HardDrive,
  Lock,
  LogOut,
  RefreshCw,
  ShieldAlert,
  SlidersHorizontal,
  Table2,
  X
} from 'lucide-react';

interface AdminSessionRecord extends StudySessionBundle {
  presigned_url?: string | null;
  source?: 'AWS_CLOUD' | 'LOCAL_BROWSER';
}

interface AdminDashboardProps {
  isOpen: boolean;
  onClose: () => void;
}

const ADMIN_SESSION_KEY = 'aura_admin_session_pwd_v1';

const ZONE_SHORT: Record<string, string> = {
  LEFT_MIRROR: 'LEFT',
  RIGHT_MIRROR: 'RIGHT',
  REAR_MIRROR: 'REAR',
  FRONT_WINDSHIELD: 'FRONT',
  TIMEOUT: 'T/O'
};

export const AdminDashboard: React.FC<AdminDashboardProps> = ({ isOpen, onClose }) => {
  const [passwordInput, setPasswordInput] = useState('');
  const [authPassword, setAuthPassword] = useState<string | null>(() => {
    try {
      return sessionStorage.getItem(ADMIN_SESSION_KEY);
    } catch {
      return null;
    }
  });
  const [offlineLocalMode, setOfflineLocalMode] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [sessions, setSessions] = useState<AdminSessionRecord[]>([]);
  const [includeLocalFallback, setIncludeLocalFallback] = useState(false);
  const [excludeTestRuns, setExcludeTestRuns] = useState(true);
  const [isLoadingData, setIsLoadingData] = useState(false);
  const [dataError, setDataError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'STATS' | 'SURVEYS' | 'SESSIONS'>('OVERVIEW');
  const [inspectedSession, setInspectedSession] = useState<AdminSessionRecord | null>(null);

  const apiBase = STUDY_PARAMETERS.apiBaseUrl.replace(/\/+$/, '');

  const fetchResults = useCallback(
    async (pwd: string) => {
      if (!apiBase) {
        setDataError('VITE_STUDY_API_URL is not configured in this build.');
        return;
      }
      setIsLoadingData(true);
      setDataError(null);
      try {
        const resp = await fetch(`${apiBase}/admin/results`, {
          method: 'GET',
          headers: {
            'x-admin-password': pwd
          }
        });
        if (resp.status === 401) {
          sessionStorage.removeItem(ADMIN_SESSION_KEY);
          setAuthPassword(null);
          setAuthError('Session expired or invalid admin password.');
          return;
        }
        if (!resp.ok) {
          const text = await resp.text();
          throw new Error(`HTTP ${resp.status}: ${text}`);
        }
        const data = (await resp.json()) as { sessions?: AdminSessionRecord[] };
        const cloudSessions = (data.sessions || []).map((s) => ({
          ...s,
          source: 'AWS_CLOUD' as const
        }));
        setSessions(cloudSessions);
      } catch (err) {
        setDataError(err instanceof Error ? err.message : String(err));
      } finally {
        setIsLoadingData(false);
      }
    },
    [apiBase]
  );

  useEffect(() => {
    if (isOpen && authPassword && !offlineLocalMode) {
      fetchResults(authPassword);
    }
  }, [isOpen, authPassword, offlineLocalMode, fetchResults]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput.trim()) return;
    if (!apiBase) {
      setAuthError('API Gateway endpoint is not configured (VITE_STUDY_API_URL). Use Offline Local Mode below.');
      return;
    }

    setIsLoggingIn(true);
    setAuthError(null);
    try {
      const resp = await fetch(`${apiBase}/admin/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-admin-password': passwordInput
        },
        body: JSON.stringify({ password: passwordInput })
      });
      if (!resp.ok) {
        setAuthError('Invalid administrator password.');
        return;
      }
      sessionStorage.setItem(ADMIN_SESSION_KEY, passwordInput);
      setOfflineLocalMode(false);
      setAuthPassword(passwordInput);
      setPasswordInput('');
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : 'Login request failed');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleSignOut = () => {
    sessionStorage.removeItem(ADMIN_SESSION_KEY);
    setAuthPassword(null);
    setOfflineLocalMode(false);
    setSessions([]);
  };

  const mergedAllSessions = useMemo<AdminSessionRecord[]>(() => {
    const locals: AdminSessionRecord[] = loadAllLocalSessions().map((l) => ({
      ...l,
      source: 'LOCAL_BROWSER',
      presigned_url: null
    }));

    if (offlineLocalMode) {
      return locals;
    }
    if (!includeLocalFallback) return sessions;

    const cloudPids = new Set(sessions.map((s) => s.participant_id));
    return [...sessions, ...locals.filter((l) => !cloudPids.has(l.participant_id))];
  }, [sessions, includeLocalFallback, offlineLocalMode]);

  const hiddenTestCount = useMemo(
    () => mergedAllSessions.filter((s) => s.participant_id === 'P_00').length,
    [mergedAllSessions]
  );

  const displaySessions = useMemo(
    () =>
      excludeTestRuns
        ? mergedAllSessions.filter((s) => s.participant_id !== 'P_00')
        : mergedAllSessions,
    [mergedAllSessions, excludeTestRuns]
  );

  const part1Conditions: Part1Condition[] = ['MONO_BASELINE', 'STEREO_BASELINE', 'SPATIAL_3D'];
  const part2Conditions: Part2Condition[] = ['TRADITIONAL_PERSISTENT', 'GAZE_CONTINGENT_3D'];

  const p1Metrics = useMemo(
    () => part1Conditions.map((c) => aggregateByCondition(displaySessions, 1, c)),
    [displaySessions]
  );
  const p2Metrics = useMemo(
    () => part2Conditions.map((c) => aggregateByCondition(displaySessions, 2, c)),
    [displaySessions]
  );

  const pairedStats = useMemo(() => {
    const accRatio = (trials: StudySessionBundle['trials']) =>
      trials.length ? (trials.filter((t) => t.is_correct).length / trials.length) * 100 : null;
    const fbRatio = (trials: StudySessionBundle['trials']) =>
      trials.length ? (trials.filter((t) => t.is_front_back_reversal).length / trials.length) * 100 : null;
    const meanRt = (trials: StudySessionBundle['trials']) => {
      const rts = trials.map((t) => t.confirmed_rt_ms).filter((v): v is number => v !== null);
      return rts.length ? rts.reduce((a, b) => a + b, 0) / rts.length : null;
    };
    const meanAlarm = (trials: StudySessionBundle['trials']) =>
      trials.length ? trials.reduce((a, b) => a + b.alarm_duration_ms, 0) / trials.length : null;
    const meanWasted = (trials: StudySessionBundle['trials']) =>
      trials.length ? trials.reduce((a, b) => a + b.wasted_alarm_ms, 0) / trials.length : null;

    return [
      computePairedComparison(
        displaySessions,
        'Part 1 Localization Accuracy (%)',
        'Accuracy %',
        1,
        'STEREO_BASELINE',
        'SPATIAL_3D',
        accRatio
      ),
      computePairedComparison(
        displaySessions,
        'Part 1 Localization Accuracy (%)',
        'Accuracy %',
        1,
        'MONO_BASELINE',
        'SPATIAL_3D',
        accRatio
      ),
      computePairedComparison(
        displaySessions,
        'Front–Back Confusion Rate (%)',
        'Reversal %',
        1,
        'STEREO_BASELINE',
        'SPATIAL_3D',
        fbRatio
      ),
      computePairedComparison(
        displaySessions,
        'Localization Reaction Time (ms)',
        'Mean RT (ms)',
        1,
        'STEREO_BASELINE',
        'SPATIAL_3D',
        meanRt
      ),
      computePairedComparison(
        displaySessions,
        'Total Alarm Duration (ms)',
        'Alarm ms',
        2,
        'TRADITIONAL_PERSISTENT',
        'GAZE_CONTINGENT_3D',
        meanAlarm
      ),
      computePairedComparison(
        displaySessions,
        'Wasted Post-Glance Alarm (ms)',
        'Wasted ms',
        2,
        'TRADITIONAL_PERSISTENT',
        'GAZE_CONTINGENT_3D',
        meanWasted
      )
    ];
  }, [displaySessions]);

  const p1SurveyAgg = useMemo(
    () => aggregateSurveys(displaySessions, 1, part1Conditions),
    [displaySessions]
  );
  const p2SurveyAgg = useMemo(
    () => aggregateSurveys(displaySessions, 2, part2Conditions),
    [displaySessions]
  );

  if (!isOpen) return null;

  // --- AUTHENTICATION GATE (+ OFFLINE LOCAL ENTRY) ---
  if (!authPassword && !offlineLocalMode) {
    return (
      <div className="fixed inset-0 z-[11000] flex items-center justify-center bg-[#09090b]/92 p-4 backdrop-blur-md">
        <motion.div
          initial={{ opacity: 0, y: 8, scale: 0.99 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ type: 'spring', stiffness: 420, damping: 36, mass: 0.8 }}
          className="w-full max-w-md space-y-5 rounded-[14px] border border-border bg-card p-6 sm:p-7"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-md border border-border bg-secondary">
                <Lock size={15} strokeWidth={1.75} className="text-[#38bdf8]" />
              </div>
              <h2 className="font-heading text-lg font-semibold tracking-[-0.02em] text-foreground">
                Researcher Admin Portal
              </h2>
            </div>
            <Button type="button" variant="ghost" size="icon-sm" onClick={onClose}>
              <X size={16} />
            </Button>
          </div>

          <p className="text-sm leading-relaxed text-muted-foreground">
            Authenticate against AWS Lambda (<code className="font-mono text-xs text-foreground">POST /admin/login</code>) to inspect S3 & DynamoDB participant logs, or browse sessions saved locally in this browser.
          </p>

          <form onSubmit={handleLoginSubmit} className="space-y-3">
            <Input
              type="password"
              autoFocus
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Administrator password"
              className="h-9 font-mono text-sm"
            />

            {authError && (
              <div className="rounded-md border border-[#f87171]/35 bg-[#f87171]/10 px-3 py-2 text-xs text-[#f87171]">
                {authError}
              </div>
            )}

            <Button
              type="submit"
              variant="default"
              disabled={isLoggingIn}
              className="h-9 w-full text-sm font-medium"
            >
              {isLoggingIn ? 'Verifying Credentials...' : 'Unlock Cloud Analytics'}
            </Button>
          </form>

          <div className="border-t border-border pt-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => setOfflineLocalMode(true)}
              className="h-9 w-full text-xs text-muted-foreground hover:text-foreground"
            >
              <HardDrive size={14} strokeWidth={1.75} />
              Inspect Local Browser Sessions (Offline)
            </Button>
          </div>
        </motion.div>
      </div>
    );
  }

  const totalTrials = displaySessions.reduce((acc, s) => acc + (s.trials?.length || 0), 0);
  const totalSurveys = displaySessions.reduce((acc, s) => acc + (s.surveys?.length || 0), 0);

  const monoM = p1Metrics[0];
  const stereoM = p1Metrics[1];
  const spatialM = p1Metrics[2];
  const tradM = p2Metrics[0];
  const gazeM = p2Metrics[1];
  const alarmSavedMs = Math.max(0, tradM.meanAlarmDurationMs - gazeM.meanAlarmDurationMs);
  const alarmSavedPct =
    tradM.meanAlarmDurationMs > 0
      ? Math.round((alarmSavedMs / tradM.meanAlarmDurationMs) * 100)
      : 0;

  const tabs: Array<{ id: typeof activeTab; label: string; icon: React.ComponentType<{ size?: number }> }> = [
    { id: 'OVERVIEW', label: 'Overview', icon: BarChart3 },
    { id: 'STATS', label: 'Confusion & Stats', icon: Activity },
    { id: 'SURVEYS', label: 'Survey Shifts', icon: SlidersHorizontal },
    { id: 'SESSIONS', label: `Sessions (${displaySessions.length})`, icon: Table2 }
  ];

  return (
    <div className="fixed inset-0 z-[11000] flex flex-col overflow-hidden bg-background">
      {/* Top Admin Header */}
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card px-5 py-3.5 sm:px-6">
        <div className="flex items-center gap-3">
          <div className="flex size-8 items-center justify-center rounded-md border border-border bg-secondary">
            <Database size={15} strokeWidth={1.75} className="text-[#38bdf8]" />
          </div>
          <div>
            <div className="font-mono text-[10.5px] uppercase tracking-[0.08em] text-[#38bdf8]">
              {offlineLocalMode ? 'Offline Local Browser Store' : 'AWS Serverless Telemetry • ap-northeast-2'}
            </div>
            <h1 className="font-heading text-base font-semibold tracking-[-0.02em] text-foreground">
              Empirical Study Analytics Workbench
            </h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={excludeTestRuns}
              onChange={(e) => setExcludeTestRuns(e.target.checked)}
              className="accent-[#38bdf8]"
            />
            <span>Exclude P_00{hiddenTestCount > 0 ? ` (${hiddenTestCount})` : ''}</span>
          </label>

          {!offlineLocalMode && (
            <>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border bg-popover px-2.5 py-1.5 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={includeLocalFallback}
                  onChange={(e) => setIncludeLocalFallback(e.target.checked)}
                  className="accent-[#38bdf8]"
                />
                <span>Merge Local</span>
              </label>

              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => authPassword && fetchResults(authPassword)}
                disabled={isLoadingData}
                className="h-8 text-xs"
              >
                <RefreshCw size={13} className={isLoadingData ? 'animate-spin' : ''} />
                {isLoadingData ? 'Syncing...' : 'Refresh'}
              </Button>
            </>
          )}

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              triggerFileDownload(
                `aura_master_trials_${new Date().toISOString().slice(0, 10)}.csv`,
                exportAllToTrialsCsv(displaySessions),
                'text/csv'
              )
            }
            className="h-8 text-xs"
          >
            <Download size={13} /> Trials CSV
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              triggerFileDownload(
                `aura_master_surveys_${new Date().toISOString().slice(0, 10)}.csv`,
                exportAllToSurveysCsv(displaySessions),
                'text/csv'
              )
            }
            className="h-8 text-xs"
          >
            <Download size={13} /> Surveys CSV
          </Button>

          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() =>
              triggerFileDownload(
                `aura_master_bundle_${new Date().toISOString().slice(0, 10)}.json`,
                JSON.stringify(displaySessions, null, 2),
                'application/json'
              )
            }
            className="h-8 text-xs"
          >
            <FileCode2 size={13} /> JSON
          </Button>

          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={handleSignOut}
            title={offlineLocalMode ? 'Back to Cloud Login' : 'Sign Out'}
          >
            <LogOut size={14} />
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} title="Close Admin Portal">
            <X size={15} />
          </Button>
        </div>
      </header>

      {/* Sub-Nav Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border bg-card/50 px-5 py-2.5 sm:px-6">
        <div className="flex flex-wrap items-center gap-1.5">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {active && (
                  <motion.span
                    layoutId="adminTabIndicator"
                    transition={{ type: 'spring', stiffness: 420, damping: 36, mass: 0.8 }}
                    className="absolute inset-0 rounded-md border border-border bg-secondary"
                  />
                )}
                <span className="relative z-10 inline-flex items-center gap-1.5">
                  <Icon size={13} />
                  {tab.label}
                </span>
              </button>
            );
          })}
        </div>

        <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {displaySessions.length} participants • {totalTrials} trials • {totalSurveys} survey entries
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto px-5 py-6 sm:px-6">
        <div className="mx-auto max-w-6xl space-y-6">
          {dataError && (
            <div className="rounded-[10px] border border-[#f87171]/35 bg-[#f87171]/10 px-4 py-3 text-xs text-[#f87171]">
              AWS Fetch Warning: {dataError}
            </div>
          )}

          {/* Executive KPI Cards */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <div className="rounded-[10px] border border-border bg-card p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                Participants
              </div>
              <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-foreground">
                {displaySessions.length}
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                P1: {displaySessions.filter((s) => s.part1_completed).length} • P2:{' '}
                {displaySessions.filter((s) => s.part2_completed).length}
              </div>
            </div>

            <div className="rounded-[10px] border border-border bg-card p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                3D Spatial Accuracy
              </div>
              <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-[#38bdf8]">
                {spatialM.accuracyPct}%
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                Mono {monoM.accuracyPct}% • Stereo {stereoM.accuracyPct}%
              </div>
            </div>

            <div className="rounded-[10px] border border-border bg-card p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                Front–Back Reversals
              </div>
              <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-[#34d399]">
                {spatialM.frontBackReversalPct}%
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                Stereo {stereoM.frontBackReversalPct}% • Mono {monoM.frontBackReversalPct}%
              </div>
            </div>

            <div className="rounded-[10px] border border-border bg-card p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                3D Spatial Mean RT
              </div>
              <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-foreground">
                {spatialM.meanRtMs} ms
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                Median {spatialM.medianRtMs} ms (Stereo {stereoM.meanRtMs} ms)
              </div>
            </div>

            <div className="rounded-[10px] border border-border bg-card p-4">
              <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                Alarm Duration Saved
              </div>
              <div className="mt-1.5 font-mono text-2xl font-semibold tabular-nums text-[#34d399]">
                -{alarmSavedPct}%
              </div>
              <div className="mt-1 font-mono text-[11px] text-muted-foreground">
                Trad {tradM.meanAlarmDurationMs}ms → Gaze {gazeM.meanAlarmDurationMs}ms
              </div>
            </div>
          </div>

          {/* TAB 1: OVERVIEW CHARTS */}
          {activeTab === 'OVERVIEW' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {/* Chart 1: Accuracy & Reversal */}
              <div className="rounded-[10px] border border-border bg-card p-5">
                <div className="mb-3 border-b border-border pb-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                  Part 1: Localization Accuracy vs. Front–Back Reversals (%)
                </div>
                <svg viewBox="0 0 500 240" className="h-[220px] w-full">
                  {[0, 25, 50, 75, 100].map((v) => {
                    const y = 195 - (v / 100) * 165;
                    return (
                      <g key={v}>
                        <line x1={48} x2={480} y1={y} y2={y} stroke="rgba(255,255,255,0.06)" />
                        <text x={38} y={y + 4} fill="#71717a" fontSize={10} fontFamily="var(--font-mono)" textAnchor="end">
                          {v}%
                        </text>
                      </g>
                    );
                  })}
                  {p1Metrics.map((m, idx) => {
                    const cx = 115 + idx * 140;
                    const accH = (m.accuracyPct / 100) * 165;
                    const fbH = (m.frontBackReversalPct / 100) * 165;
                    const color = CONDITION_META[m.condition].accentColor;
                    return (
                      <g key={m.condition}>
                        <rect x={cx - 34} y={195 - accH} width={30} height={accH} rx={4} fill={color} />
                        <text x={cx - 19} y={189 - accH} fill="#fafafa" fontSize={10.5} fontWeight={600} fontFamily="var(--font-mono)" textAnchor="middle">
                          {m.accuracyPct}%
                        </text>
                        <rect x={cx + 4} y={195 - fbH} width={30} height={fbH} rx={4} fill="#f87171" opacity={0.85} />
                        <text x={cx + 19} y={189 - fbH} fill="#f87171" fontSize={10.5} fontWeight={600} fontFamily="var(--font-mono)" textAnchor="middle">
                          {m.frontBackReversalPct}%
                        </text>
                        <text x={cx} y={216} fill="#a1a1aa" fontSize={11} fontWeight={500} textAnchor="middle">
                          {CONDITION_META[m.condition].shortLabel}
                        </text>
                      </g>
                    );
                  })}
                  <rect x={280} y={10} width={10} height={10} rx={2} fill="#38bdf8" />
                  <text x={295} y={19} fill="#a1a1aa" fontSize={10}>Accuracy %</text>
                  <rect x={375} y={10} width={10} height={10} rx={2} fill="#f87171" />
                  <text x={390} y={19} fill="#a1a1aa" fontSize={10}>Front–Back Rev %</text>
                </svg>
              </div>

              {/* Chart 2: Reaction Time */}
              <div className="rounded-[10px] border border-border bg-card p-5">
                <div className="mb-3 border-b border-border pb-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                  Part 1: Mean & Median Reaction Time (ms)
                </div>
                {(() => {
                  const maxRt = Math.max(
                    1500,
                    ...p1Metrics.map((m) => Math.max(m.meanRtMs, m.medianRtMs) * 1.15)
                  );
                  return (
                    <svg viewBox="0 0 500 240" className="h-[220px] w-full">
                      {[0, 0.25, 0.5, 0.75, 1].map((r) => {
                        const val = Math.round(r * maxRt);
                        const y = 195 - r * 165;
                        return (
                          <g key={r}>
                            <line x1={55} x2={480} y1={y} y2={y} stroke="rgba(255,255,255,0.06)" />
                            <text x={48} y={y + 4} fill="#71717a" fontSize={10} fontFamily="var(--font-mono)" textAnchor="end">
                              {val}
                            </text>
                          </g>
                        );
                      })}
                      {p1Metrics.map((m, idx) => {
                        const cx = 120 + idx * 135;
                        const meanH = (m.meanRtMs / maxRt) * 165;
                        const medH = (m.medianRtMs / maxRt) * 165;
                        return (
                          <g key={m.condition}>
                            <rect x={cx - 34} y={195 - meanH} width={30} height={meanH} rx={4} fill="#38bdf8" />
                            <text x={cx - 19} y={189 - meanH} fill="#fafafa" fontSize={10} fontWeight={600} fontFamily="var(--font-mono)" textAnchor="middle">
                              {m.meanRtMs}
                            </text>
                            <rect x={cx + 4} y={195 - medH} width={30} height={medH} rx={4} fill="#a1a1aa" />
                            <text x={cx + 19} y={189 - medH} fill="#e4e4e7" fontSize={10} fontWeight={600} fontFamily="var(--font-mono)" textAnchor="middle">
                              {m.medianRtMs}
                            </text>
                            <text x={cx} y={216} fill="#a1a1aa" fontSize={11} fontWeight={500} textAnchor="middle">
                              {CONDITION_META[m.condition].shortLabel}
                            </text>
                          </g>
                        );
                      })}
                      <rect x={300} y={10} width={10} height={10} rx={2} fill="#38bdf8" />
                      <text x={315} y={19} fill="#a1a1aa" fontSize={10}>Mean RT</text>
                      <rect x={385} y={10} width={10} height={10} rx={2} fill="#a1a1aa" />
                      <text x={400} y={19} fill="#a1a1aa" fontSize={10}>Median RT</text>
                    </svg>
                  );
                })()}
              </div>

              {/* Chart 3: Part 2 Alarm Fatigue */}
              <div className="rounded-[10px] border border-border bg-card p-5 lg:col-span-2">
                <div className="mb-4 border-b border-border pb-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                  Part 2: Alarm Duration & Wasted Post-Glance Blare (ms)
                </div>
                <div className="grid grid-cols-1 items-center gap-6 lg:grid-cols-12">
                  <svg viewBox="0 0 600 175" className="h-[170px] w-full lg:col-span-7">
                    {[0, 1000, 2000, 3000, 3500].map((ms) => {
                      const x = 140 + (ms / 3800) * 430;
                      return (
                        <g key={ms}>
                          <line x1={x} x2={x} y1={24} y2={135} stroke="rgba(255,255,255,0.06)" />
                          <text x={x} y={152} fill="#71717a" fontSize={10} fontFamily="var(--font-mono)" textAnchor="middle">
                            {ms} ms
                          </text>
                        </g>
                      );
                    })}
                    {p2Metrics.map((m, idx) => {
                      const y = 44 + idx * 54;
                      const usefulMs = Math.max(0, m.meanAlarmDurationMs - m.meanWastedAlarmMs);
                      const usefulW = (usefulMs / 3800) * 430;
                      const wastedW = (m.meanWastedAlarmMs / 3800) * 430;
                      return (
                        <g key={m.condition}>
                          <text x={130} y={y + 19} fill="#e4e4e7" fontSize={11.5} fontWeight={500} textAnchor="end">
                            {CONDITION_META[m.condition].shortLabel}
                          </text>
                          <rect x={140} y={y} width={usefulW} height={26} rx={4} fill="#34d399" />
                          <rect x={140 + usefulW} y={y} width={wastedW} height={26} rx={4} fill="#f87171" />
                          <text x={148 + usefulW + wastedW} y={y + 17} fill="#fafafa" fontSize={10.5} fontFamily="var(--font-mono)">
                            {m.meanAlarmDurationMs} ms ({m.meanBeepPulses} pulses)
                          </text>
                        </g>
                      );
                    })}
                    <rect x={140} y={4} width={10} height={10} rx={2} fill="#34d399" />
                    <text x={155} y={13} fill="#a1a1aa" fontSize={10}>Useful alert until gaze check</text>
                    <rect x={340} y={4} width={10} height={10} rx={2} fill="#f87171" />
                    <text x={355} y={13} fill="#a1a1aa" fontSize={10}>Wasted post-glance blare</text>
                  </svg>

                  <div className="space-y-2.5 lg:col-span-5">
                    <div className="rounded-md border border-border bg-popover p-3">
                      <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                        Traditional Persistent Mean Alarm
                      </div>
                      <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-[#f87171]">
                        {tradM.meanAlarmDurationMs} ms (Wasted: {tradM.meanWastedAlarmMs} ms)
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-popover p-3">
                      <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                        Gaze-Contingent 3D Mean Alarm
                      </div>
                      <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-[#34d399]">
                        {gazeM.meanAlarmDurationMs} ms (0 ms wasted post-dwell)
                      </div>
                    </div>
                    <div className="rounded-md border border-border bg-popover p-3">
                      <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-muted-foreground">
                        Mean Eyes-Off-Road Duration
                      </div>
                      <div className="mt-1 font-mono text-sm font-semibold tabular-nums text-[#38bdf8]">
                        Trad: {tradM.meanEyesOffRoadMs} ms • Gaze 3D: {gazeM.meanEyesOffRoadMs} ms
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: CONFUSION MATRICES (WITH TIMEOUT COLUMN) & PAIRED STATS */}
          {activeTab === 'STATS' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                {part1Conditions.map((cond) => {
                  const matrix = buildConfusionMatrix(displaySessions, cond);
                  const meta = CONDITION_META[cond];
                  const cols = [...ZONES_ORDER, 'TIMEOUT'] as const;
                  return (
                    <div key={cond} className="rounded-[10px] border border-border bg-card p-4">
                      <div
                        className="mb-3 border-b border-border pb-2 font-mono text-[11px] font-semibold uppercase tracking-[0.06em]"
                        style={{ color: meta.accentColor }}
                      >
                        {meta.shortLabel} — Confusion Matrix
                      </div>
                      <div className="overflow-x-auto">
                        <table className="w-full border-collapse font-mono text-[11px] tabular-nums">
                          <thead>
                            <tr className="text-muted-foreground">
                              <th className="p-1.5 text-left font-medium">Tgt \ Resp</th>
                              {cols.map((z) => (
                                <th key={z} className="p-1.5 text-center font-medium">
                                  {ZONE_SHORT[z]}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody>
                            {ZONES_ORDER.map((target) => {
                              const row = matrix[target];
                              const rowSum = cols.reduce((a, z) => a + (row[z] || 0), 0);
                              return (
                                <tr key={target}>
                                  <td className="p-1.5 font-semibold text-foreground">{ZONE_SHORT[target]}</td>
                                  {cols.map((resp) => {
                                    const count = row[resp] || 0;
                                    const ratio = rowSum > 0 ? count / rowSum : 0;
                                    const isDiag = target === resp;
                                    const bg = isDiag
                                      ? `rgba(52, 211, 153, ${0.12 + ratio * 0.52})`
                                      : count > 0
                                        ? `rgba(248, 113, 113, ${0.12 + ratio * 0.52})`
                                        : 'rgba(255, 255, 255, 0.02)';
                                    return (
                                      <td
                                        key={resp}
                                        className="border border-border p-1.5 text-center"
                                        style={{
                                          backgroundColor: bg,
                                          color: count > 0 ? '#fafafa' : '#71717a',
                                          fontWeight: isDiag ? 600 : 400
                                        }}
                                      >
                                        {count}
                                      </td>
                                    );
                                  })}
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  );
                })}
              </div>

              <div className="rounded-[10px] border border-border bg-card p-5">
                <div className="mb-3 border-b border-border pb-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                  Within-Subjects Paired Statistical Comparisons (Student&apos;s Paired t-Test & Cohen&apos;s d)
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[680px] border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
                        <th className="px-2.5 py-2 font-medium">Comparison</th>
                        <th className="px-2.5 py-2 font-medium">n</th>
                        <th className="px-2.5 py-2 font-medium">Baseline</th>
                        <th className="px-2.5 py-2 font-medium">Proposed</th>
                        <th className="px-2.5 py-2 font-medium">Δ</th>
                        <th className="px-2.5 py-2 font-medium">t (df)</th>
                        <th className="px-2.5 py-2 font-medium">p-value</th>
                        <th className="px-2.5 py-2 font-medium">Cohen&apos;s d</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pairedStats.map((row, idx) => {
                        const sig = row.n >= 2 && row.pValue < 0.05;
                        return (
                          <tr key={idx} className="border-b border-border/60">
                            <td className="px-2.5 py-2.5 font-medium text-foreground">
                              {row.label}:{' '}
                              <span style={{ color: CONDITION_META[row.condA].accentColor }}>
                                {CONDITION_META[row.condA].shortLabel}
                              </span>{' '}
                              vs{' '}
                              <span style={{ color: CONDITION_META[row.condB].accentColor }}>
                                {CONDITION_META[row.condB].shortLabel}
                              </span>
                            </td>
                            <td className="px-2.5 py-2.5 font-mono tabular-nums text-muted-foreground">{row.n}</td>
                            <td className="px-2.5 py-2.5 font-mono tabular-nums">{row.meanA}</td>
                            <td className="px-2.5 py-2.5 font-mono font-semibold tabular-nums text-[#38bdf8]">
                              {row.meanB}
                            </td>
                            <td className="px-2.5 py-2.5 font-mono tabular-nums">
                              {row.diff > 0 ? `+${row.diff}` : row.diff}
                            </td>
                            <td className="px-2.5 py-2.5 font-mono tabular-nums text-muted-foreground">
                              {row.n >= 2 ? `${row.tStat} (${row.df})` : '—'}
                            </td>
                            <td
                              className={`px-2.5 py-2.5 font-mono font-semibold tabular-nums ${
                                sig ? 'text-[#34d399]' : 'text-muted-foreground'
                              }`}
                            >
                              {row.n >= 2 ? (row.pValue < 0.001 ? '< 0.001 ***' : `${row.pValue}${sig ? ' *' : ''}`) : 'Need n≥2'}
                            </td>
                            <td className="px-2.5 py-2.5 font-mono tabular-nums text-muted-foreground">
                              {row.n >= 2 ? row.cohensD : '—'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: PROGRESSIVE SURVEYS */}
          {activeTab === 'SURVEYS' && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
              {[
                { title: 'Part 1 Survey Means (Initial → Final)', conds: part1Conditions as StudyConditionType[], data: p1SurveyAgg },
                { title: 'Part 2 Survey Means (Initial → Final)', conds: part2Conditions as StudyConditionType[], data: p2SurveyAgg }
              ].map((block) => (
                <div key={block.title} className="space-y-3 rounded-[10px] border border-border bg-card p-5">
                  <div className="border-b border-border pb-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                    {block.title}
                  </div>
                  <div className="space-y-3">
                    {block.data.map((q) => (
                      <div key={q.questionId} className="space-y-2 rounded-lg border border-border bg-popover/60 p-3.5">
                        <div className="font-mono text-[10px] uppercase tracking-[0.06em] text-[#38bdf8]">
                          {q.category} ({q.lowerIsBetter ? 'Lower better' : 'Higher better'})
                        </div>
                        <div className="text-xs font-medium text-foreground">{q.prompt}</div>
                        <div className="space-y-1.5 pt-1">
                          {block.conds.map((c) => {
                            const stat = q.byCondition[c];
                            const meta = CONDITION_META[c];
                            const pct = stat.n > 0 ? Math.min(100, (stat.finalMean / 10) * 100) : 0;
                            return (
                              <div key={c} className="flex items-center gap-2.5 text-[11px]">
                                <span className="w-28 shrink-0 font-medium" style={{ color: meta.accentColor }}>
                                  {meta.shortLabel}
                                </span>
                                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-white/[0.08]">
                                  <div
                                    className="h-full rounded-full"
                                    style={{ width: `${pct}%`, backgroundColor: meta.accentColor }}
                                  />
                                </div>
                                <span className="w-36 shrink-0 text-right font-mono tabular-nums text-muted-foreground">
                                  {stat.n > 0
                                    ? `${stat.finalMean.toFixed(1)} (init ${stat.initialMean.toFixed(1)}, Δ ${
                                        stat.meanDelta >= 0 ? `+${stat.meanDelta.toFixed(1)}` : stat.meanDelta.toFixed(1)
                                      })`
                                    : '—'}
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* TAB 4: PARTICIPANT SESSIONS TABLE */}
          {activeTab === 'SESSIONS' && (
            <div className="rounded-[10px] border border-border bg-card p-5">
              <div className="mb-3 border-b border-border pb-2.5 font-mono text-[11px] uppercase tracking-[0.06em] text-muted-foreground">
                Recorded Participant Sessions
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border text-left font-mono text-[11px] uppercase tracking-[0.04em] text-muted-foreground">
                      <th className="px-2.5 py-2 font-medium">Participant</th>
                      <th className="px-2.5 py-2 font-medium">Source</th>
                      <th className="px-2.5 py-2 font-medium">Part 1</th>
                      <th className="px-2.5 py-2 font-medium">Part 2</th>
                      <th className="px-2.5 py-2 font-medium">Trials</th>
                      <th className="px-2.5 py-2 font-medium">Tracking Health</th>
                      <th className="px-2.5 py-2 font-medium">Updated</th>
                      <th className="px-2.5 py-2 font-medium">Inspect</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displaySessions.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">
                          No participant sessions found. Run a study via <code className="font-mono text-foreground">?study=KNU2026&amp;pid=P_01</code>.
                        </td>
                      </tr>
                    )}
                    {displaySessions.map((s) => {
                      const fps = s.hardware_info?.webcam_fps_avg ?? 0;
                      const mode = s.hardware_info?.input_mode || 'UNKNOWN';
                      const healthy = mode === 'SIMULATION_FALLBACK' || fps >= STUDY_PARAMETERS.minRequiredWebcamFps;
                      return (
                        <tr
                          key={`${s.participant_id}-${s.source || 'cloud'}`}
                          className="border-b border-border/60"
                        >
                          <td className="px-2.5 py-2.5 font-mono font-semibold text-[#38bdf8]">
                            {s.participant_id}
                          </td>
                          <td className="px-2.5 py-2.5">
                            <Badge
                              variant="outline"
                              className={`font-mono text-[10px] ${
                                s.source === 'LOCAL_BROWSER'
                                  ? 'border-[#fbbf24]/35 text-[#fbbf24]'
                                  : 'border-[#34d399]/35 text-[#34d399]'
                              }`}
                            >
                              {s.source === 'LOCAL_BROWSER' ? 'LOCAL' : 'AWS S3'}
                            </Badge>
                          </td>
                          <td className="px-2.5 py-2.5">
                            {s.part1_completed ? (
                              <span className="inline-flex items-center gap-1 text-[#34d399]">
                                <CheckCircle2 size={13} /> Done
                              </span>
                            ) : (
                              <span className="text-[#fbbf24]">Partial</span>
                            )}
                          </td>
                          <td className="px-2.5 py-2.5">
                            {s.part2_completed ? (
                              <span className="inline-flex items-center gap-1 text-[#34d399]">
                                <CheckCircle2 size={13} /> Done
                              </span>
                            ) : (
                              <span className="text-muted-foreground">Pending</span>
                            )}
                          </td>
                          <td className="px-2.5 py-2.5 font-mono tabular-nums">{s.trials?.length || 0}</td>
                          <td className="px-2.5 py-2.5 font-mono text-[11px]">
                            <span
                              className={`inline-flex items-center gap-1.5 ${
                                healthy ? 'text-[#34d399]' : 'text-[#f87171]'
                              }`}
                            >
                              {healthy ? <Eye size={13} /> : <ShieldAlert size={13} />}
                              {mode === 'SIMULATION_FALLBACK'
                                ? 'Key / Click Sim'
                                : `${fps} FPS (${Math.round((s.hardware_info?.cv_confidence_avg || 0) * 100)}%)`}
                            </span>
                          </td>
                          <td className="px-2.5 py-2.5 text-muted-foreground">
                            {s.updated_at ? new Date(s.updated_at).toLocaleString() : '—'}
                          </td>
                          <td className="px-2.5 py-2.5">
                            <div className="flex items-center gap-1.5">
                              <Button
                                type="button"
                                variant="outline"
                                size="xs"
                                onClick={() => setInspectedSession(s)}
                              >
                                <FileCode2 size={12} /> JSON
                              </Button>
                              {s.presigned_url && (
                                <a
                                  href={s.presigned_url}
                                  target="_blank"
                                  rel="noreferrer"
                                  className="inline-flex h-6 items-center gap-1 rounded-md border border-border px-2 text-[11px] text-foreground hover:bg-muted"
                                >
                                  <ExternalLink size={11} /> S3
                                </a>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Raw JSON Inspector Dialog */}
      <Dialog open={Boolean(inspectedSession)} onOpenChange={(open) => !open && setInspectedSession(null)}>
        <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-3xl">
          <DialogHeader className="flex flex-row items-center justify-between gap-4 pr-8">
            <DialogTitle>Raw Telemetry — {inspectedSession?.participant_id}</DialogTitle>
            {inspectedSession && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() =>
                  triggerFileDownload(
                    `aura_${inspectedSession.participant_id}.json`,
                    JSON.stringify(inspectedSession, null, 2),
                    'application/json'
                  )
                }
                className="h-7 text-xs"
              >
                <Download size={12} /> Download JSON
              </Button>
            )}
          </DialogHeader>
          <pre className="max-h-[64vh] overflow-auto rounded-lg border border-border bg-background p-4 font-mono text-[11px] leading-relaxed text-[#38bdf8]">
            {inspectedSession ? JSON.stringify(inspectedSession, null, 2) : ''}
          </pre>
        </DialogContent>
      </Dialog>
    </div>
  );
};
