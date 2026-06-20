import { useState } from "react";
import useSWR from "swr";
import api from "@/lib/axios";
import type { AdminUser, AdminUserListResponse, UserActivityResponse } from "@/lib/types";
import EditUserModal from "./admin/EditUserModal";

const LIMIT = 20;

const fetcher = (url: string) => api.get(url).then((r) => r.data);

// ── Helpers ──────────────────────────────────────────────────────────────────

function tierBadgeClass(tier: string): string {
  if (tier === "PRO") return "bg-blue-100 text-blue-700";
  if (tier === "ENTERPRISE") return "bg-violet-100 text-violet-700";
  return "bg-zinc-100 text-zinc-600";
}

function statusBadgeClass(active: boolean): string {
  return active ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700";
}

function progressBarClass(pct: number): string {
  if (pct >= 85) return "bg-rose-500";
  if (pct >= 60) return "bg-amber-400";
  return "bg-emerald-500";
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("en-GB", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  } catch {
    return "—";
  }
}

function relativeTime(iso: string | null): string {
  if (!iso) return "Never";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return formatDate(iso);
}

function auditDotClass(status: string | null): string {
  if (status === "success") return "bg-emerald-400";
  if (status === "failed") return "bg-rose-400";
  return "bg-zinc-300";
}

function auditTextClass(status: string | null): string {
  if (status === "success") return "text-emerald-600";
  if (status === "failed") return "text-rose-600";
  return "text-zinc-400";
}

// ── Activity side-sheet ───────────────────────────────────────────────────────

interface ActivitySheetProps {
  user: AdminUser;
  onClose: () => void;
  onEdit: () => void;
}

