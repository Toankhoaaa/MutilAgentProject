import axios from "axios";
import { useEffect, useState } from "react";
import api from "@/lib/axios";
import type { AnalyzeEmailResponse, InboxEmailState } from "@/lib/types";

const CATEGORY_STYLES: Record<string, string> = {
  urgent: "bg-red-100 text-red-700",
  important: "bg-orange-100 text-orange-700",
  need_reply: "bg-blue-100 text-blue-700",
  newsletter: "bg-zinc-100 text-zinc-600",
  spam: "bg-zinc-200 text-zinc-500",
};

const SENTIMENT_STYLES: Record<string, string> = {
  Positive: "text-emerald-600 bg-emerald-50",
  Negative: "text-red-600 bg-red-50",
  Neutral: "text-zinc-500 bg-zinc-100",
};

const TONES = ["Formal", "Polite", "Professional", "Friendly", "Casual"] as const;
type Tone = typeof TONES[number];

function formatEventTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("vi-VN", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

interface SecurityBannerProps {
  riskLevel?: string | null;
  warnings?: string[];
}

function SecurityBanner({ riskLevel, warnings = [] }: SecurityBannerProps) {
  if (!riskLevel || riskLevel === "low") return null;

  if (riskLevel === "high") {
    return (
      <div className="mb-4 p-4 bg-red-50 border border-red-300 rounded-lg">
        <div className="flex items-center gap-2 mb-2">
          <svg className="w-5 h-5 text-red-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
            <path fillRule="evenodd" d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14a1 1 0 11-2 0 1 1 0 012 0zm0-7a1 1 0 10-2 0v3a1 1 0 102 0V7z" clipRule="evenodd" />
          </svg>
          <span className="text-sm font-bold text-red-800">
            CẢNH BÁO BẢO MẬT — Email có nguy cơ lừa đảo cao
          </span>
        </div>
        {warnings.length > 0 && (
          <ul className="space-y-1 mt-1">
            {warnings.map((w, i) => (
              <li key={i} className="flex items-start gap-1.5 text-xs text-red-700">
                <span className="mt-0.5 shrink-0">•</span>
                <span>{w}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    );
  }

  return (
    <div className="mb-4 p-4 bg-amber-50 border border-amber-300 rounded-lg">
      <div className="flex items-center gap-2 mb-2">
        <svg className="w-5 h-5 text-amber-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
          <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
        </svg>
        <span className="text-sm font-bold text-amber-800">
          Cảnh báo — Email có dấu hiệu đáng ngờ
        </span>
      </div>
      {warnings.length > 0 && (
        <ul className="space-y-1 mt-1">
          {warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-amber-700">
              <span className="mt-0.5 shrink-0">•</span>
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface Props {
  email: InboxEmailState | null;
  onClose: () => void;
  onAnalysisComplete?: (id: string, result: AnalyzeEmailResponse) => void;
  onGenerateDraft?: (email: InboxEmailState, tone: string) => void;
  isAdmin?: boolean;
}

export default function EmailDetailSheet({ email, onClose, onAnalysisComplete, onGenerateDraft, isAdmin = false }: Props) {
  const [analysis, setAnalysis] = useState<AnalyzeEmailResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const [selectedTone, setSelectedTone] = useState<Tone>("Professional");
  const [confirmingEvent, setConfirmingEvent] = useState(false);
  const [eventConfirmed, setEventConfirmed] = useState(false);
  const [savingToKB, setSavingToKB] = useState(false);
  const [savedToKB, setSavedToKB] = useState(false);

  const handleSaveToKB = async () => {
    if (!email) return;
    setSavingToKB(true);
    try {
      await api.post("/knowledge/save-from-email", {
        subject: email.subject || "",
        snippet: email.snippet || "",
        sender: email.sender || null,
        notes: analysis?.summary.join(" ") || null,
      });
      setSavedToKB(true);
      setTimeout(() => setSavedToKB(false), 3000);
    } catch {
      // silent — user can retry
    } finally {
      setSavingToKB(false);
    }
  };

  useEffect(() => {
    if (!email) {
      setAnalysis(null);
      setAnalysisError(null);
      setSavedToKB(false);
      return;
    }

    // Use pre-fetched analysis from parent cache if available
    if (email.analysis) {
      setAnalysis(email.analysis);
      setIsAnalyzing(false);
      return;
    }

    const controller = new AbortController();

    setIsAnalyzing(true);
    setAnalysis(null);
    setAnalysisError(null);
    setEventConfirmed(false);

    api
      .post<AnalyzeEmailResponse>(
        "/emails/analyze",
        {
          subject: email.subject || "",
          body: email.snippet || "(no preview)",
          sender: email.sender || undefined,
        },
        { signal: controller.signal },
      )
      .then((res) => {
        setAnalysis(res.data);
        onAnalysisComplete?.(email.gmail_message_id, res.data);
      })
      .catch((err) => {
        if (!axios.isCancel(err)) {
          setAnalysisError("Phân tích thất bại. Vui lòng thử lại.");
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setIsAnalyzing(false);
        }
      });

    return () => controller.abort();
  }, [email?.gmail_message_id]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!email) return null;

  const categoryStyle = CATEGORY_STYLES[(email.category ?? "").toLowerCase()] ?? "bg-zinc-100 text-zinc-600";
  const isHighRisk = analysis?.is_safe === false || analysis?.risk_level === "high";
  const sentimentStyle = SENTIMENT_STYLES[analysis?.sentiment ?? ""] ?? "text-zinc-500 bg-zinc-100";

  const handleConfirmEvent = async () => {
    if (!analysis?.scheduling_id) return;
    setConfirmingEvent(true);
    try {
      await api.post(`/emails/scheduled-events/${analysis.scheduling_id}/confirm`);
      setEventConfirmed(true);
    } catch {
      // silently ignore — event banner remains, user can retry
    } finally {
      setConfirmingEvent(false);
    }
  };

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Slide-over panel */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label={email.subject ?? "Email detail"}
        className="fixed right-0 top-0 h-full w-full max-w-md bg-white shadow-xl z-50 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 shrink-0">
          <h2 className="text-sm font-semibold text-zinc-800 truncate flex-1 pr-2">
            {email.subject || "(no subject)"}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-100 transition-colors shrink-0"
            aria-label="Close"
          >
            <svg className="w-5 h-5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* SecurityBanner — shown as soon as analysis arrives */}
          <SecurityBanner
            riskLevel={analysis?.risk_level ?? null}
            warnings={analysis?.warnings ?? []}
          />

          {/* Category + Priority + Sentiment row */}
          <div className="flex items-center gap-2 flex-wrap">
            {email.category && (
              <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${categoryStyle}`}>
                {email.category}
              </span>
            )}
            {email.priority_score != null && (
              <span className="text-xs text-zinc-500">P{email.priority_score}</span>
            )}
            {analysis?.sentiment && (
              <span className={`text-xs font-semibold px-2 py-0.5 rounded ml-auto ${sentimentStyle}`}>
                {analysis.sentiment}
              </span>
            )}
          </div>

          {/* Sender */}
          <div>
            <p className="text-xs font-medium text-zinc-400 mb-0.5 uppercase tracking-wide">From</p>
            <p className="text-sm text-zinc-800">{email.sender || "—"}</p>
          </div>

          {/* Loading state */}
          {isAnalyzing && (
            <div className="flex items-center gap-2 py-3 text-sm text-zinc-500">
              <span className="w-4 h-4 rounded-full border-2 border-blue-400 border-t-transparent animate-spin shrink-0" />
              Đang phân tích email…
            </div>
          )}

          {/* Error */}
          {analysisError && (
            <p className="text-sm text-red-500 bg-red-50 px-3 py-2 rounded-lg border border-red-100">
              {analysisError}
            </p>
          )}

          {/* Analysis results */}
          {analysis && (
            <>
              {/* Collapsible AI Summary */}
              <div>
                <button
                  onClick={() => setSummaryExpanded((v) => !v)}
                  className="w-full flex items-center justify-between text-xs font-medium text-zinc-400 uppercase tracking-wide mb-1 hover:text-zinc-600 transition-colors"
                >
                  <span>AI Summary</span>
                  <svg
                    className={`w-3.5 h-3.5 transition-transform ${summaryExpanded ? "rotate-180" : ""}`}
                    fill="none" stroke="currentColor" viewBox="0 0 24 24"
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {summaryExpanded && (
                  <ul className="space-y-1.5 pl-1">
                    {analysis.summary.map((bullet, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-zinc-700">
                        <span className="text-zinc-300 mt-0.5 shrink-0">•</span>
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Action Items */}
              {analysis.action_items.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-zinc-400 mb-1.5 uppercase tracking-wide">
                    Action Items
                  </p>
                  <ul className="space-y-1.5">
                    {analysis.action_items.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-zinc-700">
                        <span className="text-blue-400 mt-0.5 shrink-0">→</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Translation */}
              {analysis.translation && (
                <div className="p-3 bg-zinc-50 rounded-lg border border-zinc-100">
                  <p className="text-xs font-medium text-zinc-400 mb-1 uppercase tracking-wide">
                    Translation
                  </p>
                  <p className="text-sm text-zinc-600 italic leading-relaxed">
                    {analysis.translation}
                  </p>
                </div>
              )}

              {/* Calendar Event */}
              {analysis.has_event && analysis.event_details && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 space-y-2">
                  <p className="text-xs font-medium text-emerald-700 uppercase tracking-wide">
                    Lịch hẹn phát hiện
                  </p>
                  <p className="text-sm font-semibold text-emerald-800">
                    {analysis.event_details.event_title || "(Untitled event)"}
                  </p>
                  <p className="text-xs text-emerald-700">
                    {formatEventTime(analysis.event_details.start_time)}
                    {" – "}
                    {formatEventTime(analysis.event_details.end_time)}
                  </p>
                  {analysis.event_details.attendees.length > 0 && (
                    <p className="text-xs text-emerald-700">
                      {analysis.event_details.attendees.join(", ")}
                    </p>
                  )}
                  {eventConfirmed ? (
                    <p className="text-xs font-semibold text-emerald-600">
                      ✓ Đã thêm vào Google Calendar
                    </p>
                  ) : (
                    <button
                      onClick={handleConfirmEvent}
                      disabled={confirmingEvent}
                      className="w-full mt-1 py-1.5 text-xs font-semibold text-emerald-700 border border-emerald-300 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50"
                    >
                      {confirmingEvent ? (
                        <span className="flex items-center justify-center gap-1.5">
                          <span className="w-3 h-3 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
                          Đang xác nhận…
                        </span>
                      ) : (
                        "Confirm on Calendar"
                      )}
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        {/* Footer: tone selector + actions */}
        <div className="px-5 py-4 border-t border-zinc-100 shrink-0 space-y-3">
          {isHighRisk && (
            <p className="text-xs text-red-600 text-center">
              Các hành động bị vô hiệu hóa — email này được xác định là lừa đảo
            </p>
          )}

          {/* Tone Selector */}
          <div className="flex items-center gap-2">
            <label htmlFor="tone-select" className="text-xs text-zinc-500 shrink-0">
              Tone
            </label>
            <select
              id="tone-select"
              value={selectedTone}
              onChange={(e) => setSelectedTone(e.target.value as Tone)}
              className="flex-1 text-xs border border-zinc-200 rounded-md px-2 py-1.5 bg-white text-zinc-700 focus:outline-none focus:ring-1 focus:ring-blue-400"
            >
              {TONES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-3">
            <button
              disabled={isHighRisk}
              className="flex-1 btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
              title={isHighRisk ? "Không thể trả lời email lừa đảo" : undefined}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M3 10h10a8 8 0 018 8v2M3 10l6 6m-6-6l6-6" />
              </svg>
              Reply
            </button>
            <button
              disabled={isHighRisk || isAnalyzing}
              onClick={() => email && onGenerateDraft?.(email, selectedTone)}
              className="flex-1 btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              title={isHighRisk ? "Không thể tạo nháp cho email lừa đảo" : undefined}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                  d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
              </svg>
              Generate Draft
            </button>
          </div>

          {isAdmin && (
            <button
              onClick={handleSaveToKB}
              disabled={savingToKB || savedToKB}
              className="w-full btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {savedToKB ? (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Saved to Knowledge Base
                </>
              ) : savingToKB ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-zinc-400 border-t-transparent animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                  </svg>
                  Save to Knowledge Base
                </>
              )}
            </button>
          )}
        </div>
      </div>
    </>
  );
}
