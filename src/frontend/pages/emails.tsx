import Head from "next/head";
import { useState, useCallback } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import Layout from "@/components/Layout";
import EmailTable from "@/components/EmailTable";
import DraftModal from "@/components/DraftModal";
import EmailDetailSheet from "@/components/EmailDetailSheet";
import NotificationToast from "@/components/NotificationToast";
import api from "@/lib/axios";
import type {
  UserProfile,
  Email,
  PaginatedResponse,
  ProcessEmailsResult,
} from "@/lib/types";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export default function EmailsPage() {
  const router = useRouter();
  const [emailOffset, setEmailOffset] = useState(0);
  const [emailCategory, setEmailCategory] = useState("all");
  const [selectedEmail, setSelectedEmail] = useState<Email | null>(null);
  const [detailEmail, setDetailEmail] = useState<Email | null>(null);
  const [processing, setProcessing] = useState(false);
  const [processResult, setProcessResult] = useState<ProcessEmailsResult | null>(null);

  const { data: user, error: authError } = useSWR<UserProfile>("/auth/me", fetcher, {
    onError: () => router.replace("/login"),
    revalidateOnFocus: false,
  });

  const emailParams = `/emails/?limit=20&offset=${emailOffset}&category=${emailCategory}`;
  const { data: emailData, isLoading: emailsLoading, mutate: mutateEmails } =
    useSWR<PaginatedResponse<Email>>(emailParams, fetcher);

  const handleFilterChange = useCallback((cat: string) => {
    setEmailCategory(cat);
    setEmailOffset(0);
  }, []);

  const handleRefresh = useCallback(() => {
    mutateEmails();
  }, [mutateEmails]);

  if (authError) return null;

  const handleProcessEmails = async () => {
    setProcessing(true);
    setProcessResult(null);
    try {
      const res = await api.post<ProcessEmailsResult>("/emails/process");
      setProcessResult(res.data);
      handleRefresh();
    } catch {
      // Error shown via processResult null state
    } finally {
      setProcessing(false);
    }
  };

  return (
    <>
      <Head>
        <title>Emails - Email Orchestrator</title>
      </Head>

      <Layout user={user ?? null}>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-7">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-zinc-900">Emails</h1>
            <p className="text-sm text-zinc-400 mt-0.5">Inbox processed by the AI pipeline</p>
          </div>
          <div className="flex items-center gap-2.5">
            {processResult && (
              <span className="text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-100/80 px-3 py-1.5 rounded-full">
                Fetched {processResult.fetched}, processed {processResult.processed},{" "}
                {processResult.drafts_created} draft(s)
              </span>
            )}
            <button
              onClick={handleProcessEmails}
              disabled={processing}
              className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {processing ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Processing
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

        <EmailTable
          emails={emailData?.items ?? []}
          total={emailData?.total ?? 0}
          limit={emailData?.limit ?? 20}
          offset={emailOffset}
          loading={emailsLoading}
          category={emailCategory}
          onPageChange={setEmailOffset}
          onFilterChange={handleFilterChange}
          onOpenDraft={setSelectedEmail}
          onViewDetail={setDetailEmail}
          onRefresh={handleRefresh}
        />
      </Layout>

      <EmailDetailSheet
        email={detailEmail}
        onClose={() => setDetailEmail(null)}
      />

      <DraftModal
        email={selectedEmail}
        onClose={() => setSelectedEmail(null)}
        onSent={handleRefresh}
      />

      <NotificationToast />
    </>
  );
}
