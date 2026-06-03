import Head from "next/head";
import { useState, useRef } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import Layout from "@/components/Layout";
import api from "@/lib/axios";
import type { UserProfile } from "@/lib/types";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const ALLOWED_EXTENSIONS = [".pdf", ".docx"];

interface IngestResponse {
  success: boolean;
  filename: string;
  chunks_added: number;
}

export default function AdminKnowledgeBasePage() {
  const router = useRouter();

  const { data: user, error: authError } = useSWR<UserProfile>("/auth/me", fetcher, {
    onError: () => router.replace("/login"),
    revalidateOnFocus: false,
  });

  const [file, setFile] = useState<File | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  if (authError) return null;

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setError(null);
    setSuccessMsg(null);
    if (!selected) {
      setFile(null);
      return;
    }
    const ext = selected.name.substring(selected.name.lastIndexOf(".")).toLowerCase();
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      setError("Only PDF and DOCX files are accepted.");
      setFile(null);
      return;
    }
    setFile(selected);
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await api.post<IngestResponse>("/admin/documents", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setSuccessMsg(
        `"${res.data.filename}" ingested — ${res.data.chunks_added} chunks added to the knowledge base.`,
      );
      setFile(null);
      if (inputRef.current) inputRef.current.value = "";
    } catch (err: unknown) {
      const detail = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message;
      setError(detail ?? "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  return (
    <>
      <Head>
        <title>Knowledge Base — Admin</title>
      </Head>
      <Layout user={user ?? null}>
        <div className="max-w-2xl mx-auto py-8 px-4">
          <div className="mb-6">
            <h1 className="text-xl font-semibold text-slate-800">Knowledge Base</h1>
            <p className="text-sm text-slate-500 mt-1">
              Upload documents to extend the AI assistant&apos;s knowledge. Accepted formats: PDF, DOCX.
            </p>
          </div>

          <div className="card p-6 space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Select document
              </label>
              <input
                ref={inputRef}
                type="file"
                accept=".pdf,.docx"
                onChange={handleFileChange}
                disabled={uploading}
                className="block w-full text-sm text-slate-700 border border-slate-200 rounded-lg px-3 py-2 bg-white file:mr-3 file:py-1.5 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-medium file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer"
              />
              {file && (
                <p className="mt-1.5 text-xs text-slate-500">
                  Selected:{" "}
                  <span className="font-medium text-slate-700">{file.name}</span>{" "}
                  ({(file.size / 1024).toFixed(1)} KB)
                </p>
              )}
            </div>

            {successMsg && (
              <div className="flex items-start gap-2 rounded-lg bg-emerald-50 border border-emerald-100 px-3 py-2.5">
                <svg
                  className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
                <p className="text-sm text-emerald-700 font-medium">{successMsg}</p>
              </div>
            )}

            {error && <p className="text-sm text-rose-600">{error}</p>}

            <button
              onClick={handleUpload}
              disabled={!file || uploading}
              className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {uploading ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Uploading…
                </>
              ) : (
                <>
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12"
                    />
                  </svg>
                  Upload Document
                </>
              )}
            </button>
          </div>
        </div>
      </Layout>
    </>
  );
}
