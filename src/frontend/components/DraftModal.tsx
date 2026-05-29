import { useState, useEffect } from "react";
import type { CreateEventResult, Email, SchedulingData } from "@/lib/types";
import api from "@/lib/axios";

interface DraftModalProps {
  email: Email | null;
  onClose: () => void;
  onSent: () => void;
}

// ── Datetime helpers ──────────────────────────────────────────────────────────

function formatVN(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Intl.DateTimeFormat("vi-VN", {
      hour: "2-digit",
      minute: "2-digit",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      timeZone: "Asia/Ho_Chi_Minh",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

/**
 * Convert an ISO 8601 string (any timezone) to the compact UTC format
 * required by Google Calendar URL parameters: YYYYMMDDTHHmmssZ
 */
function toGcalDate(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").split(".")[0] + "Z";
}

/**
 * Build a Google Calendar "add event" URL that opens in the user's browser.
 * No OAuth required — Google Calendar pre-fills the form from URL params.
 */
function buildGcalUrl(scheduling: SchedulingData, details?: string): string {
  const params = new URLSearchParams();
  params.set("action", "TEMPLATE");
  params.set("text", scheduling.event_summary ?? "Meeting");

  if (scheduling.start_datetime && scheduling.end_datetime) {
    params.set(
      "dates",
      `${toGcalDate(scheduling.start_datetime)}/${toGcalDate(scheduling.end_datetime)}`
    );
  }

  if (details) params.set("details", details.slice(0, 1500)); // URL length cap
  params.set("sf", "true");

  return `https://calendar.google.com/calendar/r/eventedit?${params.toString()}`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function SchedulingLoadingCard() {
  return (
    <div className="calendar-proposal-card animate-pulse">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-5 h-5 rounded bg-blue-200" />
        <div className="h-4 w-40 bg-blue-200 rounded" />
      </div>
      <div className="space-y-2">
        <div className="h-3 w-full bg-blue-100 rounded" />
        <div className="h-3 w-4/5 bg-blue-100 rounded" />
      </div>
    </div>
  );
}

interface SchedulingCardProps {
  scheduling: SchedulingData;
  eventResult: CreateEventResult | null;
  creating: boolean;
  onCreateEvent: () => void;
}

// Google Calendar brand icon (official "G" calendar logo shape)
function GCalIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M17 3h-1V1h-2v2H10V1H8v2H7C5.9 3 5 3.9 5 5v14c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H7V9h10v10zm0-12H7V5h10v2z"/>
      <path fill="#34A853" d="M9 11H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2zm-8 4H7v2h2v-2zm4 0h-2v2h2v-2zm4 0h-2v2h2v-2z"/>
    </svg>
  );
}

function SchedulingCard({ scheduling, eventResult, creating, onCreateEvent }: SchedulingCardProps) {
  const isCreated = !!scheduling.calendar_event_id || !!eventResult;
  const meetLink  = eventResult?.meet_link        ?? scheduling.meet_link;
  const calLink   = eventResult?.html_link        ?? scheduling.calendar_html_link;
  const gcalUrl   = scheduling.start_datetime
    ? buildGcalUrl(scheduling, scheduling.suggested_reply ?? undefined)
    : null;

  return (
    <div id="calendar-proposal-section" className="calendar-proposal-card">

      {/* ── Card header ── */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
              d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
          <span className="text-xs font-semibold text-blue-700 uppercase tracking-wide">
            Đề xuất Lịch họp
          </span>
        </div>
        {isCreated && (
          <span className="flex items-center gap-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-full px-2 py-0.5">
            <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            Đã tạo sự kiện
          </span>
        )}
      </div>

      {/* ── Event title ── */}
      <h4 id="event-summary" className="font-bold text-blue-800 text-sm mb-2 leading-tight">
        {scheduling.event_summary ?? "Họp (chưa có tiêu đề)"}
      </h4>

      {/* ── Time grid ── */}
      <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-3">
        <div>
          <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-wide">Bắt đầu</p>
          <p id="event-start" className="text-xs font-medium text-blue-900">
            {formatVN(scheduling.start_datetime)}
          </p>
        </div>
        <div>
          <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-wide">Kết thúc</p>
          <p id="event-end" className="text-xs font-medium text-blue-900">
            {formatVN(scheduling.end_datetime)}
          </p>
        </div>
      </div>

      {/* ── Warning when no exact time ── */}
      {!scheduling.start_datetime && (
        <div className="text-xs text-amber-700 bg-amber-50 border border-amber-100 rounded-lg px-3 py-2 mb-3">
          Chưa tìm được thời gian cụ thể. Hãy xác nhận giờ với người gửi trước khi tạo sự kiện.
        </div>
      )}

      {/* ── Action buttons (before creation) ── */}
      {!isCreated && scheduling.start_datetime && (
        <div className="flex flex-col gap-2 mt-1">
          {/* Primary: backend API creates event + sends draft */}
          <button
            onClick={onCreateEvent}
            disabled={creating}
            className="btn-calendar w-full"
          >
            {creating ? (
              <>
                <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                Đang tạo sự kiện…
              </>
            ) : (
              <>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                Tạo Sự kiện &amp; Gửi Email
              </>
            )}
          </button>

          {/* Secondary: open Google Calendar in browser (no OAuth needed) */}
          <a
            href={gcalUrl!}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-gcal-add w-full"
          >
            <GCalIcon className="w-4 h-4 flex-shrink-0" />
            Thêm vào Google Calendar
          </a>
        </div>
      )}

      {/* ── Management links after creation ── */}
      {isCreated && (
        <div className="flex flex-col gap-2 mt-1">
          {/* Meet link */}
          {meetLink && (
            <a
              href={meetLink}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-gcal-meet w-full"
            >
              <svg className="w-4 h-4 flex-shrink-0" viewBox="0 0 24 24" fill="currentColor">
                <path d="M15 8v8H5V8h10zm1-2H4a1 1 0 00-1 1v10a1 1 0 001 1h12a1 1 0 001-1v-3.5l4 4V7.5l-4 4V7a1 1 0 00-1-1z" />
              </svg>
              Tham gia Google Meet
            </a>
          )}

          {/* Manage event in Google Calendar */}
          {calLink && (
            <a
              href={calLink}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-gcal-manage w-full"
            >
              <GCalIcon className="w-4 h-4 flex-shrink-0" />
              Quản lý sự kiện trong Google Calendar
            </a>
          )}

          {/* Fallback: quick-add URL if no calLink yet */}
          {!calLink && gcalUrl && (
            <a
              href={gcalUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="btn-gcal-add w-full"
            >
              <GCalIcon className="w-4 h-4 flex-shrink-0" />
              Mở Google Calendar
            </a>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────

export default function DraftModal({ email, onClose, onSent }: DraftModalProps) {
  const [content, setContent]             = useState("");
  const [saving, setSaving]               = useState(false);
  const [sending, setSending]             = useState(false);
  const [error, setError]                 = useState<string | null>(null);
  const [scheduleLoading, setScheduleLoading] = useState(false);
  const [scheduling, setScheduling]       = useState<SchedulingData | null>(null);
  const [creating, setCreating]           = useState(false);
  const [eventResult, setEventResult]     = useState<CreateEventResult | null>(null);
  const [successMsg, setSuccessMsg]       = useState<string | null>(null);

  useEffect(() => {
    if (email?.draft) setContent(email.draft.draft_content);
    setError(null);
    setSuccessMsg(null);
    setEventResult(null);

    if (email) {
      if (email.scheduling) {
        setScheduling(email.scheduling);
      } else {
        // Lazy-fetch scheduling data when modal opens
        setScheduleLoading(true);
        api.post<SchedulingData>(`/emails/${email.id}/schedule`)
          .then((r) => setScheduling(r.data))
          .catch(() => setScheduling(null))
          .finally(() => setScheduleLoading(false));
      }
    }
  }, [email?.id]);

  if (!email) return null;

  const handleSave = async () => {
    if (!email.draft) return;
    setSaving(true);
    setError(null);
    try {
      await api.put(`/emails/${email.id}/draft`, { draft_content: content });
    } catch {
      setError("Không thể lưu bản nháp.");
    } finally {
      setSaving(false);
    }
  };

  const handleSend = async () => {
    if (!email.draft) return;
    setSending(true);
    setError(null);
    try {
      await handleSave();
      await api.post(`/emails/${email.id}/send`);
      onSent();
      onClose();
    } catch {
      setError("Không thể gửi bản nháp.");
    } finally {
      setSending(false);
    }
  };

  const handleCreateEvent = async () => {
    setCreating(true);
    setError(null);
    try {
      const res = await api.post<CreateEventResult>(`/emails/${email.id}/create-event`);
      setEventResult(res.data);
      setSuccessMsg(res.data.message);
      onSent(); // refresh email list to show updated draft state
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ?? "Không thể tạo sự kiện. Vui lòng thử lại.";
      setError(msg);
    } finally {
      setCreating(false);
    }
  };

  const draft = email.draft;
  const classification = email.classification;
  const isMeeting = scheduling?.is_meeting_request === true;
  const showNormalSend = draft && !draft.is_sent && !isMeeting;
  const showCalendarSend = draft && !draft.is_sent && isMeeting && !!scheduling?.start_datetime;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-box" onClick={(e) => e.stopPropagation()}>

        {/* ── Header ── */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1 min-w-0 pr-4">
            <h2 className="text-base font-semibold text-slate-800 truncate">
              {email.subject ?? "(Không có tiêu đề)"}
            </h2>
            <p className="text-sm text-slate-500 mt-0.5">Từ: {email.sender ?? "Không rõ"}</p>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 flex-shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* ── Classification info ── */}
        {classification && (
          <div className="bg-slate-50 rounded-lg p-3 mb-4 border border-slate-100">
            <div className="flex flex-wrap gap-2">
              {classification.category && (
                <span className={`category-badge category-${classification.category}`}>
                  {classification.category}
                </span>
              )}
              {classification.priority_score != null && (
                <span className="text-xs text-slate-500">
                  Ưu tiên: <strong>{classification.priority_score}/5</strong>
                </span>
              )}
              {classification.confidence != null && (
                <span className="text-xs text-slate-500">
                  Độ tin cậy: <strong>{Math.round(classification.confidence * 100)}%</strong>
                </span>
              )}
            </div>
            {classification.summary && (
              <p className="text-xs text-slate-600 mt-2 italic">{classification.summary}</p>
            )}
          </div>
        )}

        {/* ── Email body preview ── */}
        <div className="mb-4">
          <p className="text-xs font-medium text-slate-500 uppercase tracking-wide mb-1.5">
            Email gốc
          </p>
          <div className="bg-slate-50 rounded-lg p-3 border border-slate-100 max-h-28 overflow-y-auto">
            <p className="text-sm text-slate-600 whitespace-pre-wrap leading-relaxed">
              {email.body ?? "(Không có nội dung)"}
            </p>
          </div>
        </div>

        {/* ── Calendar proposal section ── */}
        {scheduleLoading && <SchedulingLoadingCard />}
        {!scheduleLoading && isMeeting && scheduling && (
          <SchedulingCard
            scheduling={scheduling}
            eventResult={eventResult}
            creating={creating}
            onCreateEvent={handleCreateEvent}
          />
        )}

        {/* ── Draft editor ── */}
        {draft ? (
          <div className="mb-4">
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">
                Bản nháp AI
              </p>
              {draft.is_sent && (
                <span className="text-xs text-emerald-600 font-medium flex items-center gap-1">
                  <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                  </svg>
                  Đã gửi
                </span>
              )}
            </div>
            <textarea
              className="w-full border border-slate-200 rounded-lg p-3 text-sm text-slate-700 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300"
              rows={5}
              value={content}
              onChange={(e) => setContent(e.target.value)}
              disabled={draft.is_sent ?? false}
              placeholder="Nội dung bản nháp…"
            />
          </div>
        ) : (
          <div className="mb-4 py-6 text-center text-slate-400 text-sm bg-slate-50 rounded-lg border border-dashed border-slate-200">
            Chưa có bản nháp cho email này.
          </div>
        )}

        {/* ── Success banner ── */}
        {successMsg && (
          <div className="flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2.5 mb-3">
            <svg className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <p className="text-sm text-emerald-700 font-medium">🎉 {successMsg}</p>
          </div>
        )}

        {error && <p className="text-sm text-rose-600 mb-3">{error}</p>}

        {/* ── Action buttons ── */}
        <div className="flex items-center justify-end gap-2">
          <button onClick={onClose} className="btn-secondary">Đóng</button>

          {/* Normal send path (non-meeting emails) */}
          {showNormalSend && (
            <>
              <button onClick={handleSave} disabled={saving} className="btn-secondary">
                {saving ? "Đang lưu…" : "Lưu nháp"}
              </button>
              <button onClick={handleSend} disabled={sending || saving} className="btn-primary">
                {sending ? "Đang gửi…" : "Gửi lên Gmail"}
              </button>
            </>
          )}

          {/* Calendar + send path (meeting emails without exact time) */}
          {isMeeting && !scheduling?.start_datetime && draft && !draft.is_sent && (
            <button onClick={handleSend} disabled={sending || saving} className="btn-primary">
              {sending ? "Đang gửi…" : "Gửi lên Gmail"}
            </button>
          )}

          {/* Calendar + send path handled inside SchedulingCard via btn-calendar */}
          {showCalendarSend && (
            <button onClick={handleSave} disabled={saving} className="btn-secondary">
              {saving ? "Đang lưu…" : "Lưu nháp"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
