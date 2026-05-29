interface StatCardProps {
  label: string;
  value: number | string;
  subtitle?: string;
  color: "indigo" | "emerald" | "amber" | "rose";
  icon: React.ReactNode;
  loading?: boolean;
}

const colorMap = {
  indigo: {
    bg: "bg-indigo-50",
    icon: "bg-indigo-100 text-indigo-600",
    value: "text-indigo-700",
    border: "border-indigo-100",
  },
  emerald: {
    bg: "bg-emerald-50",
    icon: "bg-emerald-100 text-emerald-600",
    value: "text-emerald-700",
    border: "border-emerald-100",
  },
  amber: {
    bg: "bg-amber-50",
    icon: "bg-amber-100 text-amber-600",
    value: "text-amber-700",
    border: "border-amber-100",
  },
  rose: {
    bg: "bg-rose-50",
    icon: "bg-rose-100 text-rose-600",
    value: "text-rose-700",
    border: "border-rose-100",
  },
};

export default function StatCard({
  label,
  value,
  subtitle,
  color,
  icon,
  loading = false,
}: StatCardProps) {
  const c = colorMap[color];

  return (
    <div className={`stat-card border ${c.border}`}>
      <div className="flex items-start justify-between">
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${c.icon}`}>
          {icon}
        </div>
        {loading && (
          <div className="w-4 h-4 rounded-full border-2 border-slate-300 border-t-slate-500 animate-spin" />
        )}
      </div>
      <div className="mt-3">
        {loading ? (
          <div className="h-8 w-20 bg-slate-100 animate-pulse rounded" />
        ) : (
          <p className={`text-3xl font-bold ${c.value}`}>{value}</p>
        )}
        <p className="text-sm font-medium text-slate-600 mt-1">{label}</p>
        {subtitle && <p className="text-xs text-slate-400 mt-0.5">{subtitle}</p>}
      </div>
    </div>
  );
}