function ActivitySheet({ user, onClose, onEdit }: ActivitySheetProps) {
  const { data, isLoading } = useSWR<UserActivityResponse>(
    `/admin/users/${user.id}/activity`,
    fetcher,
    { revalidateOnFocus: false }
  );

  return (
    <>
      <div className="fixed inset-0 bg-black/20 z-40" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className="fixed right-0 top-0 h-full w-full max-w-sm bg-white shadow-xl z-50 flex flex-col"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-100 shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold"
              style={{ background: "linear-gradient(135deg, #3B82F6 0%, #6366F1 100%)" }}
            >
              {(user.display_name ?? user.email)[0].toUpperCase()}
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-zinc-900 truncate">
                {user.display_name ?? (
                  <span className="text-zinc-400 italic font-normal text-xs">No name</span>
                )}
              </p>
              <p className="text-xs text-zinc-400 truncate">{user.email}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-zinc-100 transition-colors shrink-0 ml-2"
            aria-label="Close"
          >
            <svg className="w-5 h-5 text-zinc-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tier + status row */}
        <div className="flex items-center gap-2 px-5 pt-3 pb-0 shrink-0">
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tierBadgeClass(user.subscription_tier)}`}>
            {user.subscription_tier}
          </span>
          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass(user.is_active)}`}>
            {user.is_active ? "ACTIVE" : "SUSPENDED"}
          </span>
          {user.tier_expires_at && (
            <span className="text-xs text-zinc-400 ml-auto">
              Expires {formatDate(user.tier_expires_at)}
            </span>
          )}
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">

          {/* Metrics cards */}
          <div className="grid grid-cols-3 gap-2.5">
            {isLoading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="rounded-lg border border-zinc-100 p-3 animate-pulse">
                  <div className="h-5 bg-zinc-100 rounded mb-1.5 w-3/4 mx-auto" />
                  <div className="h-2.5 bg-zinc-50 rounded w-2/3 mx-auto" />
                </div>
              ))
            ) : (
              <>
                <div className="rounded-lg border border-zinc-100 p-3 text-center">
                  <p className="text-lg font-bold text-zinc-900">{data?.emails_processed ?? 0}</p>
                  <p className="text-[0.625rem] text-zinc-400 leading-tight mt-0.5">
                    Emails<br />Processed
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-100 p-3 text-center">
                  <p className="text-lg font-bold text-zinc-900">{data?.drafts_created ?? 0}</p>
                  <p className="text-[0.625rem] text-zinc-400 leading-tight mt-0.5">
                    Drafts<br />Generated
                  </p>
                </div>
                <div className="rounded-lg border border-zinc-100 p-3 text-center">
                  <p className="text-sm font-bold text-zinc-900 leading-tight break-words">
                    {relativeTime(data?.last_active_at ?? null)}
                  </p>
                  <p className="text-[0.625rem] text-zinc-400 leading-tight mt-0.5">
                    Last<br />Active
                  </p>
                </div>
              </>
            )}
          </div>

          {/* Quota bar */}
          <div>
            <div className="flex items-center justify-between mb-1.5">
              <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide">
                Quota Usage
              </p>
              <span className="text-xs text-zinc-500 tabular-nums">
                {user.request_count} / {user.max_requests}
              </span>
            </div>
            {(() => {
              const pct = user.max_requests > 0
                ? Math.min(100, Math.round((user.request_count / user.max_requests) * 100))
                : 0;
              return (
                <div className="w-full bg-zinc-100 rounded-full h-2">
                  <div
                    className={`h-2 rounded-full transition-all ${progressBarClass(pct)}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              );
            })()}
          </div>

          {/* Audit timeline */}
          <div>
            <p className="text-xs font-medium text-zinc-400 uppercase tracking-wide mb-2.5">
              Recent Activity
            </p>
            {isLoading ? (
              <div className="space-y-2.5">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="animate-pulse flex gap-3">
                    <div className="w-1.5 h-1.5 rounded-full bg-zinc-200 mt-1.5 shrink-0" />
                    <div className="flex-1">
                      <div className="h-3.5 bg-zinc-100 rounded mb-1 w-3/4" />
                      <div className="h-2.5 bg-zinc-50 rounded w-1/2" />
                    </div>
                  </div>
                ))}
              </div>
            ) : !data?.recent_logs.length ? (
              <p className="text-sm text-zinc-400 text-center py-6">No activity logs yet.</p>
            ) : (
              <div>
                {data.recent_logs.map((log) => (
                  <div key={log.id} className="flex gap-3 py-2.5 border-b border-zinc-50 last:border-0">
                    <div className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${auditDotClass(log.status)}`} />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-2">
                        <p className="text-xs font-medium text-zinc-700 truncate">
                          {log.agent_name ?? "System"}
                          {log.action ? ` · ${log.action}` : ""}
                        </p>
                        <span className={`text-[0.625rem] font-medium shrink-0 ${auditTextClass(log.status)}`}>
                          {log.status ?? "—"}
                        </span>
                      </div>
                      <p className="text-[0.625rem] text-zinc-400 mt-0.5">
                        {relativeTime(log.created_at)}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer action */}
        <div className="px-5 py-4 border-t border-zinc-100 shrink-0">
          <button onClick={onEdit} className="btn-primary w-full">
            Edit User
          </button>
        </div>
      </div>
    </>
  );
}

// ── Delete confirmation dialog ────────────────────────────────────────────────

interface DeleteDialogProps {
  user: AdminUser;
  onSuspend: () => void;
  onHardDelete: () => void;
  onCancel: () => void;
  deleting: boolean;
}

function DeleteDialog({ user, onSuspend, onHardDelete, onCancel, deleting }: DeleteDialogProps) {
  const [confirmHard, setConfirmHard] = useState(false);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={onCancel}
    >
      <div
        className="bg-white rounded-xl shadow-xl border border-zinc-100 p-6 w-full max-w-xs mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5 text-center">
          <div className="w-10 h-10 rounded-full bg-rose-50 flex items-center justify-center mx-auto mb-3">
            <svg className="w-5 h-5 text-rose-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-sm font-semibold text-zinc-900">Remove User?</h2>
          <p className="text-xs text-zinc-400 mt-1 truncate">{user.email}</p>
        </div>

        {confirmHard && (
          <div className="mb-4 p-3 bg-rose-50 border border-rose-200 rounded-lg">
            <p className="text-xs text-rose-700 text-center font-medium">
              This permanently deletes the account and all associated data. This cannot be undone.
            </p>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <button
            onClick={onSuspend}
            disabled={deleting}
            className="w-full text-sm px-3 py-2 rounded-lg border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors disabled:opacity-50"
          >
            Suspend (Soft Delete)
          </button>
          {confirmHard ? (
            <button
              onClick={onHardDelete}
              disabled={deleting}
              className="w-full text-sm px-3 py-2 rounded-lg bg-rose-600 text-white hover:bg-rose-700 transition-colors disabled:opacity-50"
            >
              {deleting ? "Deleting…" : "Confirm Hard Delete"}
            </button>
          ) : (
            <button
              onClick={() => setConfirmHard(true)}
              disabled={deleting}
              className="w-full text-sm px-3 py-2 rounded-lg border border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100 transition-colors disabled:opacity-50"
            >
              Hard Delete
            </button>
          )}
          <button
            onClick={onCancel}
            disabled={deleting}
            className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export default function UserManagement() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [sheetUser, setSheetUser] = useState<AdminUser | null>(null);
  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [deleteUser, setDeleteUser] = useState<AdminUser | null>(null);
  const [deleting, setDeleting] = useState(false);

  const swrKey = `/admin/users?page=${page}&limit=${LIMIT}${
    search ? `&search=${encodeURIComponent(search)}` : ""
  }`;
  const { data, error, isLoading, mutate } = useSWR<AdminUserListResponse>(swrKey, fetcher);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;

  const handleSearch = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  const handleDelete = async (hard: boolean) => {
    if (!deleteUser) return;
    setDeleting(true);
    try {
      await api.delete(`/admin/users/${deleteUser.id}?hard=${hard}`);
      await mutate();
      if (sheetUser?.id === deleteUser.id) setSheetUser(null);
      setDeleteUser(null);
    } catch {
      setDeleteUser(null);
    } finally {
      setDeleting(false);
    }
  };

  const openEdit = (user: AdminUser) => {
    setSheetUser(null);
    setEditUser(user);
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-7">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">User Management</h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            {data
              ? `${data.total} user${data.total !== 1 ? "s" : ""} total`
              : "Loading…"}
          </p>
        </div>
        <form onSubmit={handleSearch} className="flex gap-2">
          <input
            type="text"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by email or name…"
            className="text-sm px-3 py-2 rounded-lg border border-zinc-200 bg-white text-zinc-800 placeholder-zinc-400 focus:outline-none focus:ring-2 focus:ring-blue-200 w-56"
          />
          <button type="submit" className="btn-secondary">
            Search
          </button>
        </form>
      </div>

      {/* Table */}
      <div className="card overflow-x-auto">
        {error ? (
          <p className="text-sm text-rose-600 py-6 text-center">
            Failed to load users. Check admin privileges.
          </p>
        ) : isLoading ? (
          <div className="space-y-3 py-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="animate-pulse flex items-center gap-4 py-2">
                <div className="w-6 h-3 bg-zinc-100 rounded" />
                <div className="flex items-center gap-2 flex-1">
                  <div className="w-7 h-7 rounded-full bg-zinc-100" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 bg-zinc-100 rounded w-32" />
                    <div className="h-2.5 bg-zinc-50 rounded w-24" />
                  </div>
                </div>
                <div className="w-14 h-5 bg-zinc-100 rounded" />
                <div className="w-28 h-2 bg-zinc-100 rounded-full" />
                <div className="w-16 h-3 bg-zinc-100 rounded" />
                <div className="w-14 h-5 bg-zinc-100 rounded" />
              </div>
            ))}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100">
                {["#", "User", "Tier", "Usage", "Expires", "Status", ""].map((h, i) => (
                  <th
                    key={i}
                    className={`text-xs font-medium text-zinc-400 uppercase tracking-wide pb-3 ${
                      i === 6 ? "text-right" : "text-left pr-4"
                    }${i === 3 ? " min-w-[160px]" : ""}`}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-50">
              {data?.items.map((user, idx) => {
                const pct =
                  user.max_requests > 0
                    ? Math.min(100, Math.round((user.request_count / user.max_requests) * 100))
                    : 0;

                return (
                  <tr
                    key={user.id}
                    onClick={() => setSheetUser(user)}
                    className="hover:bg-zinc-50/60 transition-colors cursor-pointer group"
                  >
                    {/* # */}
                    <td className="py-3.5 pr-4 text-zinc-400 tabular-nums">
                      {(page - 1) * LIMIT + idx + 1}
                    </td>

                    {/* User */}
                    <td className="py-3.5 pr-4">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-white text-[0.625rem] font-bold"
                          style={{ background: "linear-gradient(135deg, #3B82F6 0%, #6366F1 100%)" }}
                        >
                          {(user.display_name ?? user.email)[0].toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <p className="font-medium text-zinc-800 truncate max-w-[160px]">
                            {user.display_name ?? (
                              <span className="text-zinc-400 italic text-xs">No name</span>
                            )}
                          </p>
                          <p className="text-xs text-zinc-400 truncate max-w-[160px]">
                            {user.email}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Tier */}
                    <td className="py-3.5 pr-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tierBadgeClass(user.subscription_tier)}`}
                      >
                        {user.subscription_tier}
                      </span>
                    </td>

                    {/* Usage */}
                    <td className="py-3.5 pr-4">
                      <div className="flex items-center gap-2">
                        <div className="w-24 bg-zinc-100 rounded-full h-1.5 shrink-0">
                          <div
                            className={`h-1.5 rounded-full transition-all ${progressBarClass(pct)}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <span className="text-xs text-zinc-500 whitespace-nowrap tabular-nums">
                          {user.request_count}/{user.max_requests}
                        </span>
                      </div>
                    </td>

                    {/* Expires */}
                    <td className="py-3.5 pr-4">
                      <span className="text-xs text-zinc-500 whitespace-nowrap">
                        {formatDate(user.tier_expires_at)}
                      </span>
                    </td>

                    {/* Status */}
                    <td className="py-3.5 pr-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass(user.is_active)}`}
                      >
                        {user.is_active ? "ACTIVE" : "SUSPENDED"}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 text-right">
                      <span className="inline-flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={(e) => { e.stopPropagation(); openEdit(user); }}
                          className="text-xs px-2.5 py-1 rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300 transition-colors"
                        >
                          Edit
                        </button>
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteUser(user); }}
                          className="text-xs px-2.5 py-1 rounded border border-rose-200 text-rose-600 hover:bg-rose-50 transition-colors"
                        >
                          Delete
                        </button>
                      </span>
                    </td>
                  </tr>
                );
              })}
              {data?.items.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-12 text-center text-sm text-zinc-400">
                    No users found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {data && data.total > LIMIT && (
        <div className="flex items-center justify-between mt-4 text-sm">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Previous
          </button>
          <span className="text-zinc-400 text-xs">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="px-3 py-1.5 rounded-lg border border-zinc-200 text-zinc-600 hover:bg-zinc-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            Next
          </button>
        </div>
      )}

      {/* Activity side-sheet */}
      {sheetUser && (
        <ActivitySheet
          user={sheetUser}
          onClose={() => setSheetUser(null)}
          onEdit={() => openEdit(sheetUser)}
        />
      )}

      {/* Edit modal */}
      {editUser && (
        <EditUserModal
          user={editUser}
          onClose={() => setEditUser(null)}
          onSaved={() => { mutate(); }}
        />
      )}

      {/* Delete dialog */}
      {deleteUser && (
        <DeleteDialog
          user={deleteUser}
          onSuspend={() => handleDelete(false)}
          onHardDelete={() => handleDelete(true)}
          onCancel={() => setDeleteUser(null)}
          deleting={deleting}
        />
      )}
    </div>
  );
}
