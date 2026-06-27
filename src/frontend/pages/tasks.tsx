import Head from "next/head";
import { useState, useCallback } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import {
  Plus, Trash2, Bell, ArrowRight, Check, RotateCcw,
  ClipboardList, Loader2, X, Sparkles, AlertCircle,
} from "lucide-react";
import Layout from "@/components/Layout";
import api from "@/lib/axios";
import type { Task, UserProfile } from "@/lib/types";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

type TaskStatusValue = "todo" | "in_progress" | "done";

// ── Priority badge ─────────────────────────────────────────────────────────────

function PriorityBadge({ priority }: { priority: number }) {
  const cfg: Record<number, { label: string; cls: string }> = {
    1: { label: "P1", cls: "bg-canvas-soft-2 text-mute border-hairline" },
    2: { label: "P2", cls: "bg-canvas-soft-2 text-mute border-hairline" },
    3: { label: "P3", cls: "bg-canvas-soft-2 text-body border-hairline" },
    4: { label: "P4", cls: "bg-warning-soft text-warning border-hairline" },
    5: { label: "P5", cls: "bg-error-soft text-error border-hairline" },
  };
  const { label, cls } = cfg[priority] ?? cfg[3];
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm text-[10px] font-medium border font-mono ${cls}`}>
      {label}
    </span>
  );
}

// ── Deadline display ───────────────────────────────────────────────────────────

function DeadlineBadge({ deadline }: { deadline: string | null }) {
  if (!deadline) return null;
  const d = new Date(deadline);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffDays = Math.floor((d.getTime() - today.getTime()) / 86_400_000);
  let cls = "text-mute";
  let prefix = "";
  if (diffDays < 0) {
    cls = "text-error font-medium";
    prefix = "Quá hạn · ";
  } else if (diffDays <= 3) {
    cls = "text-warning font-medium";
    prefix = "Sắp tới · ";
  }
  return (
    <span className={`text-xs ${cls}`}>
      {prefix}{d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" })}
    </span>
  );
}

// ── Remind-at badge ────────────────────────────────────────────────────────────

function RemindBadge({ remindAt }: { remindAt: string | null }) {
  if (!remindAt) return null;
  const d = new Date(remindAt);
  const now = new Date();
  const isPast = d < now;
  const label = d.toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  return (
    <span className={`inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-sm border font-mono ${
      isPast
        ? "bg-canvas-soft-2 text-mute border-hairline line-through"
        : "bg-canvas-soft-2 text-link border-hairline"
    }`}>
      <Bell className="w-2.5 h-2.5" />
      {label}
    </span>
  );
}

// ── Modal shell ────────────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-canvas rounded-md border border-hairline shadow-card w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-hairline">
          <h2 className="text-sm font-semibold text-ink tracking-tight">{title}</h2>
          <button onClick={onClose} className="text-mute hover:text-ink transition-colors duration-150">
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

// ── Task card ──────────────────────────────────────────────────────────────────

function TaskCard({ task, onStatusChange, onDelete }: {
  task: Task;
  onStatusChange: (id: string, status: TaskStatusValue) => void;
  onDelete: (task: Task) => void;
}) {
  return (
    <div className="bg-canvas rounded-md border border-hairline p-4 shadow-card hover:shadow-[0px_2px_4px_#0000000f,0px_4px_8px_#00000008] transition-shadow duration-150">
      <div className="flex items-start justify-between gap-2 mb-2">
        <p className="text-sm font-medium text-ink leading-snug flex-1">{task.title}</p>
        <button
          onClick={() => onDelete(task)}
          className="text-mute hover:text-error transition-colors duration-150 flex-shrink-0 mt-0.5"
          title="Xóa"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {task.description && (
        <p className="text-xs text-body mb-2 line-clamp-2">{task.description}</p>
      )}

      <div className="flex flex-wrap items-center gap-1.5 mb-1">
        <PriorityBadge priority={task.priority} />
        {task.source_email_id && (
          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-medium font-mono bg-canvas-soft-2 text-mute border border-hairline">
            email
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5 mt-1">
        <DeadlineBadge deadline={task.deadline} />
        <RemindBadge remindAt={task.remind_at} />
      </div>

      <div className="flex gap-1.5 mt-3">
        {task.status === "todo" && (
          <button
            onClick={() => onStatusChange(task.id, "in_progress")}
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-sm bg-ink text-white hover:bg-ink/90 transition-colors duration-150"
          >
            Bắt đầu <ArrowRight className="w-3 h-3" />
          </button>
        )}
        {task.status === "in_progress" && (
          <>
            <button
              onClick={() => onStatusChange(task.id, "done")}
              className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-sm bg-ink text-white hover:bg-ink/90 transition-colors duration-150"
            >
              Hoàn thành <Check className="w-3 h-3" />
            </button>
            <button
              onClick={() => onStatusChange(task.id, "todo")}
              className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-sm bg-canvas border border-hairline text-ink hover:bg-canvas-soft-2 transition-colors duration-150"
            >
              Hoàn lại <RotateCcw className="w-3 h-3" />
            </button>
          </>
        )}
        {task.status === "done" && (
          <button
            onClick={() => onStatusChange(task.id, "todo")}
            className="inline-flex items-center gap-1 text-[11px] font-medium px-2.5 py-1 rounded-sm bg-canvas border border-hairline text-ink hover:bg-canvas-soft-2 transition-colors duration-150"
          >
            Mở lại <RotateCcw className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Main page ──────────────────────────────────────────────────────────────────

type CreateForm = { title: string; description: string; priority: number; deadline: string; remind_at: string };

export default function TasksPage() {
  const router = useRouter();

  // ── All useState hooks BEFORE early return ───────────────────────────────────
  const [toast, setToast] = useState<{ message: string; type: "success" | "error" } | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<CreateForm>({ title: "", description: "", priority: 3, deadline: "", remind_at: "" });
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Task | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [filterPriority, setFilterPriority] = useState<number | null>(null);
  const [sortDeadline, setSortDeadline] = useState(false);

  // ── useSWR hooks BEFORE early return ────────────────────────────────────────
  const { data: user, error: authError } = useSWR<UserProfile>("/auth/me", fetcher, {
    onError: () => router.replace("/login"),
    revalidateOnFocus: false,
  });
  const { data: rawTasks, isLoading, mutate } = useSWR<Task[]>("/tasks", fetcher);

  // ── useCallback hooks BEFORE early return ───────────────────────────────────
  const showToast = useCallback((message: string, type: "success" | "error") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4000);
  }, []);

  const closeCreate = useCallback(() => {
    setShowCreate(false);
    setForm({ title: "", description: "", priority: 3, deadline: "", remind_at: "" });
    setCreateError(null);
  }, []);

  if (authError) return null;

  // ── Computed values ──────────────────────────────────────────────────────────
  const tasks = rawTasks ?? [];
  const suggestedTasks = tasks.filter((t) => t.status === "suggested");

  let workTasks = tasks.filter((t) => t.status !== "suggested" && t.status !== "dismissed");
  if (filterPriority !== null) {
    workTasks = workTasks.filter((t) => t.priority === filterPriority);
  }
  if (sortDeadline) {
    workTasks = [...workTasks].sort((a, b) => {
      if (!a.deadline && !b.deadline) return 0;
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    });
  }

  const todoTasks = workTasks.filter((t) => t.status === "todo");
  const inProgressTasks = workTasks.filter((t) => t.status === "in_progress");
  const doneTasks = workTasks.filter((t) => t.status === "done");

  // ── Handlers ────────────────────────────────────────────────────────────────
  const handleStatusChange = async (id: string, newStatus: TaskStatusValue) => {
    try {
      const { data } = await api.patch(`/tasks/${id}`, { status: newStatus });
      mutate((prev) => prev?.map((t) => (t.id === id ? (data as Task) : t)), false);
    } catch {
      showToast("Không thể cập nhật trạng thái.", "error");
    }
  };

  const handleConfirm = async (id: string) => {
    try {
      const { data } = await api.post(`/tasks/${id}/confirm`);
      mutate((prev) => prev?.map((t) => (t.id === id ? (data as Task) : t)), false);
      showToast("Đã duyệt công việc.", "success");
    } catch {
      showToast("Không thể duyệt công việc.", "error");
    }
  };

  const handleDismiss = async (id: string) => {
    try {
      const { data } = await api.post(`/tasks/${id}/dismiss`);
      mutate((prev) => prev?.map((t) => (t.id === id ? (data as Task) : t)), false);
    } catch {
      showToast("Không thể bỏ gợi ý.", "error");
    }
  };

  const handleCreate = async () => {
    if (!form.title.trim()) { setCreateError("Tiêu đề là bắt buộc."); return; }
    setCreating(true);
    setCreateError(null);
    try {
      const payload: Record<string, unknown> = { title: form.title.trim(), priority: form.priority };
      if (form.description.trim()) payload.description = form.description.trim();
      if (form.deadline) payload.deadline = form.deadline;
      if (form.remind_at) payload.remind_at = new Date(form.remind_at).toISOString();
      const { data } = await api.post("/tasks", payload);
      mutate((prev) => [data as Task, ...(prev ?? [])], false);
      closeCreate();
      showToast("Đã tạo công việc.", "success");
    } catch {
      setCreateError("Không thể tạo công việc. Vui lòng thử lại.");
    } finally {
      setCreating(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/tasks/${deleteTarget.id}`);
      mutate((prev) => prev?.filter((t) => t.id !== deleteTarget.id), false);
      setDeleteTarget(null);
      showToast("Đã xóa công việc.", "success");
    } catch {
      showToast("Không thể xóa công việc.", "error");
    } finally {
      setDeleting(false);
    }
  };

  const handleDismissAll = async () => {
    if (suggestedTasks.length === 0) return;
    try {
      await Promise.all(suggestedTasks.map((t) => api.post(`/tasks/${t.id}/dismiss`)));
      mutate(
        (prev) => prev?.map((t) => (t.status === "suggested" ? { ...t, status: "dismissed" as const } : t)),
        false,
      );
      showToast(`Đã bỏ ${suggestedTasks.length} gợi ý.`, "success");
    } catch {
      showToast("Không thể bỏ tất cả gợi ý.", "error");
    }
  };

  // ── Column component ─────────────────────────────────────────────────────────
  function Column({ label, count, items }: {
    label: string;
    count: number;
    items: Task[];
  }) {
    return (
      <div>
        <div className="flex items-center gap-2 mb-3">
          <span className="text-[10px] font-medium font-mono text-mute tracking-wider">{label}</span>
          <span className="text-[10px] font-mono text-mute ml-auto">{count}</span>
        </div>
        <div className="flex flex-col gap-2 min-h-[100px]">
          {items.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-md border border-hairline bg-canvas-soft-2 py-10 gap-2">
              <ClipboardList className="w-5 h-5 text-mute opacity-40" />
              <span className="text-xs text-mute">Trống</span>
            </div>
          ) : (
            items.map((t) => (
              <TaskCard
                key={t.id}
                task={t}
                onStatusChange={handleStatusChange}
                onDelete={setDeleteTarget}
              />
            ))
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <Head>
        <title>Công việc — Email Orchestrator</title>
      </Head>
      <Layout user={user ?? null}>
        {/* Toast */}
        {toast && (
          <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-md border text-sm font-medium shadow-card ${
            toast.type === "success"
              ? "bg-canvas border-hairline text-ink"
              : "bg-error-soft border-error/20 text-error"
          }`}>
            {toast.type === "error" && <AlertCircle className="w-4 h-4 flex-shrink-0" />}
            {toast.message}
            <button onClick={() => setToast(null)} className="ml-1 text-mute hover:text-ink transition-colors duration-150">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Page header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-xl font-semibold text-ink" style={{ letterSpacing: "-0.6px" }}>Quản lý công việc</h1>
            <p className="text-sm text-body mt-0.5">Theo dõi và điều phối công việc từ email.</p>
          </div>
          <button
            onClick={() => setShowCreate(true)}
            className="inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-sm bg-ink text-white hover:bg-ink/90 transition-colors duration-150"
          >
            <Plus className="w-4 h-4" />
            Tạo công việc
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-mute text-sm gap-2">
            <Loader2 className="w-5 h-5 animate-spin" />
            Đang tải công việc...
          </div>
        ) : (
          <>
            {/* ── Gợi ý chờ duyệt ─────────────────────────────────────────── */}
            <div className="mb-8 rounded-md border border-hairline bg-canvas-soft-2 p-4">
              <div className="flex items-center gap-2 mb-3">
                <Sparkles className="w-3.5 h-3.5 text-link" />
                <span className="text-[10px] font-medium font-mono text-mute tracking-wider">GỢI Ý AI</span>
                {suggestedTasks.length > 0 && (
                  <span className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 rounded-sm bg-link text-white text-[10px] font-mono font-medium">
                    {suggestedTasks.length}
                  </span>
                )}
                {suggestedTasks.length > 1 && (
                  <button
                    onClick={handleDismissAll}
                    className="ml-auto text-[11px] font-medium px-2.5 py-1 rounded-sm border border-hairline text-mute hover:text-ink hover:border-ink/20 bg-canvas transition-colors duration-150"
                  >
                    Bỏ tất cả
                  </button>
                )}
              </div>

              {suggestedTasks.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 gap-2">
                  <Sparkles className="w-5 h-5 text-mute opacity-30" />
                  <p className="text-xs text-mute text-center">
                    Chưa có gợi ý nào. AI sẽ sinh task từ email ở bước tiếp theo.
                  </p>
                </div>
              ) : (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {suggestedTasks.map((task) => (
                    <div
                      key={task.id}
                      className="bg-canvas rounded-md border border-hairline border-l-2 border-l-link p-3 shadow-card"
                    >
                      <div className="flex items-start gap-2 mb-1.5">
                        <p className="text-sm font-medium text-ink flex-1 leading-snug">{task.title}</p>
                        <PriorityBadge priority={task.priority} />
                      </div>
                      {task.description && (
                        <p className="text-xs text-body mb-2 line-clamp-2">{task.description}</p>
                      )}
                      <div className="flex flex-wrap items-center gap-1.5 mb-3">
                        {task.deadline && <DeadlineBadge deadline={task.deadline} />}
                        {task.source_email_id && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm text-[10px] font-medium font-mono bg-canvas-soft-2 text-mute border border-hairline">
                            email
                          </span>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleConfirm(task.id)}
                          className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-medium py-1.5 px-3 rounded-sm bg-ink text-white hover:bg-ink/90 transition-colors duration-150"
                        >
                          <Check className="w-3 h-3" /> Duyệt
                        </button>
                        <button
                          onClick={() => handleDismiss(task.id)}
                          className="flex-1 inline-flex items-center justify-center gap-1 text-xs font-medium py-1.5 px-3 rounded-sm border border-hairline text-ink hover:bg-canvas-soft-2 transition-colors duration-150"
                        >
                          Bỏ
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Filters ──────────────────────────────────────────────────── */}
            <div className="flex items-center gap-3 mb-4">
              <select
                value={filterPriority ?? ""}
                onChange={(e) => setFilterPriority(e.target.value ? Number(e.target.value) : null)}
                className="text-xs font-mono border border-hairline rounded-sm px-3 py-1.5 text-body bg-canvas focus:outline-none focus:ring-1 focus:ring-ink/20"
              >
                <option value="">Tất cả ưu tiên</option>
                <option value="5">P5 — Cấp bách</option>
                <option value="4">P4 — Cao</option>
                <option value="3">P3 — Trung bình</option>
                <option value="2">P2 — Thấp</option>
                <option value="1">P1 — Rất thấp</option>
              </select>

              <label className="flex items-center gap-1.5 text-xs text-body cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={sortDeadline}
                  onChange={(e) => setSortDeadline(e.target.checked)}
                  className="rounded-sm border-hairline focus:ring-1 focus:ring-ink/20"
                />
                Sắp theo deadline
              </label>
            </div>

            {/* ── Board ─────────────────────────────────────────────────────── */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <Column label="CẦN LÀM" count={todoTasks.length} items={todoTasks} />
              <Column label="ĐANG LÀM" count={inProgressTasks.length} items={inProgressTasks} />
              <Column label="HOÀN THÀNH" count={doneTasks.length} items={doneTasks} />
            </div>
          </>
        )}
      </Layout>

      {/* ── Create modal ───────────────────────────────────────────────────────── */}
      {showCreate && (
        <Modal title="Tạo công việc mới" onClose={closeCreate}>
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-ink mb-1.5">
                Tiêu đề <span className="text-error">*</span>
              </label>
              <input
                type="text"
                value={form.title}
                onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
                placeholder="Nhập tiêu đề công việc..."
                autoFocus
                className="w-full px-3 py-2 border border-hairline rounded-sm text-sm text-ink placeholder-mute bg-canvas focus:outline-none focus:ring-1 focus:ring-ink/20"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-ink mb-1.5">Mô tả</label>
              <textarea
                value={form.description}
                onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
                placeholder="Chi tiết công việc (tuỳ chọn)..."
                rows={2}
                className="w-full px-3 py-2 border border-hairline rounded-sm text-sm text-ink placeholder-mute bg-canvas focus:outline-none focus:ring-1 focus:ring-ink/20 resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-ink mb-1.5">Ưu tiên</label>
                <select
                  value={form.priority}
                  onChange={(e) => setForm((p) => ({ ...p, priority: Number(e.target.value) }))}
                  className="w-full px-3 py-2 border border-hairline rounded-sm text-sm text-ink bg-canvas focus:outline-none focus:ring-1 focus:ring-ink/20"
                >
                  <option value={5}>P5 — Cấp bách</option>
                  <option value={4}>P4 — Cao</option>
                  <option value={3}>P3 — Trung bình</option>
                  <option value={2}>P2 — Thấp</option>
                  <option value={1}>P1 — Rất thấp</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-ink mb-1.5">Deadline</label>
                <input
                  type="date"
                  value={form.deadline}
                  onChange={(e) => setForm((p) => ({ ...p, deadline: e.target.value }))}
                  className="w-full px-3 py-2 border border-hairline rounded-sm text-sm text-ink bg-canvas focus:outline-none focus:ring-1 focus:ring-ink/20"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-ink mb-1.5">
                Nhắc lúc
                <span className="ml-1 text-xs font-normal text-mute">(tuỳ chọn)</span>
              </label>
              <input
                type="datetime-local"
                value={form.remind_at}
                onChange={(e) => setForm((p) => ({ ...p, remind_at: e.target.value }))}
                className="w-full px-3 py-2 border border-hairline rounded-sm text-sm text-ink bg-canvas focus:outline-none focus:ring-1 focus:ring-ink/20"
              />
            </div>

            {createError && (
              <p className="text-xs text-error flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5" /> {createError}
              </p>
            )}

            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={closeCreate}
                disabled={creating}
                className="px-4 py-2 text-sm font-medium rounded-sm border border-hairline text-ink hover:bg-canvas-soft-2 disabled:opacity-50 transition-colors duration-150"
              >
                Huỷ
              </button>
              <button
                onClick={handleCreate}
                disabled={creating || !form.title.trim()}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-sm bg-ink text-white hover:bg-ink/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors duration-150"
              >
                {creating ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Đang tạo...
                  </>
                ) : "Tạo công việc"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Delete confirm modal ───────────────────────────────────────────────── */}
      {deleteTarget && (
        <Modal title="Xác nhận xóa" onClose={() => setDeleteTarget(null)}>
          <div className="space-y-4">
            <p className="text-sm text-body">
              Bạn có chắc muốn xóa{" "}
              <span className="font-semibold text-ink">&ldquo;{deleteTarget.title}&rdquo;</span>?
              Hành động này không thể hoàn tác.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteTarget(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm font-medium rounded-sm border border-hairline text-ink hover:bg-canvas-soft-2 disabled:opacity-50 transition-colors duration-150"
              >
                Huỷ
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium rounded-sm bg-error text-white hover:bg-error/90 disabled:opacity-50 transition-colors duration-150"
              >
                {deleting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    Đang xóa...
                  </>
                ) : "Xóa"}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}
