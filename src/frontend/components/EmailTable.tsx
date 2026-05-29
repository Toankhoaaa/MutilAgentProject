import { useState } from "react";
import type { Email } from "@/lib/types";
import api from "@/lib/axios";

interface EmailTableProps {
  emails: Email[];
  total: number;
  limit: number;
  offset: number;
  loading?: boolean;
  onPageChange: (offset: number) => void;
  onFilterChange: (category: string) => void;
  category: string;
  onOpenDraft: (email: Email) => void;
  onViewDetail: (email: Email) => void;
  onRefresh: () => void;
}

const CATEGORY_OPTIONS = [
  { value: "all", label: "All" },
  { value: "urgent", label: "Urgent" },
  { value: "important", label: "Important" },
  { value: "need_reply", label: "Need Reply" },
  { value: "newsletter", label: "Newsletter" },
  { value: "spam", label: "Spam" },
];

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short", day: "numeric", hour: "2-digit", minute: "2-digit",
  });
}

function formatCategory(cat: string): string {
  return cat.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function PriorityDots({ score }: { score: number | null }) {
  if (score == null) return <span className="text-slate-300">—</span>;
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`w-2 h-2 rounded-full ${i <= score ? "bg-indigo-500" : "bg-slate-200"}`}
        />
      ))}
    </div>
  );
}

export default function EmailTable({
  emails,
  total,
  limit,
  offset,
  loading,
  onPageChange,
  onFilterChange,
  category,
  onOpenDraft,
  onViewDetail,
  onRefresh,
}: EmailTableProps) {
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const totalPages = Math.ceil(total / limit);
  const currentPage = Math.floor(offset / limit) + 1;

  const doAction = async (emailId: string, action: "archive" | "trash" | "star") => {
    setActionLoading(`${emailId}-${action}`);
    try {
      await api.put(`/emails/${emailId}/${action}`);
      onRefresh();
    } catch {
      // silently ignore — user can retry
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="card" id="emails">
      {/* Table header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Emails</h2>
          <p className="text-xs text-slate-400 mt-0.5">{total} total</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={category}
            onChange={(e) => onFilterChange(e.target.value)}
            className="text-sm border border-slate-200 rounded-lg px-3 py-1.5 text-slate-700 bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200"
          >
            {CATEGORY_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto -mx-5">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              <th className="text-left px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Sender
              </th>
              <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Subject
              </th>
              <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden md:table-cell">
                Category
              </th>
              <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden lg:table-cell">
                Priority
              </th>
              <th className="text-left px-3 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide hidden sm:table-cell">
                Date
              </th>
              <th className="text-right px-5 py-2.5 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Actions
              </th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i} className="border-b border-slate-50">
                  {[1, 2, 3, 4, 5, 6].map((j) => (
                    <td key={j} className="px-3 py-3">
                      <div className="h-4 bg-slate-100 animate-pulse rounded" />
                    </td>
                  ))}
                </tr>
              ))
            ) : emails.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-5 py-12 text-center text-slate-400 text-sm">
                  No emails found.
                </td>
              </tr>
            ) : (
              emails.map((email) => {
                const cat = email.classification?.category;
                const hasDraft = !!email.draft;
                const isSent = email.draft?.is_sent;
                return (
                  <tr
                    key={email.id}
                    className="border-b border-slate-100 hover:bg-slate-50 transition-colors group"
                  >
                    <td className="px-5 py-3.5 max-w-[140px] border-l-2 border-l-transparent group-hover:border-l-indigo-400 transition-colors">
                      <p className="truncate text-slate-700 font-medium text-xs">
                        {email.sender ?? "Unknown"}
                      </p>
                    </td>
                    <td className="px-3 py-3.5 max-w-[200px]">
                      <p className="truncate text-slate-700 text-xs">{email.subject ?? "(No subject)"}</p>
                    </td>
                    <td className="px-3 py-3.5 hidden md:table-cell">
                      {cat ? (
                        <span className={`category-badge category-${cat}`}>{formatCategory(cat)}</span>
                      ) : (
                        <span className="text-slate-300 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-3 py-3.5 hidden lg:table-cell">
                      <PriorityDots score={email.classification?.priority_score ?? null} />
                    </td>
                    <td className="px-3 py-3.5 text-xs text-slate-400 hidden sm:table-cell whitespace-nowrap">
                      {formatDate(email.received_at)}
                    </td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center justify-end gap-1">
                        <button
                          onClick={() => onViewDetail(email)}
                          title="View email detail & AI analysis"
                          className="action-btn text-slate-400 hover:text-indigo-500"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                          </svg>
                        </button>
                        {hasDraft && (
                          <button
                            onClick={() => onOpenDraft(email)}
                            title={isSent ? "View sent draft" : "Edit & send draft"}
                            className={`action-btn ${isSent ? "text-emerald-500" : "text-indigo-500"}`}
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                                d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                            </svg>
                          </button>
                        )}
                        <button
                          onClick={() => doAction(email.id, "star")}
                          disabled={actionLoading === `${email.id}-star`}
                          title="Star"
                          className={`action-btn ${email.labels?.includes("STARRED") ? "text-amber-400" : "text-slate-300"}`}
                        >
                          <svg className="w-4 h-4" fill={email.labels?.includes("STARRED") ? "currentColor" : "none"} stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => doAction(email.id, "archive")}
                          disabled={actionLoading === `${email.id}-archive`}
                          title="Archive"
                          className="action-btn text-slate-300 hover:text-slate-500"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                          </svg>
                        </button>
                        <button
                          onClick={() => doAction(email.id, "trash")}
                          disabled={actionLoading === `${email.id}-trash`}
                          title="Trash"
                          className="action-btn text-slate-300 hover:text-rose-400"
                        >
                          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
          <p className="text-xs text-slate-400">
            Page {currentPage} of {totalPages}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(Math.max(0, offset - limit))}
              disabled={offset === 0}
              className="btn-secondary text-xs py-1 px-2 disabled:opacity-40"
            >
              ← Prev
            </button>
            <button
              onClick={() => onPageChange(offset + limit)}
              disabled={offset + limit >= total}
              className="btn-secondary text-xs py-1 px-2 disabled:opacity-40"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
