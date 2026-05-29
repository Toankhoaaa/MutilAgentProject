import Head from "next/head";
import { useState, useCallback } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import Layout from "@/components/Layout";
import StatCard from "@/components/StatCard";
import EmailTable from "@/components/EmailTable";
import CategoryChart from "@/components/CategoryChart";
import DraftModal from "@/components/DraftModal";
import EmailDetailSheet from "@/components/EmailDetailSheet";
import AgentStatusBadge from "@/components/AgentStatusBadge";
import NotificationToast from "@/components/NotificationToast";
import api from "@/lib/axios";
import type {
  UserProfile,
  OverviewStats,
  CategoryDistribution,
  AgentStatus,
  Email,
  PaginatedResponse,
  ProcessEmailsResult,
  SchedulerStatus,
} from "@/lib/types";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

// ---------- Icons ----------
const MailsIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M3 19v-8.93a2 2 0 01.89-1.664l7-4.666a2 2 0 012.22 0l7 4.666A2 2 0 0121 10.07V19M3 19a2 2 0 002 2h14a2 2 0 002-2M3 19l6.75-4.5M21 19l-6.75-4.5M3 10l6.75 4.5M21 10l-6.75 4.5m0 0l-1.14.76a2 2 0 01-2.22 0L9.75 14.5" />
  </svg>
);

const UrgentIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
  </svg>
);

const DraftIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

const ClockIcon = () => (
  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
  </svg>
);

