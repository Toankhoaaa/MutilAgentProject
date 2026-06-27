import axios from "axios";
import { useEffect, useState } from "react";
import useSWR from "swr";
import { X, ChevronDown, Reply, Zap, Users, RotateCcw, Database, Check, ShieldAlert, AlertTriangle } from "lucide-react";
import api from "@/lib/axios";
import type { AnalyzeEmailResponse, DelegateEmailResponse, Department, DelegationItem, InboxEmailState, ProcessEmailResult } from "@/lib/types";

const deptFetcher = (url: string) => api.get<Department[]>(url).then((r) => r.data);

const CATEGORY_STYLES: Record<string, string> = {
  urgent: "bg-error-soft text-error border border-error-soft",
  important: "bg-warning-soft text-warning border border-warning-soft",
  need_reply: "bg-warning-soft text-warning border border-warning-soft",
  newsletter: "bg-canvas-soft-2 text-mute border border-hairline",
  spam: "bg-canvas-soft-2 text-mute border border-hairline",
};

const SENTIMENT_STYLES: Record<string, string> = {
  Positive: "text-emerald-600 bg-emerald-50",
  Negative: "text-error bg-error-soft",
  Neutral: "text-mute bg-canvas-soft-2",
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
      <div className="mb-4 p-4 bg-red-50 border border-red-300 rounded-md">
        <div className="flex items-center gap-2 mb-2">
          <ShieldAlert size={18} strokeWidth={1.75} className="text-red-600 shrink-0" />
          <span className="text-sm font-semibold text-red-800">
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
    <div className="mb-4 p-4 bg-amber-50 border border-amber-300 rounded-md">
      <div className="flex items-center gap-2 mb-2">
        <AlertTriangle size={18} strokeWidth={1.75} className="text-amber-600 shrink-0" />
        <span className="text-sm font-semibold text-amber-800">
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
  onGenerateDraft?: (email: InboxEmailState, tone: string) => Promise<ProcessEmailResult>;
  isAdmin?: boolean;
}

type ItemEdit = { recipientEmail: string; draftSubject: string; draftBody: string; ccEmails: string; bccEmails: string; assignedDeptId: string | null };
type ItemStatus = { sending: boolean; dismissing: boolean; error: string | null };

