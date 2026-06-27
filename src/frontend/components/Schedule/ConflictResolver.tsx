import type { ScheduleEvent } from "@/lib/types";

interface ConflictResolverProps {
  event: ScheduleEvent;
  onResolve: (newTime: string) => void;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString("vi-VN", {
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function ConflictResolver({ event, onResolve }: ConflictResolverProps) {
  if (event.status !== "CONFLICT") return null;

  return (
    <div className="w-full max-w-[400px] rounded-xl border border-rose-200 bg-rose-50 p-4">
      {/* Warning header */}
      <div className="flex items-start gap-2.5 mb-3">
        <span className="flex-shrink-0 mt-0.5">
          <svg className="w-5 h-5 text-rose-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </span>
        <div>
          <p className="text-sm font-semibold text-rose-800">Phát hiện xung đột lịch</p>
          <p className="text-xs text-rose-600 mt-0.5 leading-relaxed">
            Lịch hẹn <span className="font-medium">&ldquo;{event.title}&rdquo;</span> bị trùng với một sự kiện khác.
            Vui lòng chọn khung giờ thay thế bên dưới.
          </p>
        </div>
      </div>

      {/* Alternative slots */}
      {event.alternativeSlots.length === 0 ? (
        <p className="text-xs text-rose-500 italic">Không có khung giờ thay thế nào khả dụng.</p>
      ) : (
        <div className="flex flex-col gap-2">
          <p className="text-[11px] font-semibold text-rose-700 uppercase tracking-wide mb-0.5">
            Khung giờ thay thế
          </p>
          {event.alternativeSlots.map((slot) => (
            <button
              key={slot}
              onClick={() => onResolve(slot)}
              className="w-full text-left flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg border border-rose-200 bg-white text-rose-700 text-xs font-medium hover:bg-rose-100 hover:border-rose-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400 transition-all duration-150"
            >
              <span className="flex items-center gap-1.5">
                <svg className="w-3.5 h-3.5 flex-shrink-0 text-rose-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                {formatTime(slot)}
              </span>
              <span className="text-[11px] text-rose-400 flex-shrink-0">Chọn →</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
