import Head from "next/head";
import { useState } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import Layout from "@/components/Layout";
import api from "@/lib/axios";
import type { AuditLogEntry, PaginatedResponse, UserProfile } from "@/lib/types";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const LIMIT = 20;

const AGENTS = ["ClassifierAgent", "SecurityAgent", "ResponseAgent", "SchedulingAgent"] as const;
const ACTIONS = ["classify", "generate_draft", "analyze", "detect_threat"] as const;
const STATUSES = ["success", "failed"] as const;

// ── Helpers ───────────────────────────────────────────────────────────────────

function buildUrl(
  agentFilter: string,
  actionFilter: string,
  statusFilter: string,
  fromDate: string,
  toDate: string,
  offset: number,
): string {
  const p = new URLSearchParams({ limit: String(LIMIT), offset: String(offset) });
  if (agentFilter) p.set("agent_name", agentFilter);
  if (actionFilter) p.set("action", actionFilter);
  if (statusFilter) p.set("status", statusFilter);
  if (fromDate) p.set("from_date", fromDate + "T00:00:00");
  if (toDate) p.set("to_date", toDate + "T23:59:59");
  return `/audit/?${p.toString()}`;
}

function agentBadgeClass(agent: string | null): string {
  const map: Record<string, string> = {
    ClassifierAgent: "bg-violet-100 text-violet-700",
    SecurityAgent: "bg-rose-100 text-rose-700",
    ResponseAgent: "bg-blue-100 text-blue-700",
    SchedulingAgent: "bg-emerald-100 text-emerald-700",
  };
  return (agent && map[agent]) ? map[agent] : "bg-slate-100 text-slate-500";
}

function statusBadgeClass(s: string | null): string {
  if (s === "success") return "bg-emerald-100 text-emerald-700";
  if (s === "failed" || s === "error") return "bg-rose-100 text-rose-700";
  if (s === "skipped") return "bg-amber-100 text-amber-700";
  return "bg-slate-100 text-slate-500";
}

function getLatencyMs(details: AuditLogEntry["details"]): number | null {
  if (!details || Array.isArray(details)) return null;
  const d = details as Record<string, unknown>;
  const v = d.latency_ms ?? d.total_time_ms ?? d.duration_ms;
  return typeof v === "number" ? v : null;
}

function getEmailRef(log: AuditLogEntry): string {
  if (log.email_id) return log.email_id.slice(0, 8) + "…";
  if (log.details && !Array.isArray(log.details)) {
    const d = log.details as Record<string, unknown>;
    if (typeof d.subject === "string") return d.subject.slice(0, 32) + (d.subject.length > 32 ? "…" : "");
    if (typeof d.email_id === "string") return (d.email_id as string).slice(0, 8) + "…";
  }
  return "—";
}

function formatTs(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) +
    " " + d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ── Detail modal ──────────────────────────────────────────────────────────────

