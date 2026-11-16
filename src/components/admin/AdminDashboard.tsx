import React, { useState, useEffect, useCallback, useMemo } from 'react';
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
import {
  Activity,
  BarChart3,
  CheckCircle2,
  Database,
  Download,
  ExternalLink,
  Eye,
  FileCode2,
  Lock,
  LogOut,
  RefreshCw,
  ShieldAlert,
  Sliders,
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
  const [authError, setAuthError] = useState<string | null>(null);
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [sessions, setSessions] = useState<AdminSessionRecord[]>([]);
  const [includeLocalFallback, setIncludeLocalFallback] = useState(false);
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
    if (isOpen && authPassword) {
      fetchResults(authPassword);
    }
  }, [isOpen, authPassword, fetchResults]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordInput.trim()) return;
    if (!apiBase) {
      setAuthError('API Gateway endpoint is not configured (VITE_STUDY_API_URL).');
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
    setSessions([]);
  };

  // Merge cloud sessions + optional local-only sessions (without duplicating PIDs)
  const mergedSessions = useMemo<AdminSessionRecord[]>(() => {
    if (!includeLocalFallback) return sessions;
    const cloudPids = new Set(sessions.map((s) => s.participant_id));
    const locals: AdminSessionRecord[] = loadAllLocalSessions()
      .filter((l) => !cloudPids.has(l.participant_id))
      .map((l) => ({ ...l, source: 'LOCAL_BROWSER', presigned_url: null }));
    return [...sessions, ...locals];
  }, [sessions, includeLocalFallback]);

  const part1Conditions: Part1Condition[] = ['MONO_BASELINE', 'STEREO_BASELINE', 'SPATIAL_3D'];
  const part2Conditions: Part2Condition[] = ['TRADITIONAL_PERSISTENT', 'GAZE_CONTINGENT_3D'];

  const p1Metrics = useMemo(
    () => part1Conditions.map((c) => aggregateByCondition(mergedSessions, 1, c)),
    [mergedSessions]
  );
  const p2Metrics = useMemo(
    () => part2Conditions.map((c) => aggregateByCondition(mergedSessions, 2, c)),
    [mergedSessions]
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
        mergedSessions,
        'Part 1 Localization Accuracy (%)',
        'Accuracy %',
        1,
        'STEREO_BASELINE',
        'SPATIAL_3D',
        accRatio
      ),
      computePairedComparison(
        mergedSessions,
        'Part 1 Localization Accuracy (%)',
        'Accuracy %',
        1,
        'MONO_BASELINE',
        'SPATIAL_3D',
        accRatio
      ),
      computePairedComparison(
        mergedSessions,
        'Front–Back Confusion Rate (%)',
        'Reversal %',
        1,
        'STEREO_BASELINE',
        'SPATIAL_3D',
        fbRatio
      ),
      computePairedComparison(
        mergedSessions,
        'Localization Reaction Time (ms)',
        'Mean RT (ms)',
        1,
        'STEREO_BASELINE',
        'SPATIAL_3D',
        meanRt
      ),
      computePairedComparison(
        mergedSessions,
        'Total Alarm Duration (ms)',
        'Alarm ms',
        2,
        'TRADITIONAL_PERSISTENT',
        'GAZE_CONTINGENT_3D',
        meanAlarm
      ),
      computePairedComparison(
        mergedSessions,
        'Wasted Post-Glance Alarm (ms)',
        'Wasted ms',
        2,
        'TRADITIONAL_PERSISTENT',
        'GAZE_CONTINGENT_3D',
        meanWasted
      )
    ];
  }, [mergedSessions]);

  const p1SurveyAgg = useMemo(
    () => aggregateSurveys(mergedSessions, 1, part1Conditions),
    [mergedSessions]
  );
  const p2SurveyAgg = useMemo(
    () => aggregateSurveys(mergedSessions, 2, part2Conditions),
    [mergedSessions]
  );

  if (!isOpen) return null;

  // --- AUTHENTICATION GATE ---
  if (!authPassword) {
    return (
      <div className="modal-overlay" style={{ zIndex: 11000, background: 'rgba(4, 7, 15, 0.94)' }}>
        <div
          className="modal-content"
          style={{
            maxWidth: 440,
            background: '#0b1120',
            border: '1px solid rgba(0, 240, 255, 0.4)',
            padding: 28,
            gap: 16
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <Lock size={20} color="#00f0ff" />
              <h2 style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>
                Researcher Admin Portal
              </h2>
            </div>
            <button className="btn" onClick={onClose} style={{ padding: 5 }}>
              <X size={16} />
            </button>
          </div>

          <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Enter the researcher password to authenticate against AWS Lambda (<code>POST /admin/login</code>) and load encrypted study logs from S3 & DynamoDB.
          </p>

          <form onSubmit={handleLoginSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <input
              type="password"
              autoFocus
              value={passwordInput}
              onChange={(e) => setPasswordInput(e.target.value)}
              placeholder="Enter Admin Password"
              style={{
                padding: '10px 12px',
                borderRadius: 8,
                background: '#060a14',
                border: '1px solid rgba(0, 240, 255, 0.35)',
                color: '#fff',
                fontFamily: 'var(--font-mono)',
                fontSize: 14,
                outline: 'none'
              }}
            />

            {authError && (
              <div
                style={{
                  fontSize: 11.5,
                  color: '#fda4af',
                  background: 'rgba(244, 63, 94, 0.14)',
                  border: '1px solid rgba(244, 63, 94, 0.35)',
                  borderRadius: 8,
                  padding: '8px 10px'
                }}
              >
                {authError}
              </div>
            )}

            <button
              type="submit"
              className="btn btn-primary"
              disabled={isLoggingIn}
              style={{ padding: '10px 16px', fontSize: 13 }}
            >
              {isLoggingIn ? 'Verifying with AWS Lambda...' : 'Unlock Study Analytics Portal'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  const totalTrials = mergedSessions.reduce((acc, s) => acc + (s.trials?.length || 0), 0);
  const totalSurveys = mergedSessions.reduce((acc, s) => acc + (s.surveys?.length || 0), 0);

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

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 11000,
        background: '#050811',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden'
      }}
    >
      {/* Top Admin Header */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '12px 22px',
          background: '#0b1120',
          borderBottom: '1px solid rgba(255,255,255,0.09)',
          flexShrink: 0,
          gap: 12,
          flexWrap: 'wrap'
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Database size={22} color="#00f0ff" />
          <div>
            <div style={{ fontSize: 10.5, fontWeight: 800, color: '#00f0ff', letterSpacing: '0.09em' }}>
              KNU HCI ADAS LAB • AWS SERVERLESS TELEMETRY PORTAL (ap-northeast-2)
            </div>
            <h1 style={{ fontSize: 17, fontWeight: 800, color: '#fff' }}>
              Empirical Study Results & Statistical Workbench
            </h1>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              color: '#cbd5e1',
              background: 'rgba(255,255,255,0.04)',
              padding: '5px 10px',
              borderRadius: 8,
              border: '1px solid rgba(255,255,255,0.1)',
              cursor: 'pointer'
            }}
          >
            <input
              type="checkbox"
              checked={includeLocalFallback}
              onChange={(e) => setIncludeLocalFallback(e.target.checked)}
            />
            Merge Local Fallback Runs
          </label>

          <button
            className="btn"
            onClick={() => authPassword && fetchResults(authPassword)}
            disabled={isLoadingData}
          >
            <RefreshCw size={14} /> {isLoadingData ? 'Syncing...' : 'Refresh AWS'}
          </button>

          <button
            className="btn btn-primary"
            onClick={() =>
              triggerFileDownload(
                `aura_master_trials_${new Date().toISOString().slice(0, 10)}.csv`,
                exportAllToTrialsCsv(mergedSessions),
                'text/csv'
              )
            }
          >
            <Download size={14} /> Trials CSV
          </button>

          <button
            className="btn btn-accent"
            onClick={() =>
              triggerFileDownload(
                `aura_master_surveys_${new Date().toISOString().slice(0, 10)}.csv`,
                exportAllToSurveysCsv(mergedSessions),
                'text/csv'
              )
            }
          >
            <Download size={14} /> Surveys CSV
          </button>

          <button
            className="btn"
            onClick={() =>
              triggerFileDownload(
                `aura_master_bundle_${new Date().toISOString().slice(0, 10)}.json`,
                JSON.stringify(mergedSessions, null, 2),
                'application/json'
              )
            }
          >
            <FileCode2 size={14} /> Master JSON
          </button>

          <button className="btn" onClick={handleSignOut} title="Sign Out">
            <LogOut size={14} />
          </button>
          <button className="btn btn-danger" onClick={onClose} title="Close Admin Portal">
            <X size={14} />
          </button>
        </div>
      </header>

      {/* Sub-Nav Tabs */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '10px 22px',
          background: '#080c17',
          borderBottom: '1px solid rgba(255,255,255,0.06)',
          flexShrink: 0
        }}
      >
        <div style={{ display: 'flex', gap: 8 }}>
          {[
            { id: 'OVERVIEW', label: 'Overview & Visualizations', icon: BarChart3 },
            { id: 'STATS', label: 'Confusion Matrices & Paired Stats', icon: Activity },
            { id: 'SURVEYS', label: 'Progressive Survey Shifts', icon: Sliders },
            { id: 'SESSIONS', label: `Participant Sessions (${mergedSessions.length})`, icon: Table2 }
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                className={`btn ${active ? 'btn-primary' : ''}`}
                onClick={() => setActiveTab(tab.id as typeof activeTab)}
                style={{ fontSize: 12, padding: '6px 14px' }}
              >
                <Icon size={14} /> {tab.label}
              </button>
            );
          })}
        </div>

        <div style={{ fontSize: 11, fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
          {mergedSessions.length} Participants • {totalTrials} Trials • {totalSurveys} Survey Ratings
        </div>
      </div>

      {/* Main Scrollable Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '18px 22px', display: 'flex', flexDirection: 'column', gap: 18 }}>
        {dataError && (
          <div
            style={{
              background: 'rgba(244, 63, 94, 0.14)',
              border: '1px solid rgba(244, 63, 94, 0.4)',
              borderRadius: 10,
              padding: '10px 14px',
              fontSize: 12,
              color: '#fda4af'
            }}
          >
            AWS Fetch Warning: {dataError}
          </div>
        )}

        {/* Executive KPI Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, minmax(180px, 1fr))', gap: 12 }}>
          <div className="glass-panel">
            <div className="telemetry-label">Enrolled Participants</div>
            <div className="telemetry-value" style={{ fontSize: 24, color: '#fff' }}>
              {mergedSessions.length}
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              P1 Done: {mergedSessions.filter((s) => s.part1_completed).length} • P2 Done:{' '}
              {mergedSessions.filter((s) => s.part2_completed).length}
            </div>
          </div>

          <div className="glass-panel">
            <div className="telemetry-label">3D Spatial Accuracy</div>
            <div className="telemetry-value" style={{ fontSize: 24, color: '#00f0ff' }}>
              {spatialM.accuracyPct}%
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Mono {monoM.accuracyPct}% • Stereo {stereoM.accuracyPct}%
            </div>
          </div>

          <div className="glass-panel">
            <div className="telemetry-label">Front–Back Reversals</div>
            <div className="telemetry-value" style={{ fontSize: 24, color: '#10b981' }}>
              {spatialM.frontBackReversalPct}%
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              vs Stereo {stereoM.frontBackReversalPct}% • Mono {monoM.frontBackReversalPct}%
            </div>
          </div>

          <div className="glass-panel">
            <div className="telemetry-label">3D Spatial Reaction Time</div>
            <div className="telemetry-value" style={{ fontSize: 24, color: '#38bdf8' }}>
              {spatialM.meanRtMs} ms
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Median {spatialM.medianRtMs} ms (Stereo {stereoM.meanRtMs} ms)
            </div>
          </div>

          <div className="glass-panel">
            <div className="telemetry-label">Wasted Alarm Reduction</div>
            <div className="telemetry-value" style={{ fontSize: 24, color: '#a855f7' }}>
              -{alarmSavedPct}%
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
              Trad {tradM.meanAlarmDurationMs}ms → Gaze {gazeM.meanAlarmDurationMs}ms
            </div>
          </div>
        </div>

        {/* TAB 1: OVERVIEW CHARTS */}
        {activeTab === 'OVERVIEW' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Chart 1: Part 1 Accuracy & Reversal Rate */}
            <div className="glass-panel" style={{ padding: 18 }}>
              <div className="panel-header">
                <span className="panel-title">Part 1: Localization Accuracy vs. Front–Back Reversals (%)</span>
              </div>
              <svg viewBox="0 0 500 240" style={{ width: '100%', height: 230 }}>
                {[0, 25, 50, 75, 100].map((v) => {
                  const y = 195 - (v / 100) * 165;
                  return (
                    <g key={v}>
                      <line x1={48} x2={480} y1={y} y2={y} stroke="rgba(255,255,255,0.08)" />
                      <text x={38} y={y + 4} fill="#64748b" fontSize={10} textAnchor="end">
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
                      <text x={cx - 19} y={189 - accH} fill="#f8fafc" fontSize={10.5} fontWeight={700} textAnchor="middle">
                        {m.accuracyPct}%
                      </text>
                      <rect x={cx + 4} y={195 - fbH} width={30} height={fbH} rx={4} fill="#f43f5e" opacity={0.85} />
                      <text x={cx + 19} y={189 - fbH} fill="#fda4af" fontSize={10.5} fontWeight={700} textAnchor="middle">
                        {m.frontBackReversalPct}%
                      </text>
                      <text x={cx} y={216} fill="#cbd5e1" fontSize={11} fontWeight={700} textAnchor="middle">
                        {CONDITION_META[m.condition].shortLabel}
                      </text>
                    </g>
                  );
                })}
                <rect x={280} y={10} width={10} height={10} rx={2} fill="#00f0ff" />
                <text x={295} y={19} fill="#cbd5e1" fontSize={10}>Accuracy %</text>
                <rect x={375} y={10} width={10} height={10} rx={2} fill="#f43f5e" />
                <text x={390} y={19} fill="#cbd5e1" fontSize={10}>Front–Back Reversal %</text>
              </svg>
            </div>

            {/* Chart 2: Part 1 Reaction Time Mean vs Median */}
            <div className="glass-panel" style={{ padding: 18 }}>
              <div className="panel-header">
                <span className="panel-title">Part 1: Mean & Median Reaction Time (ms)</span>
              </div>
              {(() => {
                const maxRt = Math.max(
                  1500,
                  ...p1Metrics.map((m) => Math.max(m.meanRtMs, m.medianRtMs) * 1.15)
                );
                return (
                  <svg viewBox="0 0 500 240" style={{ width: '100%', height: 230 }}>
                    {[0, 0.25, 0.5, 0.75, 1].map((r) => {
                      const val = Math.round(r * maxRt);
                      const y = 195 - r * 165;
                      return (
                        <g key={r}>
                          <line x1={55} x2={480} y1={y} y2={y} stroke="rgba(255,255,255,0.08)" />
                          <text x={48} y={y + 4} fill="#64748b" fontSize={10} textAnchor="end">
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
                          <text x={cx - 19} y={189 - meanH} fill="#f8fafc" fontSize={10} fontWeight={700} textAnchor="middle">
                            {m.meanRtMs}
                          </text>
                          <rect x={cx + 4} y={195 - medH} width={30} height={medH} rx={4} fill="#a855f7" />
                          <text x={cx + 19} y={189 - medH} fill="#e9d5ff" fontSize={10} fontWeight={700} textAnchor="middle">
                            {m.medianRtMs}
                          </text>
                          <text x={cx} y={216} fill="#cbd5e1" fontSize={11} fontWeight={700} textAnchor="middle">
                            {CONDITION_META[m.condition].shortLabel}
                          </text>
                        </g>
                      );
                    })}
                    <rect x={300} y={10} width={10} height={10} rx={2} fill="#38bdf8" />
                    <text x={315} y={19} fill="#cbd5e1" fontSize={10}>Mean RT (ms)</text>
                    <rect x={395} y={10} width={10} height={10} rx={2} fill="#a855f7" />
                    <text x={410} y={19} fill="#cbd5e1" fontSize={10}>Median RT</text>
                  </svg>
                );
              })()}
            </div>

            {/* Chart 3: Part 2 Alarm Fatigue & Wasted Alarm Duration */}
            <div className="glass-panel" style={{ padding: 18, gridColumn: '1 / -1' }}>
              <div className="panel-header">
                <span className="panel-title">
                  Part 2: Alarm Fatigue & Wasted Post-Glance Blare Comparison (ms)
                </span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 20, alignItems: 'center' }}>
                <svg viewBox="0 0 600 175" style={{ width: '100%', height: 175 }}>
                  {[0, 1000, 2000, 3000, 3500].map((ms) => {
                    const x = 140 + (ms / 3800) * 430;
                    return (
                      <g key={ms}>
                        <line x1={x} x2={x} y1={24} y2={135} stroke="rgba(255,255,255,0.08)" />
                        <text x={x} y={152} fill="#64748b" fontSize={10} textAnchor="middle">
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
                        <text x={130} y={y + 19} fill="#e2e8f0" fontSize={12} fontWeight={700} textAnchor="end">
                          {CONDITION_META[m.condition].shortLabel}
                        </text>
                        <rect x={140} y={y} width={usefulW} height={28} rx={4} fill="#10b981" />
                        <rect x={140 + usefulW} y={y} width={wastedW} height={28} rx={4} fill="#f43f5e" />
                        <text
                          x={148 + usefulW + wastedW}
                          y={y + 18}
                          fill="#f8fafc"
                          fontSize={11}
                          fontWeight={700}
                        >
                          {m.meanAlarmDurationMs} ms ({m.meanBeepPulses} pulses)
                        </text>
                      </g>
                    );
                  })}
                  <rect x={140} y={4} width={10} height={10} rx={2} fill="#10b981" />
                  <text x={155} y={13} fill="#cbd5e1" fontSize={10}>Time until Mirror Check (Useful Alert)</text>
                  <rect x={360} y={4} width={10} height={10} rx={2} fill="#f43f5e" />
                  <text x={375} y={13} fill="#cbd5e1" fontSize={10}>Wasted Alarm Blare After Gaze</text>
                </svg>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="telemetry-item">
                    <div className="telemetry-label">Traditional Persistent Mean Alarm</div>
                    <div className="telemetry-value" style={{ color: '#f43f5e' }}>
                      {tradM.meanAlarmDurationMs} ms (Wasted: {tradM.meanWastedAlarmMs} ms)
                    </div>
                  </div>
                  <div className="telemetry-item">
                    <div className="telemetry-label">Gaze-Contingent 3D Mean Alarm</div>
                    <div className="telemetry-value" style={{ color: '#10b981' }}>
                      {gazeM.meanAlarmDurationMs} ms (0 ms wasted post-dwell)
                    </div>
                  </div>
                  <div className="telemetry-item">
                    <div className="telemetry-label">Mean Eyes-Off-Road Duration</div>
                    <div className="telemetry-value" style={{ color: '#38bdf8' }}>
                      Trad: {tradM.meanEyesOffRoadMs} ms • Gaze 3D: {gazeM.meanEyesOffRoadMs} ms
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: CONFUSION MATRICES & PAIRED STATISTICAL ANALYSIS */}
        {activeTab === 'STATS' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* 4x4 Confusion Matrices */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 14 }}>
              {part1Conditions.map((cond) => {
                const matrix = buildConfusionMatrix(mergedSessions, cond);
                const meta = CONDITION_META[cond];
                return (
                  <div key={cond} className="glass-panel" style={{ padding: 14 }}>
                    <div className="panel-header">
                      <span className="panel-title" style={{ color: meta.accentColor }}>
                        {meta.shortLabel} — 4×4 Confusion Matrix
                      </span>
                    </div>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11, fontFamily: 'var(--font-mono)' }}>
                      <thead>
                        <tr>
                          <th style={{ textAlign: 'left', padding: 5, color: '#64748b' }}>Tgt \ Resp</th>
                          {ZONES_ORDER.map((z) => (
                            <th key={z} style={{ padding: 5, color: '#94a3b8' }}>
                              {ZONE_SHORT[z]}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {ZONES_ORDER.map((target) => {
                          const row = matrix[target];
                          const rowSum = ZONES_ORDER.reduce((a, z) => a + row[z], 0) + row.TIMEOUT;
                          return (
                            <tr key={target}>
                              <td style={{ padding: 5, fontWeight: 700, color: '#cbd5e1' }}>
                                {ZONE_SHORT[target]}
                              </td>
                              {ZONES_ORDER.map((resp) => {
                                const count = row[resp];
                                const ratio = rowSum > 0 ? count / rowSum : 0;
                                const isDiag = target === resp;
                                const bg = isDiag
                                  ? `rgba(16, 185, 129, ${0.12 + ratio * 0.65})`
                                  : count > 0
                                  ? `rgba(244, 63, 94, ${0.14 + ratio * 0.65})`
                                  : 'rgba(255,255,255,0.02)';
                                return (
                                  <td
                                    key={resp}
                                    style={{
                                      padding: 6,
                                      textAlign: 'center',
                                      background: bg,
                                      border: '1px solid rgba(255,255,255,0.06)',
                                      color: count > 0 ? '#fff' : '#475569',
                                      fontWeight: isDiag ? 800 : 500
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
                );
              })}
            </div>

            {/* Paired Within-Subjects Statistical Table */}
            <div className="glass-panel" style={{ padding: 18 }}>
              <div className="panel-header">
                <span className="panel-title">
                  Within-Subjects Paired Statistical Comparisons (Student&apos;s Paired t-Test & Cohen&apos;s d)
                </span>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.12)', color: '#94a3b8', textAlign: 'left' }}>
                    <th style={{ padding: '8px 10px' }}>Hypothesis Comparison</th>
                    <th style={{ padding: '8px 10px' }}>n</th>
                    <th style={{ padding: '8px 10px' }}>Baseline Mean</th>
                    <th style={{ padding: '8px 10px' }}>Proposed Mean</th>
                    <th style={{ padding: '8px 10px' }}>Δ Change</th>
                    <th style={{ padding: '8px 10px' }}>t (df)</th>
                    <th style={{ padding: '8px 10px' }}>p-value</th>
                    <th style={{ padding: '8px 10px' }}>Cohen&apos;s d</th>
                  </tr>
                </thead>
                <tbody>
                  {pairedStats.map((row, idx) => {
                    const sig = row.n >= 2 && row.pValue < 0.05;
                    return (
                      <tr key={idx} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                        <td style={{ padding: '9px 10px', fontWeight: 600, color: '#f8fafc' }}>
                          {row.label}:{' '}
                          <span style={{ color: CONDITION_META[row.condA].accentColor }}>
                            {CONDITION_META[row.condA].shortLabel}
                          </span>{' '}
                          vs{' '}
                          <span style={{ color: CONDITION_META[row.condB].accentColor }}>
                            {CONDITION_META[row.condB].shortLabel}
                          </span>
                        </td>
                        <td style={{ padding: '9px 10px', fontFamily: 'var(--font-mono)' }}>{row.n}</td>
                        <td style={{ padding: '9px 10px', fontFamily: 'var(--font-mono)' }}>{row.meanA}</td>
                        <td style={{ padding: '9px 10px', fontFamily: 'var(--font-mono)', fontWeight: 700, color: '#00f0ff' }}>
                          {row.meanB}
                        </td>
                        <td style={{ padding: '9px 10px', fontFamily: 'var(--font-mono)' }}>
                          {row.diff > 0 ? `+${row.diff}` : row.diff}
                        </td>
                        <td style={{ padding: '9px 10px', fontFamily: 'var(--font-mono)' }}>
                          {row.n >= 2 ? `${row.tStat} (${row.df})` : '—'}
                        </td>
                        <td
                          style={{
                            padding: '9px 10px',
                            fontFamily: 'var(--font-mono)',
                            fontWeight: 700,
                            color: sig ? '#34d399' : '#94a3b8'
                          }}
                        >
                          {row.n >= 2 ? (row.pValue < 0.001 ? '< 0.001 ***' : `${row.pValue}${sig ? ' *' : ''}`) : 'Need n≥2'}
                        </td>
                        <td style={{ padding: '9px 10px', fontFamily: 'var(--font-mono)' }}>
                          {row.n >= 2 ? row.cohensD : '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: PROGRESSIVE SURVEYS */}
        {activeTab === 'SURVEYS' && (
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {[
              { title: 'Part 1 Survey Means (Initial → Final Recalibrated)', conds: part1Conditions as StudyConditionType[], data: p1SurveyAgg },
              { title: 'Part 2 Survey Means (Initial → Final Recalibrated)', conds: part2Conditions as StudyConditionType[], data: p2SurveyAgg }
            ].map((block) => (
              <div key={block.title} className="glass-panel" style={{ padding: 18 }}>
                <div className="panel-header">
                  <span className="panel-title">{block.title}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  {block.data.map((q) => (
                    <div
                      key={q.questionId}
                      style={{
                        background: 'rgba(255,255,255,0.03)',
                        border: '1px solid rgba(255,255,255,0.06)',
                        borderRadius: 10,
                        padding: 12
                      }}
                    >
                      <div style={{ fontSize: 10, fontWeight: 800, color: '#38bdf8' }}>
                        {q.category} ({q.lowerIsBetter ? 'Lower is better' : 'Higher is better'})
                      </div>
                      <div style={{ fontSize: 12.5, fontWeight: 600, color: '#fff', margin: '3px 0 8px 0' }}>
                        {q.prompt}
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {block.conds.map((c) => {
                          const stat = q.byCondition[c];
                          const meta = CONDITION_META[c];
                          const pct = Math.min(100, (stat.finalMean / 10) * 100);
                          return (
                            <div key={c} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 11 }}>
                              <span style={{ width: 125, color: meta.accentColor, fontWeight: 700 }}>
                                {meta.shortLabel}
                              </span>
                              <div
                                style={{
                                  flex: 1,
                                  height: 8,
                                  background: 'rgba(255,255,255,0.08)',
                                  borderRadius: 999,
                                  overflow: 'hidden'
                                }}
                              >
                                <div style={{ width: `${pct}%`, height: '100%', background: meta.accentColor }} />
                              </div>
                              <span style={{ width: 145, fontFamily: 'var(--font-mono)', textAlign: 'right', color: '#e2e8f0' }}>
                                {stat.finalMean.toFixed(1)} (init {stat.initialMean.toFixed(1)}, Δ{' '}
                                {stat.meanDelta >= 0 ? `+${stat.meanDelta.toFixed(1)}` : stat.meanDelta.toFixed(1)})
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
          <div className="glass-panel" style={{ padding: 18 }}>
            <div className="panel-header">
              <span className="panel-title">All Recorded Participant Sessions</span>
            </div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid rgba(255,255,255,0.12)', color: '#94a3b8', textAlign: 'left' }}>
                  <th style={{ padding: '8px 10px' }}>Participant</th>
                  <th style={{ padding: '8px 10px' }}>Source</th>
                  <th style={{ padding: '8px 10px' }}>Part 1</th>
                  <th style={{ padding: '8px 10px' }}>Part 2</th>
                  <th style={{ padding: '8px 10px' }}>Trials</th>
                  <th style={{ padding: '8px 10px' }}>Webcam / CV Health</th>
                  <th style={{ padding: '8px 10px' }}>Updated</th>
                  <th style={{ padding: '8px 10px' }}>Inspect / S3</th>
                </tr>
              </thead>
              <tbody>
                {mergedSessions.length === 0 && (
                  <tr>
                    <td colSpan={8} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                      No sessions found yet. Run a study at <code>?study=KNU2026&amp;pid=P_01</code>.
                    </td>
                  </tr>
                )}
                {mergedSessions.map((s) => {
                  const fps = s.hardware_info?.webcam_fps_avg ?? 0;
                  const mode = s.hardware_info?.input_mode || 'UNKNOWN';
                  const healthy = mode === 'SIMULATION_FALLBACK' || fps >= STUDY_PARAMETERS.minRequiredWebcamFps;
                  return (
                    <tr key={s.participant_id} style={{ borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                      <td style={{ padding: '9px 10px', fontFamily: 'var(--font-mono)', fontWeight: 800, color: '#00f0ff' }}>
                        {s.participant_id}
                      </td>
                      <td style={{ padding: '9px 10px', fontSize: 11 }}>
                        <span
                          style={{
                            padding: '2px 7px',
                            borderRadius: 6,
                            background:
                              s.source === 'LOCAL_BROWSER'
                                ? 'rgba(245, 158, 11, 0.16)'
                                : 'rgba(16, 185, 129, 0.16)',
                            color: s.source === 'LOCAL_BROWSER' ? '#fbbf24' : '#34d399',
                            fontWeight: 700
                          }}
                        >
                          {s.source === 'LOCAL_BROWSER' ? 'LOCAL' : 'AWS S3'}
                        </span>
                      </td>
                      <td style={{ padding: '9px 10px' }}>
                        {s.part1_completed ? (
                          <span style={{ color: '#34d399', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <CheckCircle2 size={13} /> Done
                          </span>
                        ) : (
                          <span style={{ color: '#fbbf24' }}>Partial</span>
                        )}
                      </td>
                      <td style={{ padding: '9px 10px' }}>
                        {s.part2_completed ? (
                          <span style={{ color: '#34d399', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                            <CheckCircle2 size={13} /> Done
                          </span>
                        ) : (
                          <span style={{ color: '#94a3b8' }}>Pending</span>
                        )}
                      </td>
                      <td style={{ padding: '9px 10px', fontFamily: 'var(--font-mono)' }}>
                        {s.trials?.length || 0}
                      </td>
                      <td style={{ padding: '9px 10px', fontSize: 11 }}>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 5,
                            color: healthy ? '#34d399' : '#fb7185'
                          }}
                        >
                          {healthy ? <Eye size={13} /> : <ShieldAlert size={13} />}
                          {mode === 'SIMULATION_FALLBACK'
                            ? 'Sim Fallback'
                            : `${fps} FPS (${Math.round((s.hardware_info?.cv_confidence_avg || 0) * 100)}%)`}
                        </span>
                      </td>
                      <td style={{ padding: '9px 10px', fontSize: 11, color: 'var(--text-muted)' }}>
                        {s.updated_at ? new Date(s.updated_at).toLocaleString() : '—'}
                      </td>
                      <td style={{ padding: '9px 10px', display: 'flex', gap: 6 }}>
                        <button
                          className="btn"
                          style={{ fontSize: 11, padding: '4px 8px' }}
                          onClick={() => setInspectedSession(s)}
                        >
                          <FileCode2 size={12} /> JSON
                        </button>
                        {s.presigned_url && (
                          <a
                            href={s.presigned_url}
                            target="_blank"
                            rel="noreferrer"
                            className="btn"
                            style={{ fontSize: 11, padding: '4px 8px', textDecoration: 'none' }}
                          >
                            <ExternalLink size={12} /> S3
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Raw JSON Inspector Modal */}
      {inspectedSession && (
        <div className="modal-overlay" style={{ zIndex: 11500 }}>
          <div className="modal-content" style={{ maxWidth: 820, maxHeight: '85vh' }}>
            <div className="modal-header">
              <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>
                Raw Telemetry Inspector — {inspectedSession.participant_id}
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  className="btn btn-primary"
                  style={{ fontSize: 11, padding: '5px 10px' }}
                  onClick={() =>
                    triggerFileDownload(
                      `aura_${inspectedSession.participant_id}.json`,
                      JSON.stringify(inspectedSession, null, 2),
                      'application/json'
                    )
                  }
                >
                  <Download size={13} /> Download JSON
                </button>
                <button className="btn" onClick={() => setInspectedSession(null)} style={{ padding: 5 }}>
                  <X size={16} />
                </button>
              </div>
            </div>
            <div className="modal-body">
              <pre
                style={{
                  fontSize: 11,
                  fontFamily: 'var(--font-mono)',
                  color: '#a5f3fc',
                  background: '#050811',
                  padding: 14,
                  borderRadius: 8,
                  overflow: 'auto',
                  maxHeight: '62vh',
                  lineHeight: 1.45
                }}
              >
                {JSON.stringify(inspectedSession, null, 2)}
              </pre>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
