import Head from "next/head";
import { useState, useCallback } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";
import Layout from "@/components/Layout";
import api from "@/lib/axios";
import type { Department, UserProfile } from "@/lib/types";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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

// ── Shared modal shell ────────────────────────────────────────────────────────

function Modal({ title, onClose, children }: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md">
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

// ── Department form fields (reused in Add + Edit modals) ─────────────────────

function DeptFormFields({
  name, email, keywords,
  onName, onEmail, onKeywords,
  disabled,
}: {
  name: string; email: string; keywords: string;
  onName: (v: string) => void;
  onEmail: (v: string) => void;
  onKeywords: (v: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Tên phòng ban <span className="text-rose-500">*</span>
        </label>
        <input
          type="text"
          value={name}
          onChange={(e) => onName(e.target.value)}
          disabled={disabled}
          placeholder="vd: Phòng Kế toán"
          className="block w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Email nhận việc <span className="text-rose-500">*</span>
        </label>
        <input
          type="email"
          value={email}
          onChange={(e) => onEmail(e.target.value)}
          disabled={disabled}
          placeholder="vd: ketoan@company.com"
          className="block w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-slate-700 mb-1.5">
          Từ khóa nhận diện <span className="text-slate-400 font-normal">(tùy chọn)</span>
        </label>
        <input
          type="text"
          value={keywords}
          onChange={(e) => onKeywords(e.target.value)}
          disabled={disabled}
          placeholder="vd: hóa đơn, công nợ, thanh toán"
          className="block w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50"
        />
        <p className="text-xs text-slate-400 mt-1">
          Giúp AI nhận diện đúng phòng khi tên trong email không khớp chính xác.
        </p>
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function DepartmentsPage() {
  const router = useRouter();

  // ── All hooks FIRST — before any conditional return ──────────────────────
  const { data: user, error: authError } = useSWR<UserProfile>("/auth/me", fetcher, {
    onError: () => router.replace("/login"),
    revalidateOnFocus: false,
  });

  const { data: departments, isLoading, mutate } = useSWR<Department[]>(
    "/departments",
    fetcher,
  );

  // Add modal
  const [showAdd, setShowAdd] = useState(false);
  const [addName, setAddName] = useState("");
  const [addEmail, setAddEmail] = useState("");
  const [addKeywords, setAddKeywords] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Edit modal
  const [editDept, setEditDept] = useState<Department | null>(null);
  const [editName, setEditName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editKeywords, setEditKeywords] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Delete confirm
  const [deleteDept, setDeleteDept] = useState<Department | null>(null);
  const [deleting, setDeleting] = useState(false);

  const resetAdd = useCallback(() => {
    setShowAdd(false);
    setAddName("");
    setAddEmail("");
    setAddKeywords("");
    setAddError(null);
  }, []);

  // ── Auth guard ────────────────────────────────────────────────────────────
  if (authError) return null;

  // ── Helpers ───────────────────────────────────────────────────────────────

  const extractError = (err: unknown, status?: number): string => {
    const axErr = err as { response?: { status?: number; data?: { error?: { message?: string }; detail?: string } } };
    const httpStatus = status ?? axErr?.response?.status;
    const detail =
      axErr?.response?.data?.error?.message ??
      axErr?.response?.data?.detail;
    if (httpStatus === 409 || (typeof detail === "string" && detail.toLowerCase().includes("already exists"))) {
      return "Tên phòng ban đã tồn tại. Vui lòng chọn tên khác.";
    }
    return detail ?? "Đã xảy ra lỗi. Vui lòng thử lại.";
  };

  const validateForm = (name: string, email: string): string | null => {
    if (!name.trim()) return "Tên phòng không được để trống.";
    if (!EMAIL_RE.test(email.trim())) return "Email không hợp lệ.";
    return null;
  };

  // ── Handlers ──────────────────────────────────────────────────────────────

  const openEdit = (dept: Department) => {
    setEditDept(dept);
    setEditName(dept.name);
    setEditEmail(dept.email);
    setEditKeywords(dept.keywords ?? "");
    setSaveError(null);
  };

  const handleAdd = async () => {
    const validationErr = validateForm(addName, addEmail);
    if (validationErr) { setAddError(validationErr); return; }
    setAdding(true);
    setAddError(null);
    try {
      await api.post("/departments", {
        name: addName.trim(),
        email: addEmail.trim(),
        keywords: addKeywords.trim() || null,
      });
      await mutate();
      resetAdd();
    } catch (err) {
      setAddError(extractError(err));
    } finally {
      setAdding(false);
    }
  };

  const handleSave = async () => {
    if (!editDept) return;
    const validationErr = validateForm(editName, editEmail);
    if (validationErr) { setSaveError(validationErr); return; }
    setSaving(true);
    setSaveError(null);
    try {
      await api.patch(`/departments/${editDept.id}`, {
        name: editName.trim(),
        email: editEmail.trim(),
        keywords: editKeywords.trim() || null,
      });
      await mutate();
      setEditDept(null);
    } catch (err) {
      setSaveError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteDept) return;
    setDeleting(true);
    try {
      await api.delete(`/departments/${deleteDept.id}`);
      await mutate();
      setDeleteDept(null);
    } catch {
      setDeleteDept(null);
    } finally {
      setDeleting(false);
    }
  };

  const depts = departments ?? [];

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <>
      <Head>
        <title>Phòng ban — Email Orchestrator</title>
      </Head>
      <Layout user={user ?? null}>
        <div className="max-w-4xl mx-auto py-8 px-4">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-xl font-semibold text-slate-800">Quản lý Phòng ban</h1>
              <p className="text-sm text-slate-500 mt-0.5">
                Cấu hình tên phòng và email để AI tự điền người nhận khi phân công công việc.
              </p>
            </div>
            <button
              onClick={() => setShowAdd(true)}
              className="btn-primary flex items-center gap-2"
            >
              <PlusIcon />
              Thêm phòng
            </button>
          </div>

          {/* Department list */}
          <div className="card overflow-hidden">
            {isLoading ? (
              <div className="flex items-center justify-center py-16 text-sm text-slate-400">
                <span className="w-4 h-4 rounded-full border-2 border-indigo-300 border-t-transparent animate-spin mr-2" />
                Đang tải…
              </div>
            ) : depts.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-slate-400">
                <svg className="w-10 h-10 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5}
                    d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" />
                </svg>
                <p className="text-sm text-center max-w-xs">
                  Chưa có phòng ban nào. Thêm phòng để AI tự điền người nhận khi phân công.
                </p>
              </div>
            ) : (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 text-left">
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Tên phòng</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Email nhận việc</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Từ khóa</th>
                    <th className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide text-right">Thao tác</th>
                  </tr>
                </thead>
                <tbody>
                  {depts.map((dept) => (
                    <tr key={dept.id} className="border-b border-slate-50 hover:bg-slate-50/60 transition-colors">
                      <td className="px-4 py-3 font-medium text-slate-800">
                        {dept.name}
                      </td>
                      <td className="px-4 py-3 text-slate-600 font-mono text-xs">
                        {dept.email}
                      </td>
                      <td className="px-4 py-3 text-slate-500 text-xs max-w-[220px]">
                        {dept.keywords ? (
                          <span className="line-clamp-1">{dept.keywords}</span>
                        ) : (
                          <span className="text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            onClick={() => openEdit(dept)}
                            title="Sửa phòng"
                            className="p-1.5 rounded-md text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 transition-colors"
                          >
                            <EditIcon />
                          </button>
                          <button
                            onClick={() => setDeleteDept(dept)}
                            title="Xóa phòng"
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
            {depts.length > 0 && (
              <div className="px-4 py-2.5 text-xs text-slate-400 border-t border-slate-100">
                {depts.length} phòng ban
              </div>
            )}
          </div>
        </div>
      </Layout>

      {/* ── Add modal ──────────────────────────────────────────────────────────── */}
      {showAdd && (
        <Modal title="Thêm phòng ban" onClose={resetAdd}>
          <div className="space-y-4">
            <DeptFormFields
              name={addName} email={addEmail} keywords={addKeywords}
              onName={setAddName} onEmail={setAddEmail} onKeywords={setAddKeywords}
              disabled={adding}
            />
            {addError && <p className="text-sm text-rose-600">{addError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={resetAdd}
                disabled={adding}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={handleAdd}
                disabled={adding}
                className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {adding ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Đang thêm…
                  </>
                ) : (
                  <>
                    <PlusIcon />
                    Thêm phòng
                  </>
                )}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Edit modal ─────────────────────────────────────────────────────────── */}
      {editDept && (
        <Modal title={`Sửa — ${editDept.name}`} onClose={() => setEditDept(null)}>
          <div className="space-y-4">
            <DeptFormFields
              name={editName} email={editEmail} keywords={editKeywords}
              onName={setEditName} onEmail={setEditEmail} onKeywords={setEditKeywords}
              disabled={saving}
            />
            {saveError && <p className="text-sm text-rose-600">{saveError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <button
                onClick={() => setEditDept(null)}
                disabled={saving}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {saving ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Đang lưu…
                  </>
                ) : "Lưu thay đổi"}
              </button>
            </div>
          </div>
        </Modal>
      )}

      {/* ── Delete confirm ─────────────────────────────────────────────────────── */}
      {deleteDept && (
        <Modal title="Xóa phòng ban" onClose={() => setDeleteDept(null)}>
          <div className="space-y-4">
            <p className="text-sm text-slate-600">
              Xóa phòng{" "}
              <span className="font-semibold text-slate-800">{deleteDept.name}</span>?
              Hành động này không thể hoàn tác.
            </p>
            <p className="text-xs text-slate-400 bg-slate-50 rounded-lg px-3 py-2">
              Lưu ý: xóa phòng không ảnh hưởng đến các phân công cũ đã tạo — chỉ các phân công
              mới sẽ không tự điền email phòng này nữa.
            </p>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setDeleteDept(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
              >
                Hủy
              </button>
              <button
                onClick={handleDelete}
                disabled={deleting}
                className="px-4 py-2 text-sm rounded-lg bg-rose-600 text-white hover:bg-rose-700 flex items-center gap-2 disabled:opacity-50 transition-colors"
              >
                {deleting ? (
                  <>
                    <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                    Đang xóa…
                  </>
                ) : (
                  <>
                    <TrashIcon />
                    Xóa phòng
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
