interface StatCardProps {
  label: string;
  value: number | string;
  subtitle?: string;
  color: "indigo" | "emerald" | "amber" | "rose";
  icon: React.ReactNode;
  loading?: boolean;
  trend?: number; // percentage change, e.g. +8.5 or -3.2
}

const colorConfig = {
  indigo:  { iconBg: "#EEF2FF", iconColor: "#6366F1", accent: "#6366F1" },
  emerald: { iconBg: "#ECFDF5", iconColor: "#10B981", accent: "#10B981" },
  amber:   { iconBg: "#FFFBEB", iconColor: "#F59E0B", accent: "#F59E0B" },
  rose:    { iconBg: "#FFF1F2", iconColor: "#F43F5E", accent: "#F43F5E" },
};

const TrendUpIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M1 7L5 3L9 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

const TrendDownIcon = () => (
  <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
    <path d="M1 3L5 7L9 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
  </svg>
);

export default function StatCard({
  label,
  value,
  subtitle,
  color,
  icon,
  loading = false,
  trend,
}: StatCardProps) {
  const c = colorConfig[color];

  return (
    <div className="stat-card">
      {/* Header row: icon + loading spinner */}
      <div className="flex items-center justify-between mb-3">
        <div
          className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0"
          style={{ background: c.iconBg, color: c.iconColor }}
        >
          {icon}
        </div>
        {trend !== undefined && !loading && (
          <span className={`stat-trend ${trend >= 0 ? "stat-trend-up" : "stat-trend-down"}`}>
            {trend >= 0 ? <TrendUpIcon /> : <TrendDownIcon />}
            {Math.abs(trend)}%
          </span>
        )}
        {loading && (
          <div className="w-4 h-4 rounded-full border-2 border-slate-200 border-t-slate-400 animate-spin" />
        )}
      </div>

      {/* Value */}
      {loading ? (
        <div className="h-8 w-24 bg-slate-100 animate-pulse rounded mb-1" />
      ) : (
        <p className="stat-card-value">{value}</p>
      )}

      {/* Label */}
      <p className="stat-card-label">{label}</p>

      {/* Subtitle */}
      {subtitle && (
        <p style={{ fontSize: "0.6875rem", color: "#94A3B8", marginTop: "0.125rem" }}>{subtitle}</p>
      )}

      {/* Left accent bar */}
      <div
        style={{
          position: "absolute",
          left: 0,
          top: "20%",
          height: "60%",
          width: 3,
          background: c.accent,
          borderRadius: "0 3px 3px 0",
          opacity: 0.6,
        }}
      />
    </div>
  );
}
