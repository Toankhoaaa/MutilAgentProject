import { useState } from "react";
import useSWR from "swr";
import api from "@/lib/axios";
import type { AdminUser, AdminUserListResponse } from "@/lib/types";

interface EditForm {
  subscription_tier: string;
  max_requests: number;
  status: string;
  request_count: number;
}

const LIMIT = 20;
const TIERS = ["FREE", "PRO", "ENTERPRISE"] as const;

function tierBadgeClass(tier: string): string {
  if (tier === "PRO") return "bg-blue-100 text-blue-700";
  if (tier === "ENTERPRISE") return "bg-violet-100 text-violet-700";
  return "bg-zinc-100 text-zinc-600";
}

function statusBadgeClass(status: string): string {
  return status === "ACTIVE" ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700";
}

function progressBarClass(pct: number): string {
  if (pct >= 85) return "bg-rose-500";
  if (pct >= 60) return "bg-amber-400";
  return "bg-blue-500";
}

function extractError(err: unknown): string {
  return (
    (err as { response?: { data?: { error?: { message?: string } } } })
      ?.response?.data?.error?.message ?? "An unexpected error occurred."
  );
}

const fetcher = (url: string) => api.get<AdminUserListResponse>(url).then((r) => r.data);

export default function UserManagement() {
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");

  const [editUser, setEditUser] = useState<AdminUser | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    subscription_tier: "FREE",
    max_requests: 100,
    status: "ACTIVE",
    request_count: 0,
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const swrKey = `/admin/users?page=${page}&limit=${LIMIT}${search ? `&search=${encodeURIComponent(search)}` : ""}`;
  const { data, error, isLoading, mutate } = useSWR<AdminUserListResponse>(swrKey, fetcher);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / LIMIT)) : 1;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setSearch(searchInput);
    setPage(1);
  };

  const openEdit = (user: AdminUser) => {
    setEditUser(user);
    setEditForm({
      subscription_tier: user.subscription_tier,
      max_requests: user.max_requests,
      status: user.status,
      request_count: user.request_count,
    });
    setSaveError(null);
  };

  const handleSave = async () => {
    if (!editUser) return;
    setSaving(true);
    setSaveError(null);
    try {
      await api.put(`/admin/users/${editUser.id}`, editForm);
      await mutate();
      setEditUser(null);
    } catch (err) {
      setSaveError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (hard: boolean) => {
    if (!deleteId) return;
    setDeleting(true);
    try {
      await api.delete(`/admin/users/${deleteId}?hard=${hard}`);
      await mutate();
      setDeleteId(null);
    } catch {
      setDeleteId(null);
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-7">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-zinc-900">User Management</h1>
          <p className="text-sm text-zinc-400 mt-0.5">
            {data ? `${data.total} user${data.total !== 1 ? "s" : ""} total` : "Loading…"}
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
          <p className="text-sm text-rose-600 py-6 text-center">Failed to load users. Check admin privileges.</p>
        ) : isLoading ? (
          <div className="flex items-center justify-center py-14">
            <span className="w-6 h-6 rounded-full border-2 border-blue-500 border-t-transparent animate-spin" />
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100">
                {["#", "User", "Tier", "Usage", "Status", ""].map((h, i) => (
                  <th
                    key={i}
                    className={`text-xs font-medium text-zinc-400 uppercase tracking-wide pb-3 ${
                      i === 5 ? "text-right" : "text-left pr-4"
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
                const isConfirming = deleteId === user.id;

                return (
                  <tr key={user.id} className="hover:bg-zinc-50/60 transition-colors group">
                    {/* # */}
                    <td className="py-3.5 pr-4 text-zinc-400 tabular-nums">
                      {(page - 1) * LIMIT + idx + 1}
                    </td>

                    {/* User */}
                    <td className="py-3.5 pr-4">
                      <div className="flex items-center gap-2.5">
                        <div
                          className="w-7 h-7 rounded-full flex items-center justify-center flex-shrink-0 text-white text-[0.625rem] font-bold"
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
                          <p className="text-xs text-zinc-400 truncate max-w-[160px]">{user.email}</p>
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
                        <div className="w-24 bg-zinc-100 rounded-full h-1.5 flex-shrink-0">
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

                    {/* Status */}
                    <td className="py-3.5 pr-4">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${statusBadgeClass(user.status)}`}
                      >
                        {user.status}
                      </span>
                    </td>

                    {/* Actions */}
                    <td className="py-3.5 text-right">
                      {isConfirming ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-xs text-zinc-400 mr-0.5">Delete?</span>
                          <button
                            onClick={() => handleDelete(false)}
                            disabled={deleting}
                            className="text-xs px-2 py-1 rounded bg-rose-100 text-rose-700 hover:bg-rose-200 transition-colors disabled:opacity-50"
                          >
                            Suspend
                          </button>
                          <button
                            onClick={() => handleDelete(true)}
                            disabled={deleting}
                            className="text-xs px-2 py-1 rounded bg-rose-600 text-white hover:bg-rose-700 transition-colors disabled:opacity-50"
                          >
                            Hard delete
                          </button>
                          <button
                            onClick={() => setDeleteId(null)}
                            className="text-xs px-2 py-1 rounded bg-zinc-100 text-zinc-600 hover:bg-zinc-200 transition-colors"
                          >
                            Cancel
                          </button>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => openEdit(user)}
                            className="text-xs px-2.5 py-1 rounded border border-zinc-200 text-zinc-600 hover:bg-zinc-50 hover:border-zinc-300 transition-colors"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => setDeleteId(user.id)}
                            className="text-xs px-2.5 py-1 rounded border border-rose-200 text-rose-600 hover:bg-rose-50 transition-colors"
                          >
                            Delete
                          </button>
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
              {data?.items.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-12 text-center text-sm text-zinc-400">
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

      {/* Edit Modal */}
      {editUser && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
          onClick={() => !saving && setEditUser(null)}
        >
          <div
            className="bg-white rounded-xl shadow-xl border border-zinc-100 p-6 w-full max-w-sm mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="mb-5">
              <h2 className="text-base font-semibold text-zinc-900">Edit User</h2>
              <p className="text-xs text-zinc-400 mt-0.5 truncate">{editUser.email}</p>
            </div>

            <div className="space-y-4">
              {/* Tier */}
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1.5">
                  Subscription Tier
                </label>
                <select
                  value={editForm.subscription_tier}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, subscription_tier: e.target.value }))
                  }
                  className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 bg-white text-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  {TIERS.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              </div>

              {/* Max Requests */}
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1.5">
                  Max Requests
                </label>
                <input
                  type="number"
                  min={1}
                  value={editForm.max_requests}
                  onChange={(e) =>
                    setEditForm((f) => ({ ...f, max_requests: Math.max(1, Number(e.target.value)) }))
                  }
                  className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 bg-white text-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                />
              </div>

              {/* Status */}
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1.5">
                  Account Status
                </label>
                <select
                  value={editForm.status}
                  onChange={(e) => setEditForm((f) => ({ ...f, status: e.target.value }))}
                  className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 bg-white text-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                >
                  <option value="ACTIVE">ACTIVE</option>
                  <option value="SUSPENDED">SUSPENDED</option>
                </select>
              </div>

              {/* Usage count */}
              <div>
                <label className="block text-xs font-medium text-zinc-600 mb-1.5">
                  Current Usage Count
                  <span className="ml-1.5 font-normal text-zinc-400">— set to 0 to reset</span>
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="number"
                    min={0}
                    value={editForm.request_count}
                    onChange={(e) =>
                      setEditForm((f) => ({
                        ...f,
                        request_count: Math.max(0, Number(e.target.value)),
                      }))
                    }
                    className="flex-1 text-sm px-3 py-2 rounded-lg border border-zinc-200 bg-white text-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
                  />
                  <button
                    type="button"
                    onClick={() => setEditForm((f) => ({ ...f, request_count: 0 }))}
                    className="text-xs px-2.5 py-2 rounded-lg border border-zinc-200 text-zinc-500 hover:bg-zinc-50 transition-colors whitespace-nowrap"
                  >
                    Reset
                  </button>
                </div>
              </div>
            </div>

            {saveError && (
              <p className="mt-3 text-xs text-rose-600">{saveError}</p>
            )}

            <div className="flex gap-2 mt-6">
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary flex-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Saving…
                  </>
                ) : (
                  "Save Changes"
                )}
              </button>
              <button
                onClick={() => setEditUser(null)}
                disabled={saving}
                className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
