import ConflictResolver from "./ConflictResolver";
import type { ScheduleEvent } from "@/lib/types";

interface EventDetailViewerProps {
  event: ScheduleEvent;
  onConfirm: () => void;
  onResolve: (newTime: string) => void;
  onCancel?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
  confirming?: boolean;
  cancelling?: boolean;
  deleting?: boolean;
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
  onCancel,
  onEdit,
  onDelete,
  confirming = false,
  cancelling = false,
  deleting = false,
}: EventDetailViewerProps) {
  const canEdit = event.status === "PENDING" || event.status === "CONFLICT";
  const canDelete = event.status !== "CONFIRMED";

  return (
    <div className="w-full max-w-[400px] flex flex-col gap-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-bold text-slate-900 leading-snug">{event.title}</h2>
          <div className="flex items-center gap-1.5 mt-1 text-xs text-slate-500">
            <svg className="w-3.5 h-3.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span>{formatTime(event.startTime)} – {formatTime(event.endTime)}</span>
          </div>
        </div>

        {(canEdit || canDelete) && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            {canEdit && onEdit && (
              <button
                type="button"
                onClick={onEdit}
                className="p-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 hover:border-slate-300"
                title="Chỉnh sửa"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                </svg>
              </button>
            )}
            {canDelete && onDelete && (
              <button
                type="button"
                onClick={onDelete}
                disabled={deleting}
                className="p-2 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
                title="Xóa lịch hẹn"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                </svg>
              </button>
            )}
          </div>
        )}
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
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 px-3 py-2.5 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Lịch hẹn đã được xác nhận
          </div>

          {event.html_link && (
            <a
              href={event.html_link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-700 text-sm font-medium hover:bg-blue-100 transition-colors"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              Xem trên Google Calendar
            </a>
          )}

          {event.meet_link && (
            <a
              href={event.meet_link}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-700 text-sm font-medium hover:bg-emerald-100 transition-colors"
            >
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M15 10l4.553-2.069A1 1 0 0121 8.87v6.26a1 1 0 01-1.447.894L15 14M3 8a2 2 0 012-2h8a2 2 0 012 2v8a2 2 0 01-2 2H5a2 2 0 01-2-2V8z" />
              </svg>
              Tham gia Google Meet
            </a>
          )}

          {onCancel && (
            <button
              onClick={onCancel}
              disabled={cancelling}
              className="flex items-center justify-center gap-2 w-full px-3 py-2 rounded-lg border border-red-200 text-red-600 text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {cancelling ? (
                <>
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                  Đang huỷ...
                </>
              ) : (
                <>
                  <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Huỷ lịch hẹn
                </>
              )}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