// ---------- Page ----------
export default function DashboardPage() {
  const router = useRouter();
  const [emailOffset, setEmailOffset] = useState(0);
  const [emailCategory, setEmailCategory] = useState("all");
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [detailEmail, setDetailEmail] = useState<Email | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<ProcessEmailsResult | null>(null);

  // All hooks must be called unconditionally before any early returns.

  // Auth check — redirect to login on 401
  const { data: user, error: authError } = useSWR<UserProfile>("/auth/me", fetcher, {
    onError: () => router.replace("/login"),
    revalidateOnFocus: false,
  });

  const { data: stats, isLoading: statsLoading, mutate: mutateStats } =
    useSWR<OverviewStats>("/stats/overview", fetcher, { refreshInterval: 30_000 });

  const { data: categoryDist, isLoading: catLoading } =
    useSWR<CategoryDistribution>("/stats/category-distribution", fetcher, { refreshInterval: 30_000 });

  // Agent status polls every 5 s for real-time feel
  const { data: agentStatus, isLoading: agentLoading } =
    useSWR<AgentStatus>("/agents/status", fetcher, { refreshInterval: 5_000 });

  const { data: schedulerStatus, isLoading: schedulerLoading, mutate: mutateScheduler } =
    useSWR<SchedulerStatus>("/scheduler/status", fetcher, { refreshInterval: 10_000 });

  const emailParams = `/emails/?limit=20&offset=${emailOffset}&category=${emailCategory}`;
  const { data: emailData, isLoading: emailsLoading, mutate: mutateEmails } =
    useSWR<PaginatedResponse<Email>>(emailParams, fetcher);

  const handleFilterChange = useCallback((cat: string) => {
    setEmailCategory(cat);
    setEmailOffset(0);
  }, []);

  const handleRefresh = useCallback(() => {
    mutateEmails();
    mutateStats();
  }, [mutateEmails, mutateStats]);

  // Guard after all hooks: redirect already triggered via onError above
  if (authError) return null;

  const handleRunNow = async () => {
    try {
      await api.post("/scheduler/run-now");
      mutateScheduler();
      handleRefresh();
    } catch {
      // silently ignore — status badge shows the result
    }
  };

  const handleToggleScheduler = async () => {
    if (!schedulerStatus) return;
    try {
      if (schedulerStatus.is_running) {
        await api.post("/scheduler/stop");
      } else {
        await api.post("/scheduler/start");
      }
      mutateScheduler();
    } catch {
      // silently ignore
    }
  };

  const handleProcessEmails = async () => {
    setProcessing(true);
    setProcessResult(null);
    try {
      const res = await api.post<ProcessEmailsResult>("/emails/process");
      setProcessResult(res.data);
      handleRefresh();
    } catch {
      // Error shown via processResult null state
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <Head>
        <title>Dashboard — Email Orchestrator</title>
      </Head>

      <Layout user={user ?? null}>
        {/* Page header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6">
          <div className="flex items-center gap-3 flex-wrap">
            <AgentStatusBadge status={agentStatus} loading={agentLoading} />
          </div>

          <div className="flex items-center gap-2">
            {processResult && (
              <span className="text-xs text-emerald-600 bg-emerald-50 border border-emerald-100 px-3 py-1.5 rounded-full">
                Fetched {processResult.fetched}, processed {processResult.processed}, {processResult.drafts_created} draft(s)
              </span>
            )}
            <button
              onClick={handleProcessEmails}
              disabled={processing || agentStatus?.system_status === "running"}
              className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processing ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Processing…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Process Emails
                </>
              )}
            </button>
          </div>
        </div>

        {/* Stats grid */}
        <div className="stats-grid mb-6">
          <StatCard
            label="Emails Processed"
            value={stats?.total_processed ?? 0}
            color="indigo"
            icon={<MailsIcon />}
            loading={statsLoading}
          />
          <StatCard
            label="Urgent"
            value={stats?.urgent_count ?? 0}
            subtitle="Need immediate attention"
            color="rose"
            icon={<UrgentIcon />}
            loading={statsLoading}
          />
          <StatCard
            label="AI Drafts Created"
            value={stats?.drafts_created ?? 0}
            color="emerald"
            icon={<DraftIcon />}
            loading={statsLoading}
          />
          <StatCard
            label="Time Saved"
            value={`${stats?.time_saved_minutes ?? 0} min`}
            subtitle="Estimated vs. manual replies"
            color="amber"
            icon={<ClockIcon />}
            loading={statsLoading}
          />
        </div>

        {/* Main content: table + chart */}
        <div className="content-grid" id="analytics">
          {/* Email table — takes more space */}
          <div className="col-span-1 lg:col-span-2">
            <EmailTable
              emails={emailData?.items ?? []}
              total={emailData?.total ?? 0}
              limit={emailData?.limit ?? 20}
              offset={emailOffset}
              loading={emailsLoading}
              category={emailCategory}
              onPageChange={setEmailOffset}
              onFilterChange={handleFilterChange}
              onOpenDraft={setSelectedEmail}
              onViewDetail={setDetailEmail}
              onRefresh={handleRefresh}
            />
          </div>

          {/* Sidebar: category chart + scheduler + agent run */}
          <div className="card" id="agents">
            <h2 className="text-base font-semibold text-slate-800 mb-4">Category Distribution</h2>
            <CategoryChart
              items={categoryDist?.items ?? []}
              loading={catLoading}
            />

            {/* Scheduler panel */}
            <div className="mt-6 pt-4 border-t border-slate-100">
              <div className="flex items-center justify-between mb-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                  Auto Scheduler
                </p>
                {schedulerStatus && (
                  <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full
                    ${schedulerStatus.is_running
                      ? "bg-emerald-50 text-emerald-700"
                      : "bg-slate-100 text-slate-500"}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${schedulerStatus.is_running ? "bg-emerald-500 animate-pulse" : "bg-slate-400"}`} />
                    {schedulerStatus.is_running ? "Active" : "Stopped"}
                  </span>
                )}
              </div>

              {schedulerStatus && (
                <div className="space-y-1 mb-3">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-400">Interval</span>
                    <span className="text-slate-700 font-medium">
                      {schedulerStatus.interval_minutes} min
                    </span>
                  </div>
                  {schedulerStatus.next_run_at && (
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Next run</span>
                      <span className="text-slate-700 font-medium">
                        {new Date(schedulerStatus.next_run_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  )}
                  {schedulerStatus.last_run_at && (
                    <div className="flex justify-between text-xs">
                      <span className="text-slate-400">Last run</span>
                      <span className="text-slate-700 font-medium">
                        {new Date(schedulerStatus.last_run_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="flex gap-2">
                <button
                  onClick={handleRunNow}
                  className="btn-secondary text-xs py-1 px-2 flex-1"
                  title="Trigger one processing run immediately"
                >
                  Run Now
                </button>
                <button
                  onClick={handleToggleScheduler}
                  disabled={schedulerLoading}
                  className={`btn-secondary text-xs py-1 px-2 flex-1 ${schedulerStatus?.is_running ? "text-rose-600 hover:border-rose-300" : "text-emerald-600 hover:border-emerald-300"}`}
                >
                  {schedulerStatus?.is_running ? "Stop" : "Start"}
                </button>
              </div>
            </div>

            {/* Agent last run info */}
            {agentStatus?.latest_run && (
              <div className="mt-4 pt-4 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-3">
                  Last Agent Run
                </p>
                <div className="space-y-1.5">
                  {[
                    ["Status", agentStatus.latest_run.status ?? "—"],
                    ["Emails", String(agentStatus.latest_run.total_emails_processed ?? "—")],
                    ["LLM calls", String(agentStatus.latest_run.llm_calls_count ?? "—")],
                    ["Duration", agentStatus.latest_run.total_time_ms
                      ? `${(agentStatus.latest_run.total_time_ms / 1000).toFixed(1)}s`
                      : "—"],
                  ].map(([k, v]) => (
                    <div key={k} className="flex justify-between text-xs">
                      <span className="text-slate-400">{k}</span>
                      <span className="text-slate-700 font-medium">{v}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </Layout>

      {/* Email detail slide-over */}
      <EmailDetailSheet
        email={detailEmail}
        onClose={() => setDetailEmail(null)}
      />

      {/* Draft modal */}
      <DraftModal
        email={selectedEmail}
        onClose={() => setSelectedEmail(null)}
        onSent={handleRefresh}
      />

      {/* Real-time urgent email notifications */}
      <NotificationToast />
    </>
  );
}
