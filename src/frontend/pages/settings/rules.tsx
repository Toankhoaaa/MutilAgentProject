import Head from "next/head";
import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import Layout from "@/components/Layout";
import RuleModal from "@/components/RuleModal";
import api from "@/lib/axios";
import type { EmailRule, UserProfile } from "@/lib/types";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

// ── Icons ─────────────────────────────────────────────────────────────────────

const PlusIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
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

const ChevronUpIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
  </svg>
);

const ChevronDownIcon = () => (
  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
  </svg>
);

// ── Toast ─────────────────────────────────────────────────────────────────────

interface ToastState {
  message: string;
  type: "success" | "error";
  id: number;
}

function Toast({ toast, onDismiss }: { toast: ToastState; onDismiss: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDismiss, 3500);
    return () => clearTimeout(t);
  }, [toast.id, onDismiss]);

  return (
    <div
      className={`fixed bottom-5 right-5 z-[60] flex items-center gap-3 px-4 py-3 rounded-xl shadow-lg text-sm font-medium text-white transition-all ${
        toast.type === "success" ? "bg-emerald-600" : "bg-rose-600"
      }`}
    >
      <span>{toast.type === "success" ? "✓" : "✕"}</span>
      {toast.message}
      <button onClick={onDismiss} className="ml-1 opacity-70 hover:opacity-100 transition-opacity">
        <CloseIcon />
      </button>
    </div>
  );
}

// ── Action badge ──────────────────────────────────────────────────────────────

const ACTION_CFG: Record<string, { label: string; cls: string }> = {
  force_category: { label: "Force Category", cls: "bg-indigo-50 text-indigo-700 border-indigo-200" },
  skip_ai:        { label: "Skip AI",         cls: "bg-amber-50  text-amber-700  border-amber-200"  },
  trash:          { label: "Trash",            cls: "bg-rose-50   text-rose-700   border-rose-200"   },
  alert:          { label: "Alert",            cls: "bg-orange-50 text-orange-700 border-orange-200" },
  skip_draft:     { label: "Skip Draft",       cls: "bg-slate-50  text-slate-600  border-slate-200"  },
};

