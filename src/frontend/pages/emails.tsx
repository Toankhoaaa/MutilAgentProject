import Head from "next/head";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import axios from "axios";
import Layout from "@/components/Layout";
import NotificationToast from "@/components/NotificationToast";
import EmailTable from "@/components/EmailTable";
import EmailDetailSheet from "@/components/EmailDetailSheet";
import api from "@/lib/axios";
import { RefreshCw, Zap, Inbox, Trash2, CheckCircle, XCircle } from "lucide-react";
import type {
  UserProfile,
  ProcessEmailsResult,
  ProcessEmailResult,
  GmailEmailItem,
  GmailListResponse,
  InboxEmailState,
  AnalyzeEmailResponse,
} from "@/lib/types";

type InboxCacheEntry = Omit<InboxEmailState, "analysis" | "isAnalyzing">;

function _inboxKey(userId: string) { return `inbox_${userId}`; }

function saveInboxSession(emails: InboxEmailState[], userId: string) {
  try {
    const entries: InboxCacheEntry[] = emails.map(({ analysis: _a, isAnalyzing: _i, ...rest }) => rest);
    sessionStorage.setItem(_inboxKey(userId), JSON.stringify(entries));
  } catch {}
}

function loadInboxSession(userId: string): InboxCacheEntry[] | null {
  try {
    const raw = sessionStorage.getItem(_inboxKey(userId));
    return raw ? (JSON.parse(raw) as InboxCacheEntry[]) : null;
  } catch { return null; }
}

const CATEGORY_STYLES: Record<string, string> = {
  urgent: "bg-error-soft text-error border border-error-soft",
  important: "bg-warning-soft text-warning border border-warning-soft",
  need_reply: "bg-warning-soft text-warning border border-warning-soft",
  newsletter: "bg-canvas-soft-2 text-mute border border-hairline",
  spam: "bg-canvas-soft-2 text-mute border border-hairline",
};

const fetcher = (url: string) => api.get(url).then((r) => r.data);

function formatDate(dateStr: string | null): string {
  if (!dateStr) return "—";
  try {
    return new Date(dateStr).toLocaleDateString("vi-VN", {
      day: "2-digit", month: "2-digit", year: "numeric",
    });
  } catch {
    return dateStr;
  }
}

