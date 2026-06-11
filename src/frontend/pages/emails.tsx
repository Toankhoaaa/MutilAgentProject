import Head from "next/head";
import { useRef, useState } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import axios from "axios";
import Layout from "@/components/Layout";
import NotificationToast from "@/components/NotificationToast";
import api from "@/lib/axios";
import type { UserProfile, ProcessEmailsResult, GmailEmailItem, ProcessedEmailDetail } from "@/lib/types";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const CATEGORY_STYLES: Record<string, string> = {
  urgent: "bg-red-100 text-red-700",
  important: "bg-orange-100 text-orange-700",
  need_reply: "bg-blue-100 text-blue-700",
  newsletter: "bg-zinc-100 text-zinc-600",
  spam: "bg-zinc-200 text-zinc-500",
};

function CategoryBadge({ category }: { category: string }) {
  const cls = CATEGORY_STYLES[category.toLowerCase()] ?? "bg-zinc-100 text-zinc-600";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${cls}`}>
      {category}
    </span>
  );
}

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

  // Inbox state
  const [inboxEmails, setInboxEmails] = useState<GmailEmailItem[] | null>(null);
  const [loadingInbox, setLoadingInbox] = useState(false);
  const [inboxError, setInboxError] = useState<string | null>(null);

  // Processing state
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<ProcessEmailsResult | null>(null);
  const [abortedToast, setAbortedToast] = useState(false);
  const processingControllerRef = useRef<AbortController | null>(null);
  const processingTaskIdRef = useRef<string | null>(null);

  // Spam cleanup state
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const { data: user, error: authError } = useSWR<UserProfile>("/auth/me", fetcher, {
    onError: () => router.replace("/login"),
    revalidateOnFocus: false,
  });

  if (authError) return null;

  const handleLoadInbox = async () => {
    setLoadingInbox(true);
    setInboxError(null);
    try {
      const res = await api.get<GmailEmailItem[]>("/emails/list?limit=20");
      setInboxEmails(res.data);
    } catch {
      setInboxError("Không thể tải inbox. Kiểm tra kết nối Gmail.");
    } finally {
      setLoadingInbox(false);
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
      api.post(`/tasks/${taskId}/cancel`).catch(() => {});
    }
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
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-800">Inbox</h2>
                <p className="text-xs text-zinc-400 mt-0.5">Xem email từ Gmail — không lưu vào database</p>
              </div>
              <button
                onClick={handleLoadInbox}
                disabled={loadingInbox}
                className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {loadingInbox ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-zinc-400 border-t-transparent animate-spin" />
                    Đang tải…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    {inboxEmails ? "Làm mới" : "Tải Inbox"}
                  </>
                )}
              </button>
            </div>

            {inboxError && (
              <p className="text-sm text-rose-600 bg-rose-50 px-3 py-2 rounded-lg border border-rose-100">
                {inboxError}
              </p>
            )}

            {inboxEmails && inboxEmails.length === 0 && (
              <p className="text-sm text-zinc-400 text-center py-6">Inbox trống.</p>
            )}

            {inboxEmails && inboxEmails.length > 0 && (
              <div className="divide-y divide-zinc-100">
                {inboxEmails.map((email) => (
                  <div key={email.gmail_message_id} className="py-3 flex gap-3 items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2 mb-0.5">
                        <span className="text-sm font-medium text-zinc-800 truncate">
                          {email.sender || "—"}
                        </span>
                        <span className="text-xs text-zinc-400 shrink-0">{formatDate(email.date)}</span>
                      </div>
                      <p className="text-sm text-zinc-700 truncate">{email.subject || "(no subject)"}</p>
                      {email.snippet && (
                        <p className="text-xs text-zinc-400 truncate mt-0.5">{email.snippet}</p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {!inboxEmails && !loadingInbox && !inboxError && (
              <p className="text-sm text-zinc-400 text-center py-6">
                Nhấn "Tải Inbox" để xem email.
              </p>
            )}
          </section>

          {/* ── AI Processing Pipeline ── */}
          <section className="card">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-800">AI Email Pipeline</h2>
                <p className="text-xs text-zinc-400 mt-0.5">Phân loại email và tạo nháp trả lời tự động</p>
              </div>
              <div className="flex items-center gap-2">
                {processing && (
                  <button
                    onClick={handleAbortProcessing}
                    className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-rose-600 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors"
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
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                          d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                      </svg>
                      Process Emails
                    </>
                  )}
                </button>
              </div>
            </div>

            {abortedToast && (
              <div className="flex items-center gap-2 mb-4 px-3 py-2 text-sm rounded-lg bg-amber-50 text-amber-700 border border-amber-100">
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
                    <div key={label} className="text-center bg-zinc-50 rounded-lg py-3">
                      <p className={`text-2xl font-bold ${label === "Failed" && value > 0 ? "text-rose-600" : "text-zinc-900"}`}>
                        {value}
                      </p>
                      <p className="text-xs text-zinc-400 mt-0.5">{label}</p>
                    </div>
                  ))}
                </div>

                {/* Per-email results */}
                {processResult.processed_emails.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wide mb-3">
                      Chi tiết từng email
                    </h3>
                    <div className="divide-y divide-zinc-100 -mx-4 sm:mx-0 sm:rounded-lg sm:border sm:border-zinc-100 overflow-hidden">
                      {processResult.processed_emails.map((item: ProcessedEmailDetail) => (
                        <div key={item.gmail_message_id} className="px-4 py-3 bg-white hover:bg-zinc-50 transition-colors">
                          <div className="flex items-start justify-between gap-3 mb-1">
                            <div className="min-w-0 flex-1">
                              <p className="text-sm font-medium text-zinc-800 truncate">
                                {item.subject || "(no subject)"}
                              </p>
                              <p className="text-xs text-zinc-400 truncate">{item.sender || "—"}</p>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <CategoryBadge category={item.category} />
                              <span className="text-xs text-zinc-400">P{item.priority_score}</span>
                              {item.has_draft && (
                                <span className="inline-flex items-center gap-1 text-xs text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                  </svg>
                                  Draft
                                </span>
                              )}
                            </div>
                          </div>
                          <p className="text-xs text-zinc-500 line-clamp-2">{item.summary}</p>
                          {item.draft_subject && (
                            <p className="text-xs text-zinc-400 mt-1 italic">
                              Nháp: {item.draft_subject}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {processResult.errors.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-zinc-100">
                    <p className="text-xs font-semibold text-rose-600 mb-2">Errors</p>
                    <ul className="space-y-1">
                      {processResult.errors.map((err, i) => (
                        <li key={i} className="text-xs text-zinc-500 font-mono bg-zinc-50 px-2 py-1 rounded">
                          {JSON.stringify(err)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}

            {!processResult && !processing && (
              <p className="text-sm text-zinc-400 text-center py-6">
                Nhấn "Process Emails" để chạy AI pipeline.
              </p>
            )}
          </section>

          {/* ── Spam Cleanup ── */}
          <section className="card">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-sm font-semibold text-zinc-800 mb-1">Spam Cleanup</h2>
                <p className="text-xs text-zinc-400">Chuyển toàn bộ thư mục SPAM sang thùng rác.</p>
              </div>
              <button
                onClick={handleCleanupSpam}
                disabled={cleanupLoading}
                className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed text-rose-600 border-rose-200 hover:bg-rose-50 whitespace-nowrap"
              >
                {cleanupLoading ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-rose-400 border-t-transparent animate-spin" />
                    Cleaning…
                  </>
                ) : (
                  <>
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                    Clean Up SPAM
                  </>
                )}
              </button>
            </div>
            {cleanupResult && (
              <div className={`mt-4 flex items-center gap-2 text-sm px-3 py-2 rounded-lg ${
                cleanupResult.type === "success"
                  ? "bg-emerald-50 text-emerald-700 border border-emerald-100"
                  : "bg-rose-50 text-rose-700 border border-rose-100"
              }`}>
                {cleanupResult.type === "success" ? (
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                )}
                {cleanupResult.message}
              </div>
            )}
          </section>

        </div>
      </Layout>

      <NotificationToast />
    </>
  );
}
