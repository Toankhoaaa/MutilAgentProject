import Head from "next/head";
import { useRef, useState } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import axios from "axios";
import Layout from "@/components/Layout";
import NotificationToast from "@/components/NotificationToast";
import api from "@/lib/axios";
import type { UserProfile, ProcessEmailsResult } from "@/lib/types";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export default function EmailsPage() {
  const router = useRouter();
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<ProcessEmailsResult | null>(null);
  const [abortedToast, setAbortedToast] = useState(false);
  const [cleanupLoading, setCleanupLoading] = useState(false);
  const [cleanupResult, setCleanupResult] = useState<{ message: string; type: "success" | "error" } | null>(null);

  const processingControllerRef = useRef<AbortController | null>(null);
  const processingTaskIdRef = useRef<string | null>(null);

  const { data: user, error: authError } = useSWR<UserProfile>("/auth/me", fetcher, {
    onError: () => router.replace("/login"),
    revalidateOnFocus: false,
  });

  if (authError) return null;

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
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-7">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Email Pipeline</h1>
            <p className="text-sm text-zinc-400 mt-0.5">Trigger AI processing on your Gmail inbox</p>
          </div>
          <div className="flex items-center gap-2">
            {processing && (
              <button
                onClick={handleAbortProcessing}
                className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-rose-600 bg-rose-50 border border-rose-200 rounded-lg hover:bg-rose-100 transition-colors"
              >
                🛑 Dừng
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
                      d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  Process Emails
                </>
              )}
            </button>
          </div>
        </div>

        {abortedToast && (
          <div className="flex items-center gap-2 mb-4 px-3 py-2 text-sm rounded-lg bg-amber-50 text-amber-700 border border-amber-100">
            <span>🛑</span>
            Đã hủy tạo nội dung
          </div>
        )}

        {/* Process result */}
        {processResult && (
          <div className="card mb-6">
            <h2 className="text-sm font-semibold text-zinc-700 mb-4">Last Run Results</h2>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              {([
                ["Fetched", processResult.fetched],
                ["Processed", processResult.processed],
                ["Drafts Created", processResult.drafts_created],
                ["Failed", processResult.failed],
              ] as [string, number][]).map(([label, value]) => (
                <div key={label} className="text-center">
                  <p className={`text-2xl font-bold ${label === "Failed" && value > 0 ? "text-rose-600" : "text-zinc-900"}`}>
                    {value}
                  </p>
                  <p className="text-xs text-zinc-400 mt-0.5">{label}</p>
                </div>
              ))}
            </div>
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
          </div>
        )}

        {/* Spam cleanup */}
        <div className="card">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-sm font-semibold text-zinc-800 mb-1">Spam Cleanup</h2>
              <p className="text-xs text-zinc-400">Move all messages in your Gmail SPAM folder to trash.</p>
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
        </div>
      </Layout>

      <NotificationToast />
    </>
  );
}