export default function EmailsPage() {
  const router = useRouter();

  // Analysis cache — survives re-opens without re-fetching
  const analysisCacheRef = useRef<Map<string, AnalyzeEmailResponse>>(new Map());
  const sessionHydratedRef = useRef(false);

  // Inbox state
  const [inboxEmails, setInboxEmails] = useState<InboxEmailState[] | null>(null);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | null>(null);
  const [inboxError, setInboxError] = useState<string | null>(null);
  const [hideSocial, setHideSocial] = useState(false);
  const [showPromo, setShowPromo] = useState(false);

  // Processing state
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<ProcessEmailsResult | null>(null);
  const [abortedToast, setAbortedToast] = useState(false);
  const processingControllerRef = useRef<AbortController | null>(null);
  const processingTaskIdRef = useRef<string | null>(null);

  // Detail sheet state
  const [selectedEmail, setSelectedEmail] = useState<InboxEmailState | null>(null);

  // Spam cleanup state
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const { data: user, error: authError } = useSWR<UserProfile>("/auth/me", fetcher, {
    onError: () => router.replace("/login"),
    revalidateOnFocus: false,
  });

  // Hydrate inbox from sessionStorage once on first user load
  useEffect(() => {
    if (!user?.id || sessionHydratedRef.current) return;
    sessionHydratedRef.current = true;
    const cached = loadInboxSession(user.id);
    if (cached) {
      setInboxEmails(
        cached.map((e) => ({
          ...e,
          analysis: analysisCacheRef.current.get(e.gmail_message_id) ?? null,
          isAnalyzing: false,
        }))
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Persist inbox to sessionStorage whenever it changes
  useEffect(() => {
    if (inboxEmails && user?.id) saveInboxSession(inboxEmails, user.id);
  }, [inboxEmails, user?.id]);

  if (authError) return null;

  const isAdmin = user?.is_admin === true;

  const INBOX_FILTER = new Set(["important", "need_reply"]);
  const displayedEmails = inboxEmails
    ? inboxEmails.filter((e) => e.category === null || INBOX_FILTER.has(e.category.toLowerCase()))
    : null;

  const _toInboxState = (e: GmailEmailItem): InboxEmailState => ({
    ...e,
    analysis: analysisCacheRef.current.get(e.gmail_message_id) ?? null,
    isAnalyzing: false,
    category: null,
    priority_score: null,
  });

  const buildInboxQuery = (hs: boolean, sp: boolean) =>
    ["in:inbox", !sp && "-category:promotions", hs && "-category:social"]
      .filter(Boolean)
      .join(" ");

  const inboxQuery = buildInboxQuery(hideSocial, showPromo);

  const fetchInbox = async (query: string) => {
    setLoadingInbox(true);
    setInboxError(null);
    setNextPageToken(null);
    try {
      const res = await api.get<GmailListResponse>(`/emails/list?limit=20&query=${encodeURIComponent(query)}`);
      const items: InboxEmailState[] = res.data.emails.map(_toInboxState);
      setNextPageToken(res.data.next_page_token);
      setInboxEmails(items);

      // Background classify-quick — inbox stays functional if this fails
      const classifyPayload = items
        .filter((e) => e.thread_id)
        .map((e) => ({
          thread_id: e.thread_id!,
          subject: e.subject ?? "",
          snippet: e.snippet ?? "",
          sender: e.sender,
        }));

      if (classifyPayload.length > 0) {
        api
          .post<Array<{ thread_id: string; category: string; priority_score: number; confidence: number }>>(
            "/emails/classify-quick",
            classifyPayload,
          )
          .then((r) => {
            const resultMap = new Map(r.data.map((x) => [x.thread_id, x]));
            setInboxEmails((prev) =>
              prev
                ? prev.map((email) => {
                    const hit = email.thread_id ? resultMap.get(email.thread_id) : undefined;
                    return hit
                      ? { ...email, category: hit.category, priority_score: hit.priority_score }
                      : email;
                  })
                : null,
            );
          })
          .catch(() => {});
      }
    } catch {
      setInboxError("Không thể tải inbox. Kiểm tra kết nối Gmail.");
    } finally {
      setLoadingInbox(false);
    }
  };

  const handleLoadInbox = () => fetchInbox(inboxQuery);

  const handleToggleSocial = async () => {
    const next = !hideSocial;
    setHideSocial(next);
    if (inboxEmails !== null) await fetchInbox(buildInboxQuery(next, showPromo));
  };

  const handleTogglePromo = async () => {
    const next = !showPromo;
    setShowPromo(next);
    if (inboxEmails !== null) await fetchInbox(buildInboxQuery(hideSocial, next));
  };

  const handleLoadMore = async () => {
    if (!nextPageToken || loadingMore) return;
    setLoadingMore(true);
    try {
      const res = await api.get<GmailListResponse>(`/emails/list?limit=20&page_token=${encodeURIComponent(nextPageToken)}&query=${encodeURIComponent(inboxQuery)}`);
      const newItems = res.data.emails.map(_toInboxState);
      setNextPageToken(res.data.next_page_token);
      setInboxEmails((prev) => {
        if (!prev) return newItems;
        const existingIds = new Set(prev.map((e) => e.gmail_message_id));
        return [...prev, ...newItems.filter((e) => !existingIds.has(e.gmail_message_id))];
      });

      const classifyPayload = newItems
        .filter((e) => e.thread_id)
        .map((e) => ({ thread_id: e.thread_id!, subject: e.subject ?? "", snippet: e.snippet ?? "", sender: e.sender }));
      if (classifyPayload.length > 0) {
        api
          .post<Array<{ thread_id: string; category: string; priority_score: number; confidence: number }>>(
            "/emails/classify-quick",
            classifyPayload,
          )
          .then((r) => {
            const resultMap = new Map(r.data.map((x) => [x.thread_id, x]));
            setInboxEmails((prev) =>
              prev
                ? prev.map((email) => {
                    const hit = email.thread_id ? resultMap.get(email.thread_id) : undefined;
                    return hit ? { ...email, category: hit.category, priority_score: hit.priority_score } : email;
                  })
                : null,
            );
          })
          .catch(() => {});
      }
    } catch {
      setInboxError("Không thể tải thêm email. Thử lại sau.");
    } finally {
      setLoadingMore(false);
    }
  };

  const handleProcessEmails = async () => {
    const taskId = crypto.randomUUID();
    const controller = new AbortController();
    processingControllerRef.current = controller;
    processingTaskIdRef.current = taskId;

    setProcessing(true);
    setProcessResult(null);
    setAbortedToast(false);
    try {
      const res = await api.post<ProcessEmailsResult>(
        "/emails/process",
        { task_id: taskId },
        { signal: controller.signal },
      );
      setProcessResult(res.data);
    } catch (err) {
      if (axios.isCancel(err)) {
        setAbortedToast(true);
        setTimeout(() => setAbortedToast(false), 4000);
      }
      setProcessResult(null);
    } finally {
      setProcessing(false);
      processingControllerRef.current = null;
      processingTaskIdRef.current = null;
    }
  };

  const handleAbortProcessing = () => {
    processingControllerRef.current?.abort();
    const taskId = processingTaskIdRef.current;
    if (taskId) {
      api.post(`/pipeline/${taskId}/cancel`).catch(() => {});
    }
  };

  const handleGenerateDraft = async (email: InboxEmailState, tone: string): Promise<ProcessEmailResult> => {
    const res = await api.post<ProcessEmailResult>("/emails/classify", {
      subject: email.subject ?? "",
      text: email.snippet ?? "(no preview)",
      sender: email.sender ?? "",
      gmail_message_id: email.gmail_message_id,
      tone,
      generate_draft: true,
    });
    return res.data;
  };

  const handleCleanupSpam = async () => {
    setCleanupLoading(true);
    setCleanupResult(null);
    try {
      const res = await api.post<{ message: string; trashed: number; errors: number }>("/emails/cleanup-spam");
      setCleanupResult({ message: res.data.message, type: "success" });
    } catch {
      setCleanupResult({ message: "Spam cleanup failed. Please try again.", type: "error" });
    } finally {
      setCleanupLoading(false);
      setTimeout(() => setCleanupResult(null), 5000);
    }
  };

  return (
    <>
      <Head>
        <title>Email Pipeline - Email Orchestrator</title>
      </Head>

      <Layout user={user ?? null}>
        <div className="space-y-6">

          {/* ── Inbox Viewer ── */}
          <section className="card">
            <div className="flex items-center justify-between mb-3">
              <div>
                <h2 className="text-sm font-semibold text-ink">Inbox</h2>
                <p className="text-xs text-mute mt-0.5">Xem email từ Gmail — không lưu vào database</p>
              </div>
              <button
                onClick={handleLoadInbox}
                disabled={loadingInbox}
                className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingInbox ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-body border-t-transparent animate-spin" />
                    Đang tải…
                  </>
                ) : (
                  <>
                    <RefreshCw size={14} strokeWidth={1.75} />
                    {inboxEmails ? "Làm mới" : "Tải Inbox"}
                  </>
                )}
              </button>
            </div>
            <div className="flex items-center gap-4 mb-4 text-xs text-mute">
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={hideSocial}
                  onChange={handleToggleSocial}
                  disabled={loadingInbox}
                  className="accent-ink"
                />
                Ẩn mạng xã hội
              </label>
              <label className="flex items-center gap-1.5 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={showPromo}
                  onChange={handleTogglePromo}
                  disabled={loadingInbox}
                  className="accent-ink"
                />
                Hiển thị quảng cáo
              </label>
            </div>

            {inboxError && (
              <p className="text-sm text-error bg-error-soft px-3 py-2 rounded-sm border border-error-soft mb-3">
                {inboxError}
              </p>
            )}

            {/* Skeleton rows — first load only */}
            {loadingInbox && !displayedEmails && (
              <div className="divide-y divide-hairline -mx-4 sm:mx-0">
                {[...Array(5)].map((_, i) => (
                  <div key={i} className="py-3 px-4 animate-pulse">
                    <div className="flex gap-2 mb-1.5">
                      <div className="h-3 bg-canvas-soft-2 rounded-sm w-28" />
                      <div className="h-3 bg-canvas-soft-2 rounded-sm w-14 ml-auto" />
                    </div>
                    <div className="h-3 bg-canvas-soft-2 rounded-sm w-48 mb-1" />
                    <div className="h-3 bg-canvas-soft-2 rounded-sm w-64" />
                  </div>
                ))}
              </div>
            )}

            {displayedEmails && displayedEmails.length === 0 && (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Inbox size={28} strokeWidth={1.25} className="text-mute" />
                <p className="text-sm text-mute">Inbox trống.</p>
              </div>
            )}

            {displayedEmails && displayedEmails.length > 0 && (
              <>
                <div className="divide-y divide-hairline -mx-4 sm:mx-0">
                  {displayedEmails.map((email) => (
                    <div
                      key={email.gmail_message_id}
                      onClick={() => setSelectedEmail(email)}
                      className="py-3 px-4 flex gap-3 items-start hover:bg-canvas-soft-2 cursor-pointer transition-colors"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="flex items-baseline gap-2 mb-0.5">
                          <span className="text-sm font-medium text-ink truncate">
                            {email.sender || "—"}
                          </span>
                          <span className="text-xs text-mute shrink-0">{formatDate(email.date)}</span>
                        </div>
                        <p className="text-sm font-medium text-body truncate">{email.subject || "(no subject)"}</p>
                        {email.snippet && (
                          <p className="text-xs text-mute truncate mt-0.5">{email.snippet}</p>
                        )}
                      </div>
                      <div className="flex items-center gap-2 shrink-0 pt-0.5">
                        {email.category && (
                          <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-xs ${CATEGORY_STYLES[email.category.toLowerCase()] ?? "bg-canvas-soft-2 text-mute border border-hairline"}`}>
                            {email.category}
                          </span>
                        )}
                        {email.priority_score != null && (
                          <span className="text-xs text-mute font-mono">P{email.priority_score}</span>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
                {nextPageToken && (
                  <div className="mt-3 flex justify-center">
                    <button
                      onClick={handleLoadMore}
                      disabled={loadingMore}
                      className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loadingMore ? (
                        <>
                          <span className="w-3.5 h-3.5 rounded-full border-2 border-body border-t-transparent animate-spin" />
                          Đang tải...
                        </>
                      ) : (
                        "Tải thêm"
                      )}
                    </button>
                  </div>
                )}
              </>
            )}

            {!displayedEmails && !loadingInbox && !inboxError && (
              <div className="flex flex-col items-center gap-2 py-10 text-center">
                <Inbox size={28} strokeWidth={1.25} className="text-mute" />
                <p className="text-sm text-mute">Nhấn &quot;Tải Inbox&quot; để xem email.</p>
              </div>
            )}
          </section>

          {/* ── AI Processing Pipeline (admin only) ── */}
          {isAdmin && <section className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-ink">AI Email Pipeline</h2>
                <p className="text-xs text-mute mt-0.5">Phân loại email và tạo nháp trả lời tự động</p>
              </div>
              <div className="flex items-center gap-2">
                {processing && (
                  <button
                    onClick={handleAbortProcessing}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-error bg-error-soft border border-error-soft rounded-sm hover:opacity-80 transition-colors"
                  >
                    Dừng
                  </button>
                )}
                <button
                  onClick={handleProcessEmails}
                  disabled={processing}
                  className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {processing ? (
                    <>
                      <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                      Processing…
                    </>
                  ) : (
                    <>
                      <Zap size={14} strokeWidth={1.75} />
                      Process Emails
                    </>
                  )}
                </button>
              </div>
            </div>

            {abortedToast && (
              <div className="flex items-center gap-2 mb-4 px-3 py-2 text-sm rounded-sm bg-warning-soft text-warning border border-warning-soft">
                Đã hủy xử lý
              </div>
            )}

            {processResult && (
              <>
                {/* Summary counts */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-5">
                  {([
                    ["Fetched", processResult.fetched],
                    ["Processed", processResult.processed],
                    ["Drafts Created", processResult.drafts_created],
                    ["Failed", processResult.failed],
                  ] as [string, number][]).map(([label, value]) => (
                    <div key={label} className="text-center bg-canvas-soft-2 rounded-md py-3">
                      <p className={`text-2xl font-semibold ${label === "Failed" && value > 0 ? "text-error" : "text-ink"}`}>
                        {value}
                      </p>
                      <p className="text-xs text-mute font-mono mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>

                {/* Per-email results */}
                {processResult.processed_emails.length > 0 && (
                  <div>
                    <h3 className="text-xs font-mono text-mute uppercase tracking-wide mb-3">
                      Chi tiết từng email
                    </h3>
                    <EmailTable
                      emails={processResult.processed_emails}
                      onSelect={(email) =>
                        setSelectedEmail({
                          gmail_message_id: email.gmail_message_id,
                          thread_id: null,
                          subject: email.subject,
                          sender: email.sender,
                          date: null,
                          snippet: email.summary,
                          analysis: null,
                          isAnalyzing: false,
                          category: email.category,
                          priority_score: email.priority_score,
                        })
                      }
                    />
                  </div>
                )}

                {processResult.errors.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-hairline">
                    <p className="text-xs font-mono text-error mb-2">Errors</p>
                    <ul className="space-y-1">
                      {processResult.errors.map((err, i) => (
                        <li key={i} className="text-xs text-mute font-mono bg-canvas-soft-2 px-2 py-1 rounded-sm">
                          {JSON.stringify(err)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}

            {!processResult && !processing && (
              <p className="text-sm text-mute text-center py-6">
                Nhấn &quot;Process Emails&quot; để chạy AI pipeline.
              </p>
            )}
          </section>}

          {/* ── Spam Cleanup (admin only) ── */}
          {isAdmin && <section className="card">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-ink mb-1">Spam Cleanup</h2>
                <p className="text-xs text-mute">Chuyển toàn bộ thư mục SPAM sang thùng rác.</p>
              </div>
              <button
                onClick={handleCleanupSpam}
                disabled={cleanupLoading}
                className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed text-error border-error-soft hover:bg-error-soft whitespace-nowrap"
              >
                {cleanupLoading ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-error border-t-transparent animate-spin" />
                    Cleaning…
                  </>
                ) : (
                  <>
                    <Trash2 size={14} strokeWidth={1.75} />
                    Clean Up SPAM
                  </>
                )}
              </button>
            </div>
            {cleanupResult && (
              <div className={`mt-4 flex items-center gap-2 text-sm px-3 py-2 rounded-sm border ${
                cleanupResult.type === "success"
                  ? "bg-emerald-50 text-emerald-700 border-emerald-100"
                  : "bg-error-soft text-error border-error-soft"
              }`}>
                {cleanupResult.type === "success" ? (
                  <CheckCircle size={14} strokeWidth={1.75} className="shrink-0" />
                ) : (
                  <XCircle size={14} strokeWidth={1.75} className="shrink-0" />
                )}
                {cleanupResult.message}
              </div>
            )}
          </section>}

        </div>
      </Layout>

      <NotificationToast />
      <EmailDetailSheet
        email={selectedEmail}
        onClose={() => setSelectedEmail(null)}
        onAnalysisComplete={(id, result) => {
          analysisCacheRef.current.set(id, result);
        }}
        onGenerateDraft={handleGenerateDraft}
        isAdmin={isAdmin}
      />
    </>
  );
}
