import type { CategoryCountItem } from "@/lib/types";

interface CategoryChartProps {
  items: CategoryCountItem[];
  loading?: boolean;
}

const categoryColors: Record<string, string> = {
  urgent: "bg-rose-500",
  important: "bg-amber-500",
  need_reply: "bg-blue-500",
  newsletter: "bg-violet-500",
  spam: "bg-slate-400",
  unknown: "bg-slate-300",
};

const categoryLabels: Record<string, string> = {
  urgent: "Urgent",
  important: "Important",
  need_reply: "Need Reply",
  newsletter: "Newsletter",
  spam: "Spam",
  unknown: "Unknown",
};

export default function CategoryChart({ items, loading }: CategoryChartProps) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="animate-pulse">
            <div className="flex justify-between mb-1">
              <div className="h-4 w-20 bg-slate-100 rounded" />
              <div className="h-4 w-8 bg-slate-100 rounded" />
            </div>
            <div className="h-2 bg-slate-100 rounded-full" />
          </div>
        ))}
      </div>
    );
  }

  if (!items || items.length === 0) {
    return <p className="text-sm text-slate-400 py-4 text-center">No classification data yet.</p>;
  }

  const total = items.reduce((sum, item) => sum + item.count, 0);

  return (
    <div className="space-y-3">
      {items.map((item) => {
        const pct = total > 0 ? Math.round((item.count / total) * 100) : 0;
        const barColor = categoryColors[item.category] ?? "bg-slate-400";
        const label = categoryLabels[item.category] ?? item.category;
        return (
          <div key={item.category}>
            <div className="flex items-center justify-between mb-1">
              <div className="flex items-center gap-2">
                <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${barColor}`} />
                <span className="text-sm text-slate-600 font-medium">{label}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-sm font-semibold text-slate-700">{item.count}</span>
                <span className="text-xs text-slate-400">({pct}%)</span>
              </div>
            </div>
            <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${barColor}`}
                style={{ width: `${pct}%` }}
              />
            </div>
          </div>
        );
      })}
    </div>
  );
}
