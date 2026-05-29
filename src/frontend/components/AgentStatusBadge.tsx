import type { AgentStatus } from "@/lib/types";

interface AgentStatusBadgeProps {
  status: AgentStatus | undefined;
  loading?: boolean;
}

const statusConfig = {
  idle: {
    dot: "bg-emerald-400",
    text: "text-emerald-700",
    bg: "bg-emerald-50",
    border: "border-emerald-200",
    label: "Idle",
  },
  running: {
    dot: "bg-indigo-400 animate-pulse",
    text: "text-indigo-700",
    bg: "bg-indigo-50",
    border: "border-indigo-200",
    label: "Processing",
  },
  degraded: {
    dot: "bg-rose-400",
    text: "text-rose-700",
    bg: "bg-rose-50",
    border: "border-rose-200",
    label: "Degraded",
  },
};

export default function AgentStatusBadge({ status, loading }: AgentStatusBadgeProps) {
  if (loading) {
    return <div className="w-full h-10 bg-slate-100 rounded-lg animate-pulse mb-5" />;
  }

  const cfg = status ? statusConfig[status.system_status] ?? statusConfig.idle : statusConfig.idle;

  return (
    <div className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border mb-5 ${cfg.bg} ${cfg.border}`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
      <span className={`text-[11px] font-semibold uppercase tracking-widest ${cfg.text}`}>
        AI Agent — {cfg.label}
      </span>
      {status?.message && (
        <span className="text-xs text-slate-500 truncate">{status.message}</span>
      )}
      <span className="flex-1" />
      {status?.latest_run?.ended_at && (
        <span className="text-[11px] text-slate-400 flex-shrink-0 hidden sm:inline">
          Last run: {new Date(status.latest_run.ended_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      )}
    </div>
  );
}