function DetailModal({ log, onClose }: { log: AuditLogEntry; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between px-5 py-4 border-b border-slate-100 flex-shrink-0">
          <div>
            <h2 className="text-sm font-semibold text-slate-800">Audit Entry #{log.id}</h2>
            <p className="text-xs text-slate-400 mt-0.5">{formatTs(log.created_at)}</p>
          </div>
          <button
            onClick={onClose}
            className="ml-4 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Meta grid */}
        <div className="px-5 pt-4 pb-3 flex-shrink-0 grid grid-cols-2 gap-3 text-xs">
          {[
            { label: "Agent", value: log.agent_name ?? "—" },
            { label: "Action", value: log.action ?? "—" },
            { label: "Status", value: log.status ?? "—" },
            { label: "IP Address", value: log.ip_address ?? "—" },
            { label: "User ID", value: log.user_id ? log.user_id.slice(0, 20) + "…" : "—" },
            { label: "Email ID", value: log.email_id ?? "—" },
          ].map(({ label, value }) => (
            <div key={label} className="bg-slate-50 rounded-lg px-3 py-2">
              <p className="text-slate-400 uppercase tracking-wide text-[10px] font-semibold mb-0.5">{label}</p>
              <p className="text-slate-700 font-medium truncate">{value}</p>
            </div>
          ))}
        </div>

        {/* Raw payload */}
        <div className="px-5 pb-5 flex-1 overflow-hidden flex flex-col min-h-0">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex-shrink-0">
            Payload
          </p>
          <div className="flex-1 overflow-auto rounded-lg bg-slate-950 border border-slate-800">
            <pre className="text-xs text-emerald-400 p-4 whitespace-pre-wrap break-words leading-relaxed">
              {log.details != null
                ? JSON.stringify(log.details, null, 2)
                : "null"}
            </pre>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Skeleton row ──────────────────────────────────────────────────────────────

function SkeletonRow() {
  return (
    <tr className="border-b border-slate-50">
      {[180, 120, 100, 140, 70, 70].map((w, i) => (
        <td key={i} className="px-4 py-3">
          <div className={`h-3 rounded bg-slate-100 animate-pulse`} style={{ width: w }} />
        </td>
      ))}
    </tr>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AdminAuditPage() {
  const router = useRouter();

  const { data: user, error: authError } = useSWR<UserProfile>("/auth/me", fetcher, {
    onError: () => router.replace("/login"),
    revalidateOnFocus: false,
  });

  const [agentFilter, setAgentFilter] = useState("");
  const [actionFilter, setActionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [offset, setOffset] = useState(0);

  const [detailLog, setDetailLog] = useState<AuditLogEntry | null>(null);

  const resetOffset = () => setOffset(0);

  const swrKey = buildUrl(agentFilter, actionFilter, statusFilter, fromDate, toDate, offset);
  const { data, isLoading } = useSWR<PaginatedResponse<AuditLogEntry>>(swrKey, fetcher, {
    refreshInterval: 15_000,
    keepPreviousData: true,
  });

  const logs = data?.items ?? [];
  const total = data?.total ?? 0;
  const currentPage = Math.floor(offset / LIMIT) + 1;
  const totalPages = Math.max(1, Math.ceil(total / LIMIT));

  const clearFilters = () => {
    setAgentFilter("");
    setActionFilter("");
    setStatusFilter("");
    setFromDate("");
    setToDate("");
    setOffset(0);
  };

  const hasFilters = agentFilter || actionFilter || statusFilter || fromDate || toDate;

  if (authError) return null;

  const selectCls = "text-sm border border-slate-200 rounded-lg px-3 py-2 bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-indigo-200 h-9";

  return (
    <>
      <Head>
        <title>Audit Logs — Admin</title>
      </Head>
      <Layout user={user ?? null}>
        <div className="max-w-7xl mx-auto py-8 px-4">
          {/* Header */}
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-slate-800">Audit Logs</h1>
            <p className="text-sm text-slate-500 mt-0.5">
              Operational footprint of every AI agent — filter, inspect, and debug pipeline events.
            </p>
          </div>

          {/* Filter bar */}
          <div className="card p-4 mb-5">
            <div className="flex flex-wrap gap-3 items-end">
              {/* Agent */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Agent</label>
                <select
                  value={agentFilter}
                  onChange={(e) => { setAgentFilter(e.target.value); resetOffset(); }}
                  className={selectCls}
                >
                  <option value="">All agents</option>
                  {AGENTS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              {/* Action */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Action</label>
                <select
                  value={actionFilter}
                  onChange={(e) => { setActionFilter(e.target.value); resetOffset(); }}
                  className={selectCls}
                >
                  <option value="">All actions</option>
                  {ACTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              {/* Status */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">Status</label>
                <select
                  value={statusFilter}
                  onChange={(e) => { setStatusFilter(e.target.value); resetOffset(); }}
                  className={selectCls}
                >
                  <option value="">All</option>
                  {STATUSES.map((s) => <option key={s} value={s}>{s.toUpperCase()}</option>)}
                </select>
              </div>

              {/* From date */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">From</label>
                <input
                  type="date"
                  value={fromDate}
                  onChange={(e) => { setFromDate(e.target.value); resetOffset(); }}
                  className={selectCls}
                />
              </div>

              {/* To date */}
              <div className="flex flex-col gap-1">
                <label className="text-xs font-medium text-slate-500 uppercase tracking-wide">To</label>
                <input
                  type="date"
                  value={toDate}
                  onChange={(e) => { setToDate(e.target.value); resetOffset(); }}
                  className={selectCls}
                />
              </div>

              {/* Clear */}
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="self-end h-9 px-3 text-sm text-slate-500 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                >
                  Clear
                </button>
              )}

              {/* Counter */}
              <div className="ml-auto self-end text-xs text-slate-400 whitespace-nowrap">
                {isLoading ? "…" : `${total.toLocaleString()} event${total !== 1 ? "s" : ""}`}
              </div>
            </div>
          </div>

          {/* Table */}
          <div className="card overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[860px]">
                <thead>
                  <tr className="border-b border-slate-100 text-left bg-slate-50/50">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Timestamp</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Agent</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Action</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Target Email</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right whitespace-nowrap">Latency (ms)</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {isLoading ? (
                    Array.from({ length: 8 }).map((_, i) => <SkeletonRow key={i} />)
                  ) : logs.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-4 py-16 text-center text-sm text-slate-400">
                        No audit events match the current filters.
                      </td>
                    </tr>
                  ) : (
                    logs.map((log) => {
                      const latency = getLatencyMs(log.details);
                      return (
                        <tr
                          key={log.id}
                          onClick={() => setDetailLog(log)}
                          className="border-b border-slate-50 hover:bg-indigo-50/40 cursor-pointer transition-colors"
                        >
                          <td className="px-4 py-3 text-xs text-slate-500 whitespace-nowrap font-mono">
                            {formatTs(log.created_at)}
                          </td>
                          <td className="px-4 py-3">
                            {log.agent_name ? (
                              <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${agentBadgeClass(log.agent_name)}`}>
                                {log.agent_name}
                              </span>
                            ) : (
                              <span className="text-slate-300 text-xs">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-600 max-w-[140px]">
                            <span className="inline-block truncate max-w-full" title={log.action ?? ""}>
                              {log.action ?? <span className="text-slate-300">—</span>}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-slate-500 font-mono max-w-[180px]">
                            <span className="truncate block" title={log.email_id ?? ""}>
                              {getEmailRef(log)}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-xs text-right font-mono">
                            {latency !== null ? (
                              <span className={latency > 3000 ? "text-rose-500" : latency > 1000 ? "text-amber-500" : "text-slate-600"}>
                                {latency.toLocaleString()}
                              </span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${statusBadgeClass(log.status)}`}>
                              {log.status === "success" && (
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                              )}
                              {(log.status === "failed" || log.status === "error") && (
                                <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />
                              )}
                              {log.status ?? "—"}
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {total > LIMIT && (
              <div className="px-4 py-3 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
                <span>Page {currentPage} of {totalPages}</span>
                <div className="flex gap-1.5">
                  <button
                    disabled={offset === 0}
                    onClick={() => setOffset(Math.max(0, offset - LIMIT))}
                    className="px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    ← Prev
                  </button>
                  <button
                    disabled={offset + LIMIT >= total}
                    onClick={() => setOffset(offset + LIMIT)}
                    className="px-3 py-1.5 rounded-md border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                  >
                    Next →
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </Layout>

      {detailLog && <DetailModal log={detailLog} onClose={() => setDetailLog(null)} />}
    </>
  );
}
