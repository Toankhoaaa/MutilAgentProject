import ConflictResolver from "./ConflictResolver";
import type { ScheduleEvent } from "@/lib/types";

interface EventDetailViewerProps {
  event: ScheduleEvent;
  onConfirm: () => void;
  onResolve: (newTime: string) => void;
  confirming?: boolean;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function EventDetailViewer({
  event,
  onConfirm,
  onResolve,
  confirming = false,
}: EventDetailViewerProps) {
  return (
    <div className="w-full max-w-[400px] flex flex-col gap-4">
      <div>
        <h2 className="text-base font-bold text-slate-900 leading-snug">{event.title}</h2>
        <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500">
          <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>{formatTime(event.startTime)} – {formatTime(event.endTime)}</span>
        </div>
      </div>

      {event.attendees.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
            Người tham dự
          </p>
          <div className="flex flex-wrap gap-1.5">
            {event.attendees.map((a) => (
              <span
                key={a}
                className="text-xs bg-slate-100 text-slate-700 rounded-full px-2.5 py-0.5 border border-slate-200"
              >
                {a}
              </span>
            ))}
          </div>
        </div>
      )}

      {event.emailSnippet && (
        <div>
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wide mb-1.5">
            Nội dung email
          </p>
          <p className="text-xs text-slate-600 leading-relaxed bg-slate-50 rounded-lg p-3 border border-slate-100">
            {event.emailSnippet}
          </p>
        </div>
      )}

      {event.status === "CONFLICT" && (
        <ConflictResolver event={event} onResolve={onResolve} />
      )}

      {event.status === "PENDING" && (
        <button
          onClick={onConfirm}
          disabled={confirming}
          className="btn-primary w-full justify-center disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {confirming ? (
            <>
              <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              Đang xác nhận...
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Xác nhận lịch hẹn
            </>
          )}
        </button>
      )}

      {event.status === "CONFIRMED" && (
        <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium">
          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          Lịch hẹn đã được xác nhận
        </div>
      )}
    </div>
  );
}
