import { useEffect, useState } from "react";
import api from "@/lib/axios";
import type { Email, EmailAnalysisResult } from "@/lib/types";

interface Props {
  email: Email | null;
  onClose: () => void;
}

type TabId = "email" | "analysis";

function SentimentBadge({ sentiment }: { sentiment: string }) {
  const map: Record<string, string> = {
    Positive: "bg-emerald-50 text-emerald-700 border-emerald-100",
    Neutral:  "bg-slate-50  text-slate-600  border-slate-200",
    Negative: "bg-rose-50   text-rose-700   border-rose-100",
  };
  const cls = map[sentiment] ?? map.Neutral;
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold border ${cls}`}>
      {sentiment}
    </span>
  );
}

function formatCategory(cat: string): string {
  return cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function LanguageBadge({ lang }: { lang: string }) {
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-mono font-semibold bg-indigo-50 text-indigo-700 border border-indigo-100 uppercase">
      {lang}
    </span>
  );
}

function AnalysisSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="skeleton-line w-1/3 h-4" />
      <div className="space-y-2">
        <div className="skeleton-line w-full h-3" />
        <div className="skeleton-line w-5/6 h-3" />
        <div className="skeleton-line w-4/6 h-3" />
      </div>
      <div className="skeleton-line w-1/4 h-4 mt-4" />
      <div className="space-y-2">
        <div className="skeleton-line w-full h-3" />
        <div className="skeleton-line w-3/4 h-3" />
      </div>
    </div>
  );
}

export default function EmailDetailSheet({ email, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>("email");
  const [analysis, setAnalysis] = useState<EmailAnalysisResult | null>(null);
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);

  // Reset state whenever a new email is opened
  useEffect(() => {
    if (email) {
      setActiveTab("email");
      setAnalysis(null);
      setAnalysisError(null);
    }
  }, [email?.id]);

  const _FALLBACK_MARKER = "Không thể phân tích email lúc này";

  /** True when the cached result only contains the error-fallback message. */
  const isStaleAnalysis = (a: EmailAnalysisResult) =>
    !a.translation && a.summary.length === 1 && a.summary[0].startsWith(_FALLBACK_MARKER);

  const fetchAnalysis = async (forceRefresh = false) => {
    if (!email) return;
    setAnalysisLoading(true);
    setAnalysisError(null);
    // If forced, delete the cached record so the server re-runs the agent
    try {
      if (forceRefresh) {
        // POST to schedule re-analysis — backend will skip cache only if we
        // hit a dedicated refresh endpoint; for now clear local state so the
        // GET re-fetches (the cache stays but at least the UI updates).
        setAnalysis(null);
      }
      const res = await api.get<EmailAnalysisResult>(`/emails/${email.id}/analysis`);
      setAnalysis(res.data);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })
          ?.response?.data?.error?.message ?? "Phân tích thất bại. Vui lòng thử lại.";
      setAnalysisError(msg);
    } finally {
      setAnalysisLoading(false);
    }
  };

  // Lazy fetch: only call LLM when user clicks the Analysis tab
  const handleTabChange = async (tab: TabId) => {
    setActiveTab(tab);
    if (tab === "analysis" && !analysis && !analysisLoading && email) {
      await fetchAnalysis();
    }
  };

  if (!email) return null;

  const tabs: { id: TabId; label: string }[] = [
    { id: "email",    label: "Email" },
    { id: "analysis", label: "AI Analysis" },
  ];

  return (
    <>
      {/* Backdrop */}
      <div className="sheet-backdrop" onClick={onClose} aria-hidden="true" />

      {/* Panel */}
      <div className="sheet-panel" role="dialog" aria-modal="true" aria-label="Email detail">
        {/* Header */}
        <div className="sheet-header">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-slate-800 truncate">
              {email.subject ?? "(No subject)"}
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 truncate">
              From: {email.sender ?? "Unknown"}
            </p>
          </div>
          <button onClick={onClose} className="sheet-close-btn" aria-label="Close">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="sheet-tabs">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => handleTabChange(t.id)}
              className={`sheet-tab ${activeTab === t.id ? "sheet-tab-active" : ""}`}
            >
              {t.label}
              {t.id === "analysis" && !analysis && !analysisLoading && (
                <span className="ml-1.5 inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-600">
                  AI
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="sheet-body">
          {/* ── Tab 1: Raw email ── */}
          {activeTab === "email" && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <span className="text-slate-400 block mb-0.5">From</span>
                  <span className="text-slate-700 font-medium break-all">{email.sender ?? "—"}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">To</span>
                  <span className="text-slate-700 font-medium break-all">{email.recipient ?? "—"}</span>
                </div>
                <div>
                  <span className="text-slate-400 block mb-0.5">Received</span>
                  <span className="text-slate-700 font-medium">
                    {email.received_at
                      ? new Date(email.received_at).toLocaleString()
                      : "—"}
                  </span>
                </div>
                {email.classification?.category && (
                  <div>
                    <span className="text-slate-400 block mb-0.5">Category</span>
                    <span className={`category-badge category-${email.classification.category}`}>
                      {formatCategory(email.classification.category)}
                    </span>
                  </div>
                )}
              </div>

              {email.classification?.summary && (
                <div className="rounded-lg bg-slate-50 border border-slate-100 p-3 text-xs text-slate-600">
                  <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-1">
                    Classifier Summary
                  </p>
                  {email.classification.summary}
                </div>
              )}

              <div>
                <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                  Body
                </p>
                <div className="rounded-lg border border-slate-100 bg-white p-3 text-xs text-slate-700 whitespace-pre-wrap leading-relaxed max-h-[50vh] overflow-y-auto">
                  {email.body ?? "(No content)"}
                </div>
              </div>
            </div>
          )}

          {/* ── Tab 2: AI Analysis ── */}
          {activeTab === "analysis" && (
            <div>
              {analysisLoading && <AnalysisSkeleton />}

              {analysisError && !analysisLoading && (
                <div className="rounded-lg border border-rose-100 bg-rose-50 p-4 text-sm text-rose-700">
                  <p className="font-semibold mb-1">Analysis failed</p>
                  <p className="text-xs">{analysisError}</p>
                  <button
                    onClick={() => handleTabChange("analysis")}
                    className="mt-2 text-xs underline hover:no-underline"
                  >
                    Retry
                  </button>
                </div>
              )}

              {analysis && !analysisLoading && (
                <div className="space-y-5">

                  {/* ── Meta row: language + sentiment ── */}
                  <div className="flex items-center gap-3 flex-wrap">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Ngôn ngữ</span>
                      <LanguageBadge lang={analysis.detected_language} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] text-slate-400 uppercase font-semibold tracking-wide">Cảm xúc</span>
                      <SentimentBadge sentiment={analysis.sentiment} />
                    </div>
                  </div>

                  {/* ── Translation — PRIMARY section ── */}
                  {analysis.translation ? (
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                        Bản dịch tiếng Việt
                      </p>
                      <div className="rounded-lg border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-sm text-slate-800 whitespace-pre-wrap leading-relaxed max-h-[45vh] overflow-y-auto">
                        {analysis.translation}
                      </div>
                    </div>
                  ) : (
                    /* Email is already Vietnamese — show a soft notice */
                    <div className="rounded-lg border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500 italic">
                      Email được viết bằng tiếng Việt — không cần dịch.
                    </div>
                  )}

                  {/* ── Summary bullets (secondary) ── */}
                  <div>
                    <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                      Tóm tắt
                    </p>
                    <ul className="space-y-1.5">
                      {analysis.summary.map((bullet, i) => (
                        <li key={i} className="flex gap-2 text-xs text-slate-700">
                          <span className="mt-0.5 w-1.5 h-1.5 rounded-full bg-indigo-400 flex-shrink-0" />
                          {bullet}
                        </li>
                      ))}
                    </ul>
                  </div>

                  {/* ── Action items ── */}
                  {analysis.action_items.length > 0 && (
                    <div>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide mb-2">
                        Việc cần làm
                      </p>
                      <ul className="space-y-1.5">
                        {analysis.action_items.map((item, i) => (
                          <li key={i} className="flex items-start gap-2 text-xs text-slate-700">
                            <input
                              type="checkbox"
                              className="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 accent-indigo-500 flex-shrink-0 cursor-pointer"
                              readOnly
                            />
                            {item}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  <div className="flex items-center justify-between pt-1">
                    <p className="text-[10px] text-slate-300">
                      Đã lưu cache · {new Date(analysis.updated_at).toLocaleString("vi-VN")}
                    </p>
                    {isStaleAnalysis(analysis) && (
                      <button
                        onClick={() => fetchAnalysis()}
                        className="text-[10px] text-indigo-500 hover:text-indigo-700 underline underline-offset-2"
                      >
                        Phân tích lại
                      </button>
                    )}
                  </div>
                </div>
              )}

              {!analysis && !analysisLoading && !analysisError && (
                <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-2">
                  <svg className="w-8 h-8 text-slate-200" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                      d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                  <p className="text-sm">Click to load AI analysis</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
