import Head from "next/head";
import { useState, useRef, useCallback } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import Layout from "@/components/Layout";
import api from "@/lib/axios";
import type { KnowledgeDocument, KnowledgeListResponse, UserProfile } from "@/lib/types";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

// ── Icons ─────────────────────────────────────────────────────────────────────

const UploadIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
  </svg>
);

const EditIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
  </svg>
);

const TrashIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
  </svg>
);

const CloseIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

// ── Status badge ──────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: KnowledgeDocument["status"] }) {
  const cfg = {
    processing: "bg-amber-50 text-amber-700 border-amber-200",
    ready: "bg-emerald-50 text-emerald-700 border-emerald-200",
    failed: "bg-rose-50 text-rose-700 border-rose-200",
  }[status] ?? "bg-slate-50 text-slate-600 border-slate-200";

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg}`}>
      {status === "processing" && (
        <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
      )}
      {status}
    </span>
  );
}

// ── Modal shell ───────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <CloseIcon />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function AdminKnowledgeBasePage() {
  const router = useRouter();

  const { data: user, error: authError } = useSWR<UserProfile>("/auth/me", fetcher, {
    onError: () => router.replace("/login"),
    revalidateOnFocus: false,
  });

  const { data: listData, isLoading, mutate } = useSWR<KnowledgeListResponse>(
    "/knowledge/",
    fetcher,
    { refreshInterval: 5_000 },
  );

  // ── Upload modal state ──────────────────────────────────────────────────────
  const [showUpload, setShowUpload] = useState(false);
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadSource, setUploadSource] = useState("");
  const [uploadNotes, setUploadNotes] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  // ── Edit modal state ────────────────────────────────────────────────────────
  const [editDoc, setEditDoc] = useState<KnowledgeDocument | null>(null);
  const [editNotes, setEditNotes] = useState("");
  const [editSummary, setEditSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // ── Delete confirm state ────────────────────────────────────────────────────
  const [deleteDoc, setDeleteDoc] = useState<KnowledgeDocument | null>(null);
  const [deleting, setDeleting] = useState(false);

  if (authError) return null;

  // ── Handlers ────────────────────────────────────────────────────────────────

  const openEdit = (doc: KnowledgeDocument) => {
    setEditDoc(doc);
    setEditNotes(doc.notes ?? "");
    setEditSummary(doc.ai_summary ?? "");
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!editDoc) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.put(`/knowledge/${editDoc.id}`, {
        ai_summary: editSummary || null,
        notes: editNotes || null,
      });
      await mutate();
      setEditDoc(null);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message;
      setSaveError(msg ?? "Save failed.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteDoc) return;
    setDeleting(true);
    try {
      await api.delete(`/knowledge/${deleteDoc.id}`);
      await mutate();
      setDeleteDoc(null);
    } catch {
      // Silently ignore — the item may already be gone
      setDeleteDoc(null);
    } finally {
      setDeleting(false);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragging(false);
    const f = e.dataTransfer.files[0];
    if (!f) return;
    const ext = f.name.substring(f.name.lastIndexOf(".")).toLowerCase();
    if (ext !== ".pdf" && ext !== ".docx") {
      setUploadError("Only PDF and DOCX files are accepted.");
      setUploadFile(null);
      return;
    }
    setUploadError(null);
    setUploadFile(f);
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    setUploadError(null);
    if (!f) { setUploadFile(null); return; }
    const ext = f.name.substring(f.name.lastIndexOf(".")).toLowerCase();
    if (ext !== ".pdf" && ext !== ".docx") {
      setUploadError("Only PDF and DOCX files are accepted.");
      setUploadFile(null);
      return;
    }
    setUploadFile(f);
  };

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    setUploadError(null);
    setUploadProgress(0);
    try {
      const form = new FormData();
      form.append("file", uploadFile);
      if (uploadSource.trim()) form.append("source_email", uploadSource.trim());
      if (uploadNotes.trim()) form.append("notes", uploadNotes.trim());
      await api.post("/knowledge/upload", form, {
        headers: { "Content-Type": undefined },
        onUploadProgress: (event) => {
          if (event.total) setUploadProgress(Math.round((event.loaded / event.total) * 100));
        },
      });
      await mutate();
      setShowUpload(false);
      setUploadFile(null);
      setUploadSource("");
      setUploadNotes("");
      setUploadProgress(0);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: { message?: string } } } })
        ?.response?.data?.error?.message;
      setUploadError(msg ?? "Upload failed. Please try again.");
    } finally {
      setUploading(false);
    }
  };

  const closeUpload = useCallback(() => {
    setShowUpload(false);
    setUploadFile(null);
    setUploadSource("");
    setUploadNotes("");
    setUploadError(null);
    setUploadProgress(0);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }, []);

  const docs = listData?.items ?? [];

  return (
    <>
      <Head>
        <title>Knowledge Base — Admin</title>
      </Head>
      <Layout user={user ?? null}>
        <div className="max-w-5xl mx-auto py-8 px-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">Knowledge Base</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Documents indexed for AI retrieval. Upload PDF or DOCX to extend the assistant&apos;s knowledge.
              </p>
            </div>
            <button
              onClick={() => setShowUpload(true)}
              className="btn-primary flex items-center gap-2"
            >
              <UploadIcon />
              Upload Document
            </button>
          </div>

          {/* Table */}
          <div className="card overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-sm text-slate-400">
                <span className="w-4 h-4 rounded-full border-2 border-indigo-300 border-t-transparent animate-spin mr-2" />
                Loading documents…
              </div>
            ) : docs.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <svg className="w-10 h-10 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <p className="text-sm">No documents yet. Upload a PDF or DOCX to get started.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">File</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Source</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Chunks</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-80">AI Summary</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Uploaded</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {docs.map((doc) => (
                    <tr key={doc.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800 max-w-[180px] truncate" title={doc.filename}>
                        {doc.filename}
                      </td>
                      <td className="px-4 py-3 text-slate-500 max-w-[160px] truncate" title={doc.source_email ?? ""}>
                        {doc.source_email ?? <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-right text-slate-600 tabular-nums text-xs">
                        {doc.chunk_count != null ? doc.chunk_count : <span className="text-slate-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-slate-600 text-xs leading-relaxed">
                        {doc.ai_summary ? (
                          <span className="line-clamp-2">{doc.ai_summary}</span>
                        ) : (
                          <span className="text-slate-300 italic">
                            {doc.status === "processing" ? "Generating…" : "No summary"}
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={doc.status} />
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs whitespace-nowrap">
                        {new Date(doc.upload_date).toLocaleDateString("en-GB", {
                          day: "2-digit", month: "short", year: "numeric",
                        })}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openEdit(doc)}
                            title="Edit notes / summary"
                            className="p-1.5 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                          >
                            <EditIcon />
                          </button>
                          <button
                            onClick={() => setDeleteDoc(doc)}
                            title="Delete document"
                            className="p-1.5 rounded-md text-slate-400 hover:text-rose-600 hover:bg-rose-50 transition-colors"
                          >
                            <TrashIcon />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {docs.length > 0 && (
              <div className="px-4 py-2.5 text-xs text-slate-400 border-t border-slate-100">
                {listData?.total ?? 0} document{(listData?.total ?? 0) !== 1 ? "s" : ""} total
              </div>
            )}
          </div>
        </div>
      </Layout>

      {/* ── Upload modal ──────────────────────────────────────────────────────── */}
      {showUpload && (
        <Modal title="Upload Document" onClose={closeUpload}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                File <span className="text-slate-400 font-normal">(PDF or DOCX)</span>
              </label>
              <input
                ref={fileInputRef}
                type="file"
                accept=".pdf,.docx"
                onChange={handleFileChange}
                disabled={uploading}
                className="hidden"
              />
              {/* Drag-and-drop zone */}
              <div
                className={`relative border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? "border-indigo-400 bg-indigo-50"
                    : uploadFile
                    ? "border-emerald-300 bg-emerald-50/50"
                    : "border-slate-200 hover:border-indigo-300 hover:bg-slate-50"
                } ${uploading ? "pointer-events-none opacity-60" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => !uploading && fileInputRef.current?.click()}
              >
                {uploadFile ? (
                  <div className="flex flex-col items-center gap-1">
                    <svg className="w-8 h-8 text-emerald-500 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm font-medium text-slate-700">{uploadFile.name}</p>
                    <p className="text-xs text-slate-400">{(uploadFile.size / 1024).toFixed(1)} KB — click to change</p>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-1.5">
                    <svg className="w-9 h-9 text-slate-300 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                        d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-8l-4-4m0 0L8 8m4-4v12" />
                    </svg>
                    <p className="text-sm text-slate-500">
                      Drag & drop a PDF or DOCX, or{" "}
                      <span className="text-indigo-600 underline">browse</span>
                    </p>
                    <p className="text-xs text-slate-400">Max file size: 50 MB</p>
                  </div>
                )}
              </div>

              {/* Upload progress bar */}
              {uploading && (
                <div className="mt-3">
                  <div className="flex items-center justify-between text-xs text-slate-500 mb-1">
                    <span>Uploading…</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="h-full bg-indigo-500 rounded-full transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                  {uploadProgress === 100 && (
                    <p className="text-xs text-indigo-600 mt-1.5 flex items-center gap-1">
                      <span className="w-3 h-3 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
                      Processing document — chunking &amp; embedding…
                    </p>
                  )}
                </div>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Source <span className="text-slate-400 font-normal">(optional — e.g. sender email / subject)</span>
              </label>
              <input
                type="text"
                value={uploadSource}
                onChange={(e) => setUploadSource(e.target.value)}
                disabled={uploading}
                placeholder="e.g. hr@company.com — Onboarding Materials"
                className="block w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">
                Notes <span className="text-slate-400 font-normal">(optional)</span>
              </label>
              <textarea
                value={uploadNotes}
                onChange={(e) => setUploadNotes(e.target.value)}
                disabled={uploading}
                rows={2}
                placeholder="Add context about this document…"
                className="block w-full text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50"
              />
            </div>

            {uploadError && <p className="text-sm text-rose-600">{uploadError}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={closeUpload}
                disabled={uploading}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleUpload}
                disabled={!uploadFile || uploading}
                className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {uploading ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Uploading…
                  </>
                ) : (
                  <>
                    <UploadIcon />
                    Upload
                  </>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Edit modal ────────────────────────────────────────────────────────── */}
      {editDoc && (
        <Modal title={`Edit — ${editDoc.filename}`} onClose={() => setEditDoc(null)}>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">AI Summary</label>
              <textarea
                value={editSummary}
                onChange={(e) => setEditSummary(e.target.value)}
                rows={4}
                placeholder="AI-generated summary — edit if needed…"
                className="block w-full text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes</label>
              <textarea
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                rows={3}
                placeholder="Add your own notes about this document…"
                className="block w-full text-sm border border-slate-200 rounded-lg px-3 py-2 resize-none focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>

            {saveError && <p className="text-sm text-rose-600">{saveError}</p>}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setEditDoc(null)}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Saving…
                  </>
                ) : "Save Changes"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Delete confirmation ───────────────────────────────────────────────── */}
      {deleteDoc && (
        <Modal title="Delete Document" onClose={() => setDeleteDoc(null)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              This will permanently remove{" "}
              <span className="font-medium text-slate-800">{deleteDoc.filename}</span>{" "}
              from the knowledge base and ChromaDB. This action cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteDoc(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-lg bg-rose-600 text-white hover:bg-rose-700 flex items-center gap-2 disabled:opacity-50 transition-colors"
              >
                {deleting ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Deleting…
                  </>
                ) : (
                  <>
                    <TrashIcon />
                    Delete
                  </>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