export default function EmailDetailSheet({ email, onClose, onAnalysisComplete, onGenerateDraft, isAdmin = false }: Props) {
  const { data: departments = [] } = useSWR<Department[]>("/departments", deptFetcher);

  const [analysis, setAnalysis] = useState<AnalyzeEmailResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [summaryExpanded, setSummaryExpanded] = useState(true);
  const [selectedTone, setSelectedTone] = useState<Tone>("Professional");
  const [confirmingEvent, setConfirmingEvent] = useState(false);
  const [eventConfirmed, setEventConfirmed] = useState(false);
  const [savingToKB, setSavingToKB] = useState(false);
  const [savedToKB, setSavedToKB] = useState(false);

  // Draft reply state
  const [isGeneratingDraft, setIsGeneratingDraft] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const [draftSubject, setDraftSubject] = useState("");
  const [draftBody, setDraftBody] = useState("");
  const [draftPushed, setDraftPushed] = useState(false);
  const [pushingDraft, setPushingDraft] = useState(false);

  // Delegation state
  const [delegating, setDelegating] = useState(false);
  const [delegationResult, setDelegationResult] = useState<DelegateEmailResponse | null>(null);
  const [delegationError, setDelegationError] = useState<string | null>(null);
  const [itemEdits, setItemEdits] = useState<Record<string, ItemEdit>>({});
  const [itemStatuses, setItemStatuses] = useState<Record<string, ItemStatus>>({});

  const handleGenerateDraftClick = async () => {
    if (!email || !onGenerateDraft) return;
    setIsGeneratingDraft(true);
    setDraftError(null);
    setDraftSubject("");
    setDraftBody("");
    setDraftPushed(false);
    try {
      const result = await onGenerateDraft(email, selectedTone);
      if (result.draft_content) {
        setDraftSubject(result.draft_subject ?? "");
        setDraftBody(result.draft_content);
      } else {
        setDraftError("Email này không cần phản hồi hoặc chưa được phân loại là cần trả lời.");
      }
    } catch {
      setDraftError("Không thể tạo nháp. Vui lòng thử lại.");
    } finally {
      setIsGeneratingDraft(false);
    }
  };

  const handlePushGmailDraft = async () => {
    if (!email || !draftBody) return;
    setPushingDraft(true);
    setDraftError(null);
    try {
      await api.post("/emails/gmail-draft", {
        to: email.sender ?? "",
        subject: draftSubject || `Re: ${email.subject ?? ""}`,
        body: draftBody,
        thread_id: email.thread_id ?? null,
      });
      setDraftPushed(true);
    } catch {
      setDraftError("Không thể tạo nháp trong Gmail. Vui lòng thử lại.");
    } finally {
      setPushingDraft(false);
    }
  };

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

  const _applyDelegationResponse = (data: DelegateEmailResponse) => {
    setDelegationResult(data);
    const edits: Record<string, ItemEdit> = {};
    const statuses: Record<string, ItemStatus> = {};
    for (const item of data.delegation?.items ?? []) {
      edits[item.id] = {
        recipientEmail: item.recipient_email ?? "",
        draftSubject: item.draft_subject ?? "",
        draftBody: item.draft_body ?? "",
        ccEmails: item.cc_emails ?? "",
        bccEmails: item.bcc_emails ?? "",
        assignedDeptId: item.department_id ?? null,
      };
      statuses[item.id] = { sending: false, dismissing: false, error: null };
    }
    setItemEdits(edits);
    setItemStatuses(statuses);
  };

  const handleDelegate = async () => {
    if (!email) return;
    setDelegating(true);
    setDelegationError(null);
    try {
      const res = await api.post<DelegateEmailResponse>(`/emails/${email.gmail_message_id}/delegate`);
      _applyDelegationResponse(res.data);
    } catch {
      setDelegationError("Phân công thất bại. Vui lòng thử lại.");
    } finally {
      setDelegating(false);
    }
  };

  const handleReDelegate = async () => {
    if (!email) return;
    if (!window.confirm("Thay nháp chưa gửi, giữ nháp đã gửi. Tiếp tục?")) return;
    setDelegating(true);
    setDelegationError(null);
    try {
      const res = await api.post<DelegateEmailResponse>(
        `/emails/${email.gmail_message_id}/delegate?force_refresh=true`
      );
      _applyDelegationResponse(res.data);
    } catch {
      setDelegationError("Phân công lại thất bại. Vui lòng thử lại.");
    } finally {
      setDelegating(false);
    }
  };

  const handleSendDraft = async (itemId: string) => {
    const edits = itemEdits[itemId];
    const currentItem = delegationResult?.delegation?.items.find((i) => i.id === itemId);
    if (!currentItem) return;

    if (currentItem.department_name === "Chưa xác định" && !edits?.assignedDeptId) {
      setItemStatuses((prev) => ({
        ...prev,
        [itemId]: { ...prev[itemId], error: "Vui lòng chọn phòng ban trước khi tạo nháp." },
      }));
      return;
    }

    const recipientEmail = edits?.recipientEmail || currentItem.recipient_email;
    if (!recipientEmail) {
      setItemStatuses((prev) => ({
        ...prev,
        [itemId]: { ...prev[itemId], error: "Vui lòng điền email nhận trước." },
      }));
      return;
    }

    // Guard: if this dept already had a sent draft, confirm before proceeding
    if (currentItem.already_sent_warning) {
      const dept = currentItem.department_name ?? "phòng này";
      if (!window.confirm(`${dept} đã nhận một nháp trước đó. Vẫn gửi thêm nháp này?`)) return;
    }

    setItemStatuses((prev) => ({ ...prev, [itemId]: { ...prev[itemId], sending: true, error: null } }));
    try {
      // PATCH changed fields first
      const updates: Record<string, string | null> = {};
      if (edits?.assignedDeptId && edits.assignedDeptId !== (currentItem.department_id ?? null)) {
        updates.department_id = edits.assignedDeptId;
      }
      if (edits?.recipientEmail && edits.recipientEmail !== (currentItem.recipient_email ?? "")) {
        updates.recipient_email = edits.recipientEmail;
      }
      if (edits?.draftSubject !== (currentItem.draft_subject ?? "")) {
        updates.draft_subject = edits.draftSubject;
      }
      if (edits?.draftBody !== (currentItem.draft_body ?? "")) {
        updates.draft_body = edits.draftBody;
      }
      if (edits?.ccEmails !== (currentItem.cc_emails ?? "")) {
        updates.cc_emails = edits.ccEmails.trim() || null;
      }
      if (edits?.bccEmails !== (currentItem.bcc_emails ?? "")) {
        updates.bcc_emails = edits.bccEmails.trim() || null;
      }
      if (Object.keys(updates).length > 0) {
        await api.patch(`/delegation-items/${itemId}`, updates);
      }

      const res = await api.post<DelegationItem>(`/delegation-items/${itemId}/send`);
      setDelegationResult((prev) => {
        if (!prev?.delegation) return prev;
        return {
          ...prev,
          delegation: {
            ...prev.delegation,
            items: prev.delegation.items.map((i) => (i.id === itemId ? res.data : i)),
          },
        };
      });
    } catch {
      setItemStatuses((prev) => ({
        ...prev,
        [itemId]: { ...prev[itemId], error: "Tạo nháp thất bại. Vui lòng thử lại." },
      }));
    } finally {
      setItemStatuses((prev) => ({ ...prev, [itemId]: { ...prev[itemId], sending: false } }));
    }
  };

  const handleDismissItem = async (itemId: string) => {
    setItemStatuses((prev) => ({ ...prev, [itemId]: { ...prev[itemId], dismissing: true, error: null } }));
    try {
      const res = await api.post<DelegationItem>(`/delegation-items/${itemId}/dismiss`);
      setDelegationResult((prev) => {
        if (!prev?.delegation) return prev;
        return {
          ...prev,
          delegation: {
            ...prev.delegation,
            items: prev.delegation.items.map((i) => (i.id === itemId ? res.data : i)),
          },
        };
      });
    } catch {
      setItemStatuses((prev) => ({
        ...prev,
        [itemId]: { ...prev[itemId], error: "Thao tác thất bại." },
      }));
    } finally {
      setItemStatuses((prev) => ({ ...prev, [itemId]: { ...prev[itemId], dismissing: false } }));
    }
  };

  useEffect(() => {
    if (!email) {
      setAnalysis(null);
      setAnalysisError(null);
      setSavedToKB(false);
      setDelegationResult(null);
      setDelegationError(null);
      setItemEdits({});
      setItemStatuses({});
      setDraftBody("");
      setDraftSubject("");
      setDraftError(null);
      setDraftPushed(false);
      return;
    }

    // Reset delegation and draft when switching to a different email
    setDelegationResult(null);
    setDelegationError(null);
    setItemEdits({});
    setItemStatuses({});
    setDraftBody("");
    setDraftSubject("");
    setDraftError(null);
    setDraftPushed(false);

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
          gmail_message_id: email.gmail_message_id || undefined,
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

  const categoryStyle = CATEGORY_STYLES[(email.category ?? "").toLowerCase()] ?? "bg-canvas-soft-2 text-mute border border-hairline";
  const isHighRisk = analysis?.is_safe === false || analysis?.risk_level === "high";
  const sentimentStyle = SENTIMENT_STYLES[analysis?.sentiment ?? ""] ?? "text-mute bg-canvas-soft-2";

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
        className="fixed right-0 top-0 h-full w-full max-w-md bg-canvas border-l border-hairline shadow-xl z-50 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline shrink-0">
          <h2 className="text-sm font-semibold text-ink truncate flex-1 pr-2">
            {email.subject || "(no subject)"}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded-sm hover:bg-canvas-soft-2 transition-colors shrink-0"
            aria-label="Close"
          >
            <X size={18} strokeWidth={1.75} className="text-mute" />
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
              <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-xs ${categoryStyle}`}>
                {email.category}
              </span>
            )}
            {email.priority_score != null && (
              <span className="text-xs text-mute font-mono">P{email.priority_score}</span>
            )}
            {analysis?.sentiment && (
              <span className={`text-xs font-medium px-1.5 py-0.5 rounded-sm ml-auto ${sentimentStyle}`}>
                {analysis.sentiment}
              </span>
            )}
          </div>

          {/* Sender */}
          <div>
            <p className="text-xs font-mono text-mute mb-0.5">From</p>
            <p className="text-sm text-ink">{email.sender || "—"}</p>
          </div>

          {/* Loading state */}
          {isAnalyzing && (
            <div className="flex items-center gap-2 py-3 text-sm text-mute">
              <span className="w-4 h-4 rounded-full border-2 border-body border-t-transparent animate-spin shrink-0" />
              Đang phân tích email…
            </div>
          )}

          {/* Error */}
          {analysisError && (
            <p className="text-sm text-error bg-error-soft px-3 py-2 rounded-sm border border-error-soft">
              {analysisError}
            </p>
          )}

          {/* ── Delegation section ── */}
          {(delegating || delegationResult !== null || delegationError) && (
            <div className="border-t border-hairline pt-4">
              <p className="text-xs font-mono text-mute uppercase tracking-wide mb-3">
                Phân công AI
              </p>

              {delegating && (
                <div className="flex items-center gap-2 text-sm text-mute py-2">
                  <span className="w-4 h-4 rounded-full border-2 border-body border-t-transparent animate-spin shrink-0" />
                  Đang phân tích và soạn nháp…
                </div>
              )}

              {delegationError && (
                <p className="text-sm text-error bg-error-soft px-3 py-2 rounded-sm border border-error-soft">
                  {delegationError}
                </p>
              )}

              {delegationResult && !delegationResult.is_delegation && (
                <p className="text-sm text-mute bg-canvas-soft-2 px-3 py-2 rounded-sm border border-hairline">
                  {delegationResult.message ?? "Email này không phải email giao việc cho nhiều phòng ban."}
                </p>
              )}

              {delegationResult?.delegation?.items.map((item) => {
                const edits = itemEdits[item.id] ?? {
                  recipientEmail: item.recipient_email ?? "",
                  draftSubject: item.draft_subject ?? "",
                  draftBody: item.draft_body ?? "",
                  ccEmails: item.cc_emails ?? "",
                  bccEmails: item.bcc_emails ?? "",
                  assignedDeptId: item.department_id ?? null,
                };
                const st = itemStatuses[item.id] ?? { sending: false, dismissing: false, error: null };
                const isDone = item.status === "sent";
                const isDismissed = item.status === "dismissed";

                const isUnknown = item.department_name === "Chưa xác định";
                const isLowConfidence = item.confidence != null && item.confidence < 0.7;
                const needsDeptAssignment = isUnknown && !edits.assignedDeptId;

                // Display name: use assigned dept name if user reassigned
                const resolvedDeptName = edits.assignedDeptId
                  ? (departments.find((d) => d.id === edits.assignedDeptId)?.name ?? item.department_name)
                  : item.department_name;

                const cardBorder = isDone
                  ? "border-emerald-200 bg-emerald-50"
                  : isDismissed
                  ? "border-hairline bg-canvas-soft-2 opacity-50"
                  : needsDeptAssignment
                  ? "border-error bg-error-soft"
                  : isLowConfidence
                  ? "border-warning bg-warning-soft"
                  : "border-hairline";

                return (
                  <div key={item.id} className={`mb-3 border rounded-md p-3 space-y-2 ${cardBorder}`}>
                    {/* Header row */}
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-ink truncate">
                        {resolvedDeptName ? `Phòng ${resolvedDeptName}` : "Phòng —"}
                      </span>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {item.confidence != null && !isDone && !isDismissed && (
                          <span
                            className={`text-xs font-medium px-1.5 py-0.5 rounded-sm ${
                              item.confidence >= 0.7
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-amber-100 text-amber-700"
                            }`}
                          >
                            {item.confidence >= 0.7 ? "Cao" : "Thấp"}
                          </span>
                        )}
                        {isDone && <span className="text-xs font-medium text-emerald-600">✓ Đã tạo nháp</span>}
                        {isDismissed && <span className="text-xs text-mute">Đã bỏ</span>}
                      </div>
                    </div>

                    {/* Re-delegate warning */}
                    {item.already_sent_warning && (
                      <div className="flex items-start gap-1.5 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-sm px-2 py-1.5">
                        <span className="shrink-0">⚠</span>
                        <span>
                          Phòng <strong>{item.department_name ?? "này"}</strong> đã được gửi một nháp trước đó.
                          Gửi thêm có thể trùng việc.
                        </span>
                      </div>
                    )}

                    {/* AI reason */}
                    {item.reason && !isDone && !isDismissed && (
                      <p className="text-xs text-mute italic">{item.reason}</p>
                    )}

                    {/* Work items */}
                    <ul className="space-y-0.5">
                      {item.work_items.map((wi, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-xs text-body">
                          <span className="text-mute shrink-0 mt-0.5">•</span>
                          <span>{wi}</span>
                        </li>
                      ))}
                    </ul>

                    {/* Editable fields — only when not done/dismissed */}
                    {!isDone && !isDismissed && (
                      <>
                        {/* Department reassignment dropdown */}
                        <div>
                          <label className="text-xs text-mute font-mono block mb-0.5">
                            Phòng ban
                            {needsDeptAssignment && (
                              <span className="text-error ml-1">(bắt buộc gán trước khi tạo nháp)</span>
                            )}
                            {!needsDeptAssignment && (isUnknown || isLowConfidence) && (
                              <span className="text-warning ml-1">(tin cậy thấp — nên xác nhận)</span>
                            )}
                          </label>
                          <select
                            value={edits.assignedDeptId ?? ""}
                            onChange={(e) => {
                              const deptId = e.target.value || null;
                              const dept = departments.find((d) => d.id === deptId);
                              setItemEdits((prev) => ({
                                ...prev,
                                [item.id]: {
                                  ...edits,
                                  assignedDeptId: deptId,
                                  recipientEmail: dept ? dept.email : edits.recipientEmail,
                                },
                              }));
                            }}
                            className={`w-full text-xs border rounded-sm px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ink bg-canvas text-ink ${
                              needsDeptAssignment ? "border-error" : "border-hairline"
                            }`}
                          >
                            <option value="">— Chọn phòng ban —</option>
                            {departments.map((d) => (
                              <option key={d.id} value={d.id}>{d.name}</option>
                            ))}
                          </select>
                        </div>

                        <div>
                          <label className="text-xs text-mute font-mono block mb-0.5">
                            Email nhận
                            {!edits.recipientEmail && (
                              <span className="text-error ml-1">(cần điền)</span>
                            )}
                          </label>
                          <input
                            type="email"
                            value={edits.recipientEmail}
                            onChange={(e) =>
                              setItemEdits((prev) => ({
                                ...prev,
                                [item.id]: { ...edits, recipientEmail: e.target.value },
                              }))
                            }
                            placeholder="email@phong.vn"
                            className="w-full text-xs border border-hairline rounded-sm px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ink bg-canvas text-ink"
                          />
                        </div>

                        <div>
                          <label className="text-xs text-mute font-mono block mb-0.5">Tiêu đề</label>
                          <input
                            type="text"
                            value={edits.draftSubject}
                            onChange={(e) =>
                              setItemEdits((prev) => ({
                                ...prev,
                                [item.id]: { ...edits, draftSubject: e.target.value },
                              }))
                            }
                            className="w-full text-xs border border-hairline rounded-sm px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ink bg-canvas text-ink"
                          />
                        </div>

                        <div>
                          <label className="text-xs text-mute font-mono block mb-0.5">Nội dung</label>
                          <textarea
                            rows={4}
                            value={edits.draftBody}
                            onChange={(e) =>
                              setItemEdits((prev) => ({
                                ...prev,
                                [item.id]: { ...edits, draftBody: e.target.value },
                              }))
                            }
                            className="w-full text-xs border border-hairline rounded-sm px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ink bg-canvas text-ink resize-none"
                          />
                        </div>

                        <div>
                          <label className="text-xs text-mute font-mono block mb-0.5">CC</label>
                          <input
                            type="text"
                            value={edits.ccEmails}
                            onChange={(e) =>
                              setItemEdits((prev) => ({
                                ...prev,
                                [item.id]: { ...edits, ccEmails: e.target.value },
                              }))
                            }
                            placeholder="email1@cty.vn, email2@cty.vn"
                            className="w-full text-xs border border-hairline rounded-sm px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ink bg-canvas text-ink"
                          />
                        </div>

                        <div>
                          <label className="text-xs text-mute font-mono block mb-0.5">BCC</label>
                          <input
                            type="text"
                            value={edits.bccEmails}
                            onChange={(e) =>
                              setItemEdits((prev) => ({
                                ...prev,
                                [item.id]: { ...edits, bccEmails: e.target.value },
                              }))
                            }
                            placeholder="email@cty.vn"
                            className="w-full text-xs border border-hairline rounded-sm px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-ink bg-canvas text-ink"
                          />
                          <p className="text-xs text-warning mt-0.5">
                            Lưu ý: CC/BCC phòng khác sẽ để họ thấy phần việc của phòng này.
                          </p>
                        </div>

                        {needsDeptAssignment && (
                          <p className="text-xs text-error font-medium">
                            Phải chọn phòng ban trước khi tạo nháp.
                          </p>
                        )}
                        {st.error && (
                          <p className="text-xs text-error">{st.error}</p>
                        )}

                        <div className="flex gap-2 pt-1">
                          <button
                            onClick={() => handleSendDraft(item.id)}
                            disabled={st.sending || st.dismissing || needsDeptAssignment}
                            className="flex-1 py-1.5 text-xs font-medium text-white bg-ink rounded-sm hover:opacity-80 disabled:opacity-50 transition-colors"
                            title={needsDeptAssignment ? "Chọn phòng ban trước" : undefined}
                          >
                            {st.sending ? (
                              <span className="flex items-center justify-center gap-1">
                                <span className="w-3 h-3 rounded-full border-2 border-white border-t-transparent animate-spin" />
                                Đang tạo…
                              </span>
                            ) : (
                              "Tạo nháp Gmail"
                            )}
                          </button>
                          <button
                            onClick={() => handleDismissItem(item.id)}
                            disabled={st.sending || st.dismissing}
                            className="px-3 py-1.5 text-xs font-medium text-body border border-hairline rounded-sm hover:bg-canvas-soft-2 disabled:opacity-50 transition-colors"
                          >
                            {st.dismissing ? "…" : "Bỏ"}
                          </button>
                        </div>
                      </>
                    )}

                    {isDone && (
                      <p className="text-xs text-emerald-700">
                        Nháp đã được tạo trong Gmail — mở Gmail để xem xét và gửi.
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Draft reply display */}
          {(draftBody || draftError) && (
            <div className="space-y-2">
              <p className="text-xs font-mono text-mute uppercase tracking-wide">AI Draft Reply</p>
              {draftError && (
                <p className="text-xs text-error bg-error-soft px-2 py-1.5 rounded-sm">{draftError}</p>
              )}
              {draftBody && (
                <>
                  {draftSubject && (
                    <p className="text-xs text-mute">
                      <span className="font-medium text-body">Tiêu đề: </span>{draftSubject}
                    </p>
                  )}
                  <textarea
                    value={draftBody}
                    onChange={(e) => setDraftBody(e.target.value)}
                    rows={8}
                    className="w-full text-sm text-body border border-hairline rounded-sm px-3 py-2 bg-canvas-soft-2 resize-y focus:outline-none focus:ring-1 focus:ring-ink"
                  />
                  {draftPushed ? (
                    <p className="text-xs text-emerald-700">✓ Nháp đã được tạo trong Gmail.</p>
                  ) : (
                    <button
                      onClick={handlePushGmailDraft}
                      disabled={pushingDraft}
                      className="w-full btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {pushingDraft ? (
                        <>
                          <span className="w-3.5 h-3.5 rounded-full border-2 border-body border-t-transparent animate-spin" />
                          Đang lưu vào Gmail…
                        </>
                      ) : (
                        "Lưu vào Gmail Draft"
                      )}
                    </button>
                  )}
                </>
              )}
            </div>
          )}

          {/* Analysis results */}
          {analysis && (
            <>
              {/* Collapsible AI Summary */}
              <div>
                <button
                  onClick={() => setSummaryExpanded((v) => !v)}
                  className="w-full flex items-center justify-between text-xs font-mono text-mute uppercase tracking-wide mb-1 hover:text-ink transition-colors"
                >
                  <span>AI Summary</span>
                  <ChevronDown
                    size={14}
                    strokeWidth={1.75}
                    className={`transition-transform ${summaryExpanded ? "rotate-180" : ""}`}
                  />
                </button>
                {summaryExpanded && (
                  <ul className="space-y-1.5 pl-1">
                    {analysis.summary.map((bullet, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-body">
                        <span className="text-mute mt-0.5 shrink-0">•</span>
                        <span>{bullet}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Action Items */}
              {analysis.action_items.length > 0 && (
                <div>
                  <p className="text-xs font-mono text-mute uppercase tracking-wide mb-1.5">
                    Action Items
                  </p>
                  <ul className="space-y-1.5">
                    {analysis.action_items.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-body">
                        <span className="text-mute mt-0.5 shrink-0">→</span>
                        <span>{item}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Translation */}
              {analysis.translation && (
                <div className="p-3 bg-canvas-soft-2 rounded-md border border-hairline">
                  <p className="text-xs font-mono text-mute uppercase tracking-wide mb-1">
                    Translation
                  </p>
                  <p className="text-sm text-body italic leading-relaxed">
                    {analysis.translation}
                  </p>
                </div>
              )}

              {/* Calendar Event */}
              {analysis.has_event && analysis.event_details && (
                <div className="bg-emerald-50 border border-emerald-200 rounded-md p-3 space-y-2">
                  <p className="text-xs font-mono text-emerald-700 uppercase tracking-wide">
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
                      className="w-full mt-1 py-1.5 text-xs font-semibold text-emerald-700 border border-emerald-300 rounded-sm hover:bg-emerald-100 transition-colors disabled:opacity-50"
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
        <div className="px-5 py-4 border-t border-hairline shrink-0 space-y-3">
          {isHighRisk && (
            <p className="text-xs text-error text-center">
              Các hành động bị vô hiệu hóa — email này được xác định là lừa đảo
            </p>
          )}

          {/* Tone Selector */}
          <div className="flex items-center gap-2">
            <label htmlFor="tone-select" className="text-xs text-mute shrink-0">
              Tone
            </label>
            <select
              id="tone-select"
              value={selectedTone}
              onChange={(e) => setSelectedTone(e.target.value as Tone)}
              className="flex-1 text-xs border border-hairline rounded-sm px-2 py-1.5 bg-canvas text-ink focus:outline-none focus:ring-1 focus:ring-ink"
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
              <Reply size={16} strokeWidth={1.75} />
              Reply
            </button>
            <button
              disabled={isHighRisk || isAnalyzing || isGeneratingDraft || !onGenerateDraft}
              onClick={handleGenerateDraftClick}
              className="flex-1 btn-primary disabled:opacity-40 disabled:cursor-not-allowed"
              title={isHighRisk ? "Không thể tạo nháp cho email lừa đảo" : undefined}
            >
              {isGeneratingDraft ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Đang tạo…
                </>
              ) : (
                <>
                  <Zap size={16} strokeWidth={1.75} />
                  Generate Draft
                </>
              )}
            </button>
          </div>

          {delegationResult?.is_delegation ? (
            <button
              onClick={handleReDelegate}
              disabled={delegating || isHighRisk}
              className="w-full btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
              title={isHighRisk ? "Không thể phân công email lừa đảo" : undefined}
            >
              {delegating ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-body border-t-transparent animate-spin" />
                  Đang phân công lại…
                </>
              ) : (
                <>
                  <RotateCcw size={16} strokeWidth={1.75} />
                  Phân công lại
                </>
              )}
            </button>
          ) : (
            <button
              onClick={handleDelegate}
              disabled={delegating || isHighRisk}
              className="w-full btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
              title={isHighRisk ? "Không thể phân công email lừa đảo" : undefined}
            >
              {delegating ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-body border-t-transparent animate-spin" />
                  Đang phân công…
                </>
              ) : (
                <>
                  <Users size={16} strokeWidth={1.75} />
                  Phân công AI
                </>
              )}
            </button>
          )}

          {isAdmin && (
            <button
              onClick={handleSaveToKB}
              disabled={savingToKB || savedToKB}
              className="w-full btn-secondary disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {savedToKB ? (
                <>
                  <Check size={16} strokeWidth={1.75} />
                  Saved to Knowledge Base
                </>
              ) : savingToKB ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-body border-t-transparent animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Database size={16} strokeWidth={1.75} />
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
