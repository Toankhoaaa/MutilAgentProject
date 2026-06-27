import Head from "next/head";
import { useEffect, useState } from "react";
import useSWR from "swr";
import Layout from "@/components/Layout";
import StatCard from "@/components/StatCard";
import CategoryChart from "@/components/CategoryChart";
import api from "@/lib/axios";
import { useAuthGuard } from "@/hooks/useAuthGuard";
import type {
  AdminUserStats,
  AgentRunDetail,
  CategoryDistribution,
  OverviewStats,
  SchedulerStatus,
} from "@/lib/types";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

// ── Icons ─────────────────────────────────────────────────────────────────────

const UsersIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
  </svg>
);
const CheckCircleIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
const BanIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
  </svg>
);
const StarIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
  </svg>
);
const MailIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
  </svg>
);
const BotIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17H3a2 2 0 01-2-2V5a2 2 0 012-2h16a2 2 0 012 2v10a2 2 0 01-2 2h-2M12 3v4m0 0l-2-2m2 2l2-2" />
  </svg>
);
const ClockIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);
const BroadcastIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M11 5.882V19.24a1.76 1.76 0 01-3.417.592l-2.147-6.15M18 13a3 3 0 100-6M5.436 13.683A4.001 4.001 0 017 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 01-1.564-.317z" />
  </svg>
);

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(ms: number | null): string {
  if (ms == null) return "—";
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}