function ActionBadge({ action, actionValue }: { action: string; actionValue: string | null }) {
  const cfg = ACTION_CFG[action] ?? { label: action, cls: "bg-slate-50 text-slate-600 border-slate-200" };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium border ${cfg.cls}`}>
      {cfg.label}
      {action === "force_category" && actionValue && (
        <span className="opacity-60">→ {actionValue}</span>
      )}
    </span>
  );
}

// ── Delete confirm modal ──────────────────────────────────────────────────────

function DeleteModal({
  rule,
  onConfirm,
  onClose,
  deleting,
}: {
  rule: EmailRule;
  onConfirm: () => void;
  onClose: () => void;
  deleting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">Delete Rule</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600 transition-colors">
            <CloseIcon />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-600">
            Permanently delete{" "}
            <span className="font-medium text-slate-800">&ldquo;{rule.name}&rdquo;</span>?
            This action cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <button
              onClick={onClose}
              disabled={deleting}
              className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
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
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EmailRulesPage() {
  const router = useRouter();

  const { data: user, error: authError } = useSWR<UserProfile>("/auth/me", fetcher, {
    onError: () => router.replace("/login"),
    revalidateOnFocus: false,
  });

  const { data: rules, isLoading, mutate } = useSWR<EmailRule[]>(
    "/rules",
    fetcher,
    { revalidateOnFocus: false },
  );

  const [modalRule, setModalRule] = useState<EmailRule | null | false>(false); // false = closed, null = new
  const [deleteTarget, setDeleteTarget] = useState<EmailRule | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [reordering, setReordering] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type, id: Date.now() });
  }, []);

  if (authError) return null;

  const sorted = (rules ?? []).slice().sort((a, b) => a.priority - b.priority);

  // ── Handlers ────────────────────────────────────────────────────────────────

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/rules/${deleteTarget.id}`);
      await mutate();
      setDeleteTarget(null);
      showToast("Rule deleted.", "success");
    } catch {
      showToast("Delete failed.", "error");
    } finally {
      setDeleting(false);
    }
  };

  const handleToggleActive = async (rule: EmailRule) => {
    try {
      await api.put(`/rules/${rule.id}`, { is_active: !rule.is_active });
      await mutate();
    } catch {
      showToast("Update failed.", "error");
    }
  };

  const handleMove = async (index: number, direction: "up" | "down") => {
    if (reordering) return;
    const list = sorted;
    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= list.length) return;

    const newOrder = list.map((r) => r.id);
    [newOrder[index], newOrder[targetIndex]] = [newOrder[targetIndex], newOrder[index]];

    setReordering(true);
    try {
      await api.post("/rules/reorder", { rule_ids: newOrder });
      await mutate();
    } catch {
      showToast("Reorder failed.", "error");
    } finally {
      setReordering(false);
    }
  };

  return (
    <>
      <Head>
        <title>Email Rules — Settings</title>
      </Head>
      <Layout user={user ?? null}>
        <div className="max-w-5xl mx-auto py-8 px-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">Email Rules</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Rules are evaluated in priority order before AI classification. First match wins.
              </p>
            </div>
            <button
              onClick={() => setModalRule(null)}
              className="btn-primary flex items-center gap-2"
            >
              <PlusIcon />
              Add Rule
            </button>
          </div>

          {/* Table */}
          <div className="card overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-sm text-slate-400">
                <span className="w-4 h-4 rounded-full border-2 border-indigo-300 border-t-transparent animate-spin mr-2" />
                Loading rules…
              </div>
            ) : sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <svg className="w-10 h-10 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2a1 1 0 01-.293.707L13 13.414V19a1 1 0 01-.553.894l-4 2A1 1 0 017 21v-7.586L3.293 6.707A1 1 0 013 6V4z" />
                </svg>
                <p className="text-sm">No rules yet. Click &ldquo;Add Rule&rdquo; to get started.</p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-16">#</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Condition</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Action</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-20 text-center">Active</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((rule, idx) => (
                    <tr
                      key={rule.id}
                      className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors"
                    >
                      {/* Priority + reorder */}
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1">
                          <span className="w-6 text-center text-xs font-mono text-slate-500 font-semibold">
                            {rule.priority}
                          </span>
                          <div className="flex flex-col">
                            <button
                              onClick={() => handleMove(idx, "up")}
                              disabled={idx === 0 || reordering}
                              title="Move up"
                              className="p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              <ChevronUpIcon />
                            </button>
                            <button
                              onClick={() => handleMove(idx, "down")}
                              disabled={idx === sorted.length - 1 || reordering}
                              title="Move down"
                              className="p-0.5 text-slate-300 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                            >
                              <ChevronDownIcon />
                            </button>
                          </div>
                        </div>
                      </td>

                      {/* Name */}
                      <td className="px-4 py-3 font-medium text-slate-800 max-w-[140px]">
                        <span className="truncate block" title={rule.name}>{rule.name}</span>
                        {rule.match_count > 0 && (
                          <span className="text-xs text-slate-400 font-normal">
                            {rule.match_count} match{rule.match_count !== 1 ? "es" : ""}
                          </span>
                        )}
                      </td>

                      {/* Condition */}
                      <td className="px-4 py-3 text-slate-600 text-xs">
                        <span className="font-medium text-slate-700">{rule.field}</span>
                        {" "}
                        <span className="text-slate-400">{rule.operator.replace("_", " ")}</span>
                        {" "}
                        <span className="font-mono bg-slate-100 px-1 py-0.5 rounded text-slate-700 break-all">
                          {rule.value}
                        </span>
                      </td>

                      {/* Action */}
                      <td className="px-4 py-3">
                        <ActionBadge action={rule.action} actionValue={rule.action_value} />
                      </td>

                      {/* Active toggle */}
                      <td className="px-4 py-3 text-center">
                        <button
                          role="switch"
                          aria-checked={rule.is_active}
                          onClick={() => handleToggleActive(rule)}
                          title={rule.is_active ? "Disable rule" : "Enable rule"}
                          className={`relative inline-flex w-9 h-5 rounded-full transition-colors ${
                            rule.is_active ? "bg-indigo-600" : "bg-slate-200"
                          }`}
                        >
                          <span
                            className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                              rule.is_active ? "translate-x-4" : "translate-x-0"
                            }`}
                          />
                        </button>
                      </td>

                      {/* Edit / Delete */}
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => setModalRule(rule)}
                            title="Edit rule"
                            className="p-1.5 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                          >
                            <EditIcon />
                          </button>
                          <button
                            onClick={() => setDeleteTarget(rule)}
                            title="Delete rule"
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

            {sorted.length > 0 && (
              <div className="px-4 py-2.5 text-xs text-slate-400 border-t border-slate-100">
                {sorted.length} rule{sorted.length !== 1 ? "s" : ""} total
              </div>
            )}
          </div>
        </div>
      </Layout>

      {/* Rule create/edit modal */}
      {modalRule !== false && (
        <RuleModal
          rule={modalRule}
          onClose={() => setModalRule(false)}
          onSaved={() => mutate()}
          onToast={showToast}
        />
      )}

      {/* Delete confirmation */}
      {deleteTarget && (
        <DeleteModal
          rule={deleteTarget}
          onConfirm={handleDelete}
          onClose={() => setDeleteTarget(null)}
          deleting={deleting}
        />
      )}

      {/* Toast */}
      {toast && (
        <Toast
          toast={toast}
          onDismiss={() => setToast(null)}
        />
      )}
    </>
  );
}
