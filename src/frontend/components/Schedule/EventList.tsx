import type { ScheduleEvent } from "@/lib/types";

interface EventListProps {
  events: ScheduleEvent[];
  selectedId?: string;
  onSelect: (event: ScheduleEvent) => void;
}

const statusConfig: Record<
  ScheduleEvent["status"],
  { label: string; bg: string; text: string; border: string; dot: string }
> = {
  PENDING: {
    label: "Chờ xác nhận",
    bg: "bg-amber-50",
    text: "text-amber-700",
    border: "border-amber-200",
    dot: "bg-amber-400",
  },
  CONFIRMED: {
    label: "Đã xác nhận",
    bg: "bg-emerald-50",
    text: "text-emerald-700",
    border: "border-emerald-200",
    dot: "bg-emerald-400",
  },
  CONFLICT: {
    label: "Xung đột",
    bg: "bg-rose-50",
    text: "text-rose-700",
    border: "border-rose-200",
    dot: "bg-rose-400",
  },
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function EventList({ events, selectedId, onSelect }: EventListProps) {
  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 text-slate-400">
        <svg className="w-10 h-10 mb-3 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
            d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
        <p className="text-sm">Chưa có lịch hẹn nào.</p>
      </div>
    );
  }

  return (
    <ul className="flex flex-col gap-2 w-full max-w-[400px]">
      {events.map((event) => {
        const cfg = statusConfig[event.status];
        const isSelected = event.id === selectedId;

        return (
          <li key={event.id}>
            <button
              onClick={() => onSelect(event)}
              className={[
                "w-full text-left rounded-xl border px-4 py-3 transition-all duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400",
                isSelected
                  ? "bg-indigo-50 border-indigo-400 shadow-sm shadow-indigo-100"
                  : "bg-white border-slate-200 hover:border-slate-300 hover:shadow-sm",
              ].join(" ")}
            >
              {/* Title row */}
              <div className="flex items-start justify-between gap-2 mb-1.5">
                <span className={`text-sm font-semibold truncate ${isSelected ? "text-indigo-800" : "text-slate-800"}`}>
                  {event.title}
                </span>
                {/* Status badge */}
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border flex-shrink-0 ${cfg.bg} ${cfg.text} ${cfg.border}`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                  {cfg.label}
                </span>
              </div>

              {/* Time range */}
              <div className="flex items-center gap-1 text-xs text-slate-500 mb-2">
                <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>{formatTime(event.startTime)} – {formatTime(event.endTime)}</span>
              </div>

              {/* Email snippet */}
              {event.emailSnippet && (
                <p className="text-xs text-slate-400 line-clamp-2 mb-2 leading-relaxed">
                  {event.emailSnippet}
                </p>
              )}

              {/* Attendees */}
              {event.attendees.length > 0 && (
                <div className="flex items-center gap-1 flex-wrap mb-1">
                  <span className="text-[11px] text-slate-400 font-medium">Người tham dự:</span>
                  {event.attendees.slice(0, 3).map((a) => (
                    <span key={a} className="text-[11px] bg-slate-100 text-slate-600 rounded-full px-2 py-0.5">
                      {a}
                    </span>
                  ))}
                  {event.attendees.length > 3 && (
                    <span className="text-[11px] text-slate-400">+{event.attendees.length - 3}</span>
                  )}
                </div>
              )}

              {/* Alternative slots */}
              {event.alternativeSlots.length > 0 && (
                <div className="mt-1.5">
                  <span className="text-[11px] text-slate-400 font-medium">Khung giờ thay thế:</span>
                  <div className="flex flex-wrap gap-1 mt-1">
                    {event.alternativeSlots.map((slot) => (
                      <span key={slot} className="text-[11px] bg-indigo-50 text-indigo-600 border border-indigo-100 rounded px-1.5 py-0.5">
                        {formatTime(slot)}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </button>
          </li>
        );
      })}
    </ul>
  );
}