function relativeTime(iso: string | null): string {
  if (!iso) return "—";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function formatTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

const RUN_STATUS_STYLE: Record<string, string> = {
  COMPLETED: "bg-emerald-50 text-emerald-700",
  RUNNING:   "bg-blue-50 text-blue-600",
  FAILED:    "bg-rose-50 text-rose-600",
};

// ── Sub-components ────────────────────────────────────────────────────────────

function KpiTile({
  icon,
  label,
  value,
  loading,
  accentColor,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  loading?: boolean;
  accentColor: string;
}) {
  return (
    <div className="flex items-center gap-3 p-4 rounded-xl border border-slate-100 bg-white"
      style={{ boxShadow: "0 1px 4px rgba(0,0,0,0.05)" }}>
      <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
        style={{ background: accentColor + "18", color: accentColor }}>
        {icon}
      </div>
      <div>
        <p className="text-xs text-slate-400 font-medium">{label}</p>
        {loading ? (
          <div className="h-5 w-16 bg-slate-100 rounded animate-pulse mt-1" />
        ) : (
          <p className="text-lg font-bold text-slate-800 leading-tight">{value}</p>
        )}
      </div>
    </div>
  );
}

function RunStatusBadge({ status }: { status: string | null }) {
  const s = (status ?? "UNKNOWN").toUpperCase();
  const style = RUN_STATUS_STYLE[s] ?? "bg-slate-100 text-slate-500";
  return (
    <span className={`inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full ${style}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${
        s === "COMPLETED" ? "bg-emerald-500" :
        s === "RUNNING"   ? "bg-blue-500 animate-pulse" :
        s === "FAILED"    ? "bg-rose-500" : "bg-slate-400"
      }`} />
      {s.charAt(0) + s.slice(1).toLowerCase()}
    </span>
  );
}

function RunsTableSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="h-10 bg-slate-50 rounded animate-pulse" />
      ))}
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminOverviewPage() {
  const { user, isLoading: authLoading } = useAuthGuard(true);

  const { data: userStats, isLoading: userStatsLoading } =
    useSWR<AdminUserStats>("/admin/users/stats", fetcher, { refreshInterval: 30_000 });

  const { data: emailStats, isLoading: emailStatsLoading } =
    useSWR<OverviewStats>("/stats/overview", fetcher, { refreshInterval: 30_000 });

  const { data: categoryDist, isLoading: catLoading } =
    useSWR<CategoryDistribution>("/stats/category-distribution", fetcher, { refreshInterval: 30_000 });

  const { data: recentRuns, isLoading: runsLoading } =
    useSWR<AgentRunDetail[]>("/agents/runs?limit=10", fetcher, { refreshInterval: 15_000 });

  const { data: schedulerStatus, isLoading: schedulerLoading, mutate: mutateScheduler } =
    useSWR<SchedulerStatus>("/scheduler/status", fetcher, { refreshInterval: 10_000 });

  // Scheduler interval state
  const [intervalInput, setIntervalInput] = useState(5);
  const [savingInterval, setSavingInterval] = useState(false);
  const [intervalSaved, setIntervalSaved] = useState(false);

  // Broadcast state
  const [broadcastMsg, setBroadcastMsg] = useState("");
  const [broadcasting, setBroadcasting] = useState(false);
  const [broadcastFeedback, setBroadcastFeedback] = useState<"idle" | "success" | "error">("idle");

  useEffect(() => {
    if (schedulerStatus && !savingInterval) {
      setIntervalInput(schedulerStatus.interval_minutes);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedulerStatus?.interval_minutes]);

  if (authLoading || !user) return null;

  // ── Handlers ──────────────────────────────────────────────────────────────

  const handleRunNow = async () => {
    try {
      await api.post("/scheduler/run-now");
      mutateScheduler();
    } catch { /* ignore */ }
  };

  const handleSaveInterval = async () => {
    if (intervalInput < 1 || intervalInput > 1440) return;
    setSavingInterval(true);
    try {
      await api.put("/scheduler/config", { interval_minutes: intervalInput });
      mutateScheduler();
      setIntervalSaved(true);
      setTimeout(() => setIntervalSaved(false), 2000);
    } catch { /* ignore */ }
    setSavingInterval(false);
  };

  const handleBroadcast = async () => {
    if (!broadcastMsg.trim()) return;
    setBroadcasting(true);
    setBroadcastFeedback("idle");
    try {
      await api.post("/admin/broadcast", { message: broadcastMsg.trim() });
      setBroadcastFeedback("success");
      setBroadcastMsg("");
      setTimeout(() => setBroadcastFeedback("idle"), 3000);
    } catch {
      setBroadcastFeedback("error");
      setTimeout(() => setBroadcastFeedback("idle"), 3000);
    }
    setBroadcasting(false);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <>
      <Head>
        <title>Admin Overview — Email Orchestrator</title>
      </Head>

      <Layout user={user ?? null}>
        {/* Page header */}
        <div className="flex items-center justify-between mb-7">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Admin Control Room</h1>
            <p className="text-sm text-zinc-400 mt-0.5">Platform telemetry, scheduler controls, and system broadcasts</p>
          </div>
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-full bg-violet-50 text-violet-700 border border-violet-100">
            <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            Admin
          </span>
        </div>

        {/* ── User Stats Grid ── */}
        <div className="stats-grid mb-6">
          <StatCard
            label="Total Users"
            value={userStats?.total ?? 0}
            color="indigo"
            icon={<UsersIcon />}
            loading={userStatsLoading}
          />
          <StatCard
            label="Active Users"
            value={userStats?.active ?? 0}
            subtitle="is_active = true"
            color="emerald"
            icon={<CheckCircleIcon />}
            loading={userStatsLoading}
          />
          <StatCard
            label="Suspended"
            value={userStats?.suspended ?? 0}
            subtitle="Deactivated accounts"
            color="rose"
            icon={<BanIcon />}
            loading={userStatsLoading}
          />
          <StatCard
            label="Premium Tier"
            value={userStats?.premium ?? 0}
            subtitle="PRO + ENTERPRISE"
            color="amber"
            icon={<StarIcon />}
            loading={userStatsLoading}
          />
        </div>

        {/* ── Bottom two-panel split ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

          {/* ── Left panel (telemetry) ── */}
          <div className="lg:col-span-2 space-y-4">

            {/* Email KPI strip */}
            <div className="grid grid-cols-3 gap-3">
              <KpiTile
                icon={<MailIcon />}
                label="Emails Processed"
                value={emailStats?.total_processed ?? 0}
                loading={emailStatsLoading}
                accentColor="#6366F1"
              />
              <KpiTile
                icon={<BotIcon />}
                label="Total LLM Calls"
                value={
                  recentRuns
                    ? recentRuns.reduce((s, r) => s + (r.llm_calls_count ?? 0), 0)
                    : "—"
                }
                loading={runsLoading}
                accentColor="#8B5CF6"
              />
              <KpiTile
                icon={<ClockIcon />}
                label="Time Saved (min)"
                value={emailStats?.time_saved_minutes ?? 0}
                loading={emailStatsLoading}
                accentColor="#10B981"
              />
            </div>

            {/* Category distribution chart */}
            <div className="card">
              <h2 className="text-sm font-semibold text-zinc-700 mb-4">Email Category Distribution</h2>
              <CategoryChart items={categoryDist?.items ?? []} loading={catLoading} />
            </div>

            {/* Recent agent runs table */}
            <div className="card">
              <h2 className="text-sm font-semibold text-zinc-700 mb-4">Recent Agent Batch Runs</h2>
              {runsLoading ? (
                <RunsTableSkeleton />
              ) : !recentRuns || recentRuns.length === 0 ? (
                <p className="text-sm text-slate-400 text-center py-6">No batch runs recorded yet.</p>
              ) : (
                <div className="overflow-x-auto -mx-1.5">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100">
                        <th className="text-left pb-2.5 px-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Status</th>
                        <th className="text-left pb-2.5 px-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Type</th>
                        <th className="text-right pb-2.5 px-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Emails</th>
                        <th className="text-right pb-2.5 px-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Duration</th>
                        <th className="text-right pb-2.5 px-1.5 text-xs font-semibold text-slate-400 uppercase tracking-wide">Started</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-50">
                      {recentRuns.map((run) => (
                        <tr key={run.id} className="hover:bg-slate-50/60 transition-colors">
                          <td className="py-2.5 px-1.5">
                            <RunStatusBadge status={run.status} />
                          </td>
                          <td className="py-2.5 px-1.5 text-slate-600 font-medium capitalize">
                            {run.run_type ?? "batch"}
                          </td>
                          <td className="py-2.5 px-1.5 text-right text-slate-700 font-semibold tabular-nums">
                            {run.total_emails_processed ?? 0}
                          </td>
                          <td className="py-2.5 px-1.5 text-right text-slate-500 tabular-nums">
                            {formatDuration(run.total_time_ms)}
                          </td>
                          <td className="py-2.5 px-1.5 text-right text-slate-400 text-xs">
                            {relativeTime(run.started_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* ── Right panel (controls) ── */}
          <div className="space-y-4">

            {/* Scheduler control card */}
            <div className="card">
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-zinc-700">Automation Scheduler</h2>
                {schedulerStatus ? (
                  <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
                    schedulerStatus.is_running
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-zinc-100 text-zinc-500"
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${
                      schedulerStatus.is_running ? "bg-emerald-500 animate-pulse" : "bg-zinc-400"
                    }`} />
                    {schedulerStatus.is_running ? "Running" : "Stopped"}
                  </span>
                ) : (
                  <div className="h-6 w-16 bg-slate-100 rounded-full animate-pulse" />
                )}
              </div>

              {/* Timing indicators */}
              {schedulerStatus ? (
                <div className="space-y-2 mb-4">
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Last evaluated</span>
                    <span className="text-slate-700 font-medium tabular-nums">
                      {schedulerStatus.last_run_at
                        ? formatTime(schedulerStatus.last_run_at)
                        : "Never"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center text-xs">
                    <span className="text-slate-400">Next automated run</span>
                    <span className="text-slate-700 font-medium tabular-nums">
                      {schedulerStatus.next_run_at
                        ? formatTime(schedulerStatus.next_run_at)
                        : "—"}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="space-y-2 mb-4">
                  {[1, 2].map((i) => (
                    <div key={i} className="h-3.5 bg-slate-100 rounded animate-pulse" />
                  ))}
                </div>
              )}

              {/* Interval input */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-slate-500 mb-1.5">
                  Polling cycle interval (minutes)
                </label>
                <div className="flex gap-2">
                  <input
                    type="number"
                    min={1}
                    max={1440}
                    value={intervalInput}
                    onChange={(e) => setIntervalInput(Number(e.target.value))}
                    className="flex-1 text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 focus:outline-none focus:ring-2 focus:ring-violet-200 focus:border-violet-400 transition"
                  />
                  <button
                    onClick={handleSaveInterval}
                    disabled={savingInterval || intervalInput === schedulerStatus?.interval_minutes}
                    className="btn-secondary text-xs py-1.5 px-3 disabled:opacity-40"
                  >
                    {intervalSaved ? "✓ Saved" : savingInterval ? "…" : "Save"}
                  </button>
                </div>
              </div>

              {/* Action buttons */}
              <div className="grid grid-cols-3 gap-2">
                <button
                  onClick={handleRunNow}
                  disabled={schedulerLoading}
                  className="btn-secondary text-xs py-2 disabled:opacity-50 flex flex-col items-center gap-0.5"
                  title="Trigger one processing run immediately"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  Run Now
                </button>
                <button
                  onClick={() => api.post("/scheduler/start").then(() => mutateScheduler())}
                  disabled={schedulerStatus?.is_running}
                  className="btn-secondary text-xs py-2 text-emerald-600 hover:border-emerald-300 disabled:opacity-40 flex flex-col items-center gap-0.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Start
                </button>
                <button
                  onClick={() => api.post("/scheduler/stop").then(() => mutateScheduler())}
                  disabled={!schedulerStatus?.is_running}
                  className="btn-secondary text-xs py-2 text-rose-600 hover:border-rose-300 disabled:opacity-40 flex flex-col items-center gap-0.5"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 10h6v4H9z" />
                  </svg>
                  Stop
                </button>
              </div>
            </div>

            {/* System broadcast card */}
            <div className="card">
              <div className="flex items-center gap-2 mb-4">
                <div className="w-7 h-7 rounded-lg bg-orange-50 text-orange-500 flex items-center justify-center">
                  <BroadcastIcon />
                </div>
                <h2 className="text-sm font-semibold text-zinc-700">System Announcement</h2>
              </div>

              <p className="text-xs text-slate-400 mb-3 leading-relaxed">
                Broadcast an immediate alert to all currently connected users via WebSocket.
              </p>

              <textarea
                rows={4}
                value={broadcastMsg}
                onChange={(e) => setBroadcastMsg(e.target.value)}
                placeholder="e.g. Scheduled maintenance begins in 10 minutes. Please save your work."
                className="w-full text-sm border border-slate-200 rounded-lg px-3 py-2.5 text-slate-700 placeholder:text-slate-300 focus:outline-none focus:ring-2 focus:ring-orange-200 focus:border-orange-400 resize-none transition"
              />

              {broadcastFeedback === "success" && (
                <p className="text-xs text-emerald-600 font-medium mt-2 flex items-center gap-1">
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Announcement broadcast to all connected users.
                </p>
              )}
              {broadcastFeedback === "error" && (
                <p className="text-xs text-rose-600 font-medium mt-2">
                  Failed to broadcast. Please try again.
                </p>
              )}

              <button
                onClick={handleBroadcast}
                disabled={broadcasting || !broadcastMsg.trim()}
                className="mt-3 w-full btn-primary justify-center disabled:opacity-40"
                style={{ background: broadcasting ? "#9CA3AF" : "linear-gradient(135deg, #F97316 0%, #EF4444 100%)" }}
              >
                {broadcasting ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Sending…
                  </>
                ) : (
                  <>
                    📣 Broadcast Announcement
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </Layout>
    </>
  );
}
