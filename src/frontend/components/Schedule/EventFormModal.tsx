import { useEffect, useState } from "react";
import type { ScheduleEvent } from "@/lib/types";

export interface EventFormValues {
  title: string;
  startTime: string;
  endTime: string;
  attendees: string;
}

interface EventFormModalProps {
  mode: "create" | "edit";
  event?: ScheduleEvent | null;
  open: boolean;
  saving?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (values: EventFormValues) => void;
}

const inputCls =
  "block w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 bg-white";

const labelCls = "block text-sm font-medium text-slate-700 mb-1.5";

function isoToLocalInput(iso: string): string {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function defaultEndFromStart(startLocal: string): string {
  if (!startLocal) return "";
  const d = new Date(startLocal);
  d.setHours(d.getHours() + 1);
  return isoToLocalInput(d.toISOString());
}

export function localInputToIso(local: string): string {
  if (!local) return "";
  return `${local}:00+07:00`;
}

export default function EventFormModal({
  mode,
  event,
  open,
  saving = false,
  error,
  onClose,
  onSubmit,
}: EventFormModalProps) {
  const [title, setTitle] = useState("");
  const [startTime, setStartTime] = useState("");
  const [endTime, setEndTime] = useState("");
  const [attendees, setAttendees] = useState("");

  useEffect(() => {
    if (!open) return;
    if (mode === "edit" && event) {
      setTitle(event.title);
      setStartTime(isoToLocalInput(event.startTime));
      setEndTime(isoToLocalInput(event.endTime));
      setAttendees(event.attendees.join(", "));
    } else {
      setTitle("");
      setStartTime("");
      setEndTime("");
      setAttendees("");
    }
  }, [open, mode, event]);

  if (!open) return null;

  const handleStartChange = (value: string) => {
    setStartTime(value);
    if (!endTime || new Date(endTime) <= new Date(value)) {
      setEndTime(defaultEndFromStart(value));
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit({ title: title.trim(), startTime, endTime, attendees: attendees.trim() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/30" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={mode === "create" ? "Tạo lịch hẹn mới" : "Chỉnh sửa lịch hẹn"}
        className="relative w-full max-w-md bg-white rounded-2xl border border-slate-200 shadow-xl"
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-900">
            {mode === "create" ? "Tạo lịch hẹn mới" : "Chỉnh sửa lịch hẹn"}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="px-5 py-4 flex flex-col gap-4">
          <div>
            <label className={labelCls}>Tiêu đề</label>
            <input
              type="text"
              required
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className={inputCls}
              placeholder="Họp dự án Q3"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Bắt đầu</label>
              <input
                type="datetime-local"
                required
                value={startTime}
                onChange={(e) => handleStartChange(e.target.value)}
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Kết thúc</label>
              <input
                type="datetime-local"
                required
                value={endTime}
                onChange={(e) => setEndTime(e.target.value)}
                className={inputCls}
              />
            </div>
          </div>

          <div>
            <label className={labelCls}>
              Người tham dự
              <span className="ml-1 text-xs font-normal text-slate-400">(email, cách nhau bởi dấu phẩy)</span>
            </label>
            <input
              type="text"
              value={attendees}
              onChange={(e) => setAttendees(e.target.value)}
              className={inputCls}
              placeholder="a@company.vn, b@company.vn"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50 disabled:opacity-50"
            >
              Huỷ
            </button>
            <button
              type="submit"
              disabled={saving || !title.trim() || !startTime || !endTime}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? "Đang lưu..." : mode === "create" ? "Tạo lịch hẹn" : "Lưu thay đổi"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
