import type { AgentStatus } from "@/lib/types";

interface AgentStatusBadgeProps {
  status: AgentStatus | undefined;
  loading?: boolean;
}

const statusConfig = {
  idle: { dot: "bg-emerald-400", text: "text-emerald-700", bg: "bg-emerald-50", label: "Idle" },
  running: { dot: "bg-blue-400 animate-pulse", text: "text-blue-700", bg: "bg-blue-50", label: "Running" },
  degraded: { dot: "bg-rose-400", text: "text-rose-700", bg: "bg-rose-50", label: "Degraded" },
};

export default function AgentStatusBadge({ status, loading }: AgentStatusBadgeProps) {
  if (loading) {
    return <div className="h-6 w-24 bg-slate-100 animate-pulse rounded-full" />;
  }

  const cfg = status ? statusConfig[status.system_status] ?? statusConfig.idle : statusConfig.idle;

  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full ${cfg.bg}`}>
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${cfg.dot}`} />
      <span className={`text-sm font-medium ${cfg.text}`}>
        Agent: {cfg.label}
      </span>
      {status?.message && (
        <span className="text-xs text-slate-500 hidden lg:inline truncate max-w-xs">
          — {status.message}
        </span>
      )}
    </div>
  );
}
