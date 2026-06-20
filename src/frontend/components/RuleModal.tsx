import { useState, useEffect, useCallback } from "react";
import api from "@/lib/axios";
import type {
  EmailRule,
  RuleField,
  RuleOperator,
  RuleAction,
  ForcedCategory,
} from "@/lib/types";

// ── Constants ─────────────────────────────────────────────────────────────────

const FIELDS: { value: RuleField; label: string }[] = [
  { value: "sender", label: "Sender (email)" },
  { value: "subject", label: "Subject" },
  { value: "body", label: "Body" },
  { value: "sender_domain", label: "Sender Domain" },
];

const OPERATORS: { value: RuleOperator; label: string }[] = [
  { value: "contains", label: "contains" },
  { value: "not_contains", label: "does not contain" },
  { value: "equals", label: "equals" },
  { value: "starts_with", label: "starts with" },
  { value: "ends_with", label: "ends with" },
  { value: "regex", label: "matches regex" },
];

const ACTIONS: { value: RuleAction; label: string }[] = [
  { value: "force_category", label: "Force Category" },
  { value: "skip_ai", label: "Skip AI Processing" },
  { value: "trash", label: "Move to Trash" },
  { value: "alert", label: "Send Alert" },
  { value: "skip_draft", label: "Skip Draft Generation" },
];

const CATEGORIES: { value: ForcedCategory; label: string }[] = [
  { value: "urgent", label: "Urgent" },
  { value: "important", label: "Important" },
  { value: "need_reply", label: "Needs Reply" },
  { value: "newsletter", label: "Newsletter" },
  { value: "spam", label: "Spam" },
];

const DEFAULT_CATEGORY: ForcedCategory = "important";

// ── Sub-components ────────────────────────────────────────────────────────────

const CloseIcon = () => (
  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
  </svg>
);

function ResultBanner({ matched }: { matched: boolean }) {
  return (
    <div
      className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium ${
        matched
          ? "bg-emerald-50 text-emerald-700 border border-emerald-200"
          : "bg-slate-50 text-slate-600 border border-slate-200"
      }`}
    >
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          matched ? "bg-emerald-500" : "bg-slate-400"
        }`}
      />
      {matched ? "Rule matched this email." : "Rule did not match."}
    </div>
  );
}

// ── Input helpers ─────────────────────────────────────────────────────────────

const inputCls =
  "block w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 bg-white";

const labelCls = "block text-sm font-medium text-slate-700 mb-1.5";

const selectCls =
  "block w-full text-sm border border-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:opacity-50 bg-white appearance-none cursor-pointer";

// ── Types ─────────────────────────────────────────────────────────────────────

interface FormState {
  name: string;
  field: RuleField;
  operator: RuleOperator;
  value: string;
  action: RuleAction;
  action_value: string;
  priority: string;
  is_active: boolean;
}

interface RuleModalProps {
  rule: EmailRule | null;
  onClose: () => void;
  onSaved: () => void;
  onToast: (message: string, type: "success" | "error") => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RuleModal({ rule, onClose, onSaved, onToast }: RuleModalProps) {
  const isEdit = rule !== null;

  const [form, setForm] = useState<FormState>(() => ({
    name: rule?.name ?? "",
    field: rule?.field ?? "sender",
    operator: rule?.operator ?? "contains",
    value: rule?.value ?? "",
    action: rule?.action ?? "force_category",
    action_value: rule?.action_value ?? DEFAULT_CATEGORY,
    priority: rule != null ? String(rule.priority) : "",
    is_active: rule?.is_active ?? true,
  }));

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Test feature
  const [testJson, setTestJson] = useState(
    '{\n  "subject": "Test email",\n  "sender": "test@example.com",\n  "body": ""\n}',
  );
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<boolean | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  const set = useCallback(
    <K extends keyof FormState>(key: K, value: FormState[K]) =>
      setForm((prev) => ({ ...prev, [key]: value })),
    [],
  );

  // Reset action_value to sensible default when action changes
  useEffect(() => {
    if (form.action === "force_category" && !CATEGORIES.find((c) => c.value === form.action_value)) {
      set("action_value", DEFAULT_CATEGORY);
    }
  }, [form.action, form.action_value, set]);

  const handleSubmit = async () => {
    if (!form.name.trim() || !form.value.trim()) {
      setError("Name and value are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const payload = {
        name: form.name.trim(),
        field: form.field,
        operator: form.operator,
        value: form.value.trim(),
        action: form.action,
        action_value: form.action === "force_category" ? form.action_value : null,
        priority: form.priority !== "" ? parseInt(form.priority, 10) : null,
        is_active: form.is_active,
      };
      if (isEdit) {
        await api.put(`/rules/${rule.id}`, payload);
      } else {
        await api.post("/rules", payload);
      }
      onSaved();
      onToast(isEdit ? "Rule updated." : "Rule created.", "success");
      onClose();
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: { message?: string } } } })?.response?.data?.error
          ?.message;
      setError(msg ?? "Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async () => {
    if (!rule) return;
    setTestError(null);
    setTestResult(null);
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(testJson);
    } catch {
      setTestError("Invalid JSON — please fix the email object above.");
      return;
    }
    setTestLoading(true);
    try {
      const res = await api.post<{ matched: boolean }>(`/rules/${rule.id}/test`, { email: parsed });
      setTestResult(res.data.matched);
      onToast(
        res.data.matched ? "Rule matched ✓" : "Rule did not match",
        res.data.matched ? "success" : "error",
      );
    } catch {
      setTestError("Test request failed.");
    } finally {
      setTestLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 overflow-y-auto">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg my-4">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-semibold text-slate-800">
            {isEdit ? "Edit Rule" : "New Rule"}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 transition-colors"
          >
            <CloseIcon />
          </button>
        </div>

        {/* Body */}
        <div className="p-5 space-y-4">
          {/* Name */}
          <div>
            <label className={labelCls}>Rule Name</label>
            <input
              type="text"
              value={form.name}
              onChange={(e) => set("name", e.target.value)}
              disabled={saving}
              placeholder="e.g. Newsletters to skip AI"
              className={inputCls}
            />
          </div>

          {/* Condition row */}
          <div>
            <label className={labelCls}>Condition</label>
            <div className="grid grid-cols-3 gap-2">
              <select
                value={form.field}
                onChange={(e) => set("field", e.target.value as RuleField)}
                disabled={saving}
                className={selectCls}
              >
                {FIELDS.map((f) => (
                  <option key={f.value} value={f.value}>{f.label}</option>
                ))}
              </select>
              <select
                value={form.operator}
                onChange={(e) => set("operator", e.target.value as RuleOperator)}
                disabled={saving}
                className={selectCls}
              >
                {OPERATORS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
              <input
                type="text"
                value={form.value}
                onChange={(e) => set("value", e.target.value)}
                disabled={saving}
                placeholder="value…"
                className={inputCls}
              />
            </div>
          </div>

          {/* Action */}
          <div>
            <label className={labelCls}>Action</label>
            <select
              value={form.action}
              onChange={(e) => set("action", e.target.value as RuleAction)}
              disabled={saving}
              className={selectCls}
            >
              {ACTIONS.map((a) => (
                <option key={a.value} value={a.value}>{a.label}</option>
              ))}
            </select>
          </div>

          {/* action_value — only for force_category */}
          {form.action === "force_category" && (
            <div>
              <label className={labelCls}>Force to Category</label>
              <select
                value={form.action_value}
                onChange={(e) => set("action_value", e.target.value)}
                disabled={saving}
                className={selectCls}
              >
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
          )}

          {/* Priority + Active row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>
                Priority{" "}
                <span className="text-slate-400 font-normal">(auto if blank)</span>
              </label>
              <input
                type="number"
                min={0}
                value={form.priority}
                onChange={(e) => set("priority", e.target.value)}
                disabled={saving}
                placeholder="auto"
                className={inputCls}
              />
            </div>
            <div className="flex flex-col justify-end pb-0.5">
              <label className="flex items-center gap-2.5 cursor-pointer select-none">
                <button
                  type="button"
                  role="switch"
                  aria-checked={form.is_active}
                  onClick={() => set("is_active", !form.is_active)}
                  disabled={saving}
                  className={`relative inline-flex w-9 h-5 rounded-full transition-colors ${
                    form.is_active ? "bg-indigo-600" : "bg-slate-200"
                  } disabled:opacity-50`}
                >
                  <span
                    className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                      form.is_active ? "translate-x-4" : "translate-x-0"
                    }`}
                  />
                </button>
                <span className="text-sm font-medium text-slate-700">Active</span>
              </label>
            </div>
          </div>

          {error && <p className="text-sm text-rose-600">{error}</p>}

          {/* Footer buttons */}
          <div className="flex justify-end gap-2 pt-1">
            <button
              onClick={onClose}
              disabled={saving}
              className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleSubmit}
              disabled={saving}
              className="btn-primary flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? (
                <>
                  <span className="w-3.5 h-3.5 rounded-full border-2 border-white border-t-transparent animate-spin" />
                  Saving…
                </>
              ) : (
                isEdit ? "Save Changes" : "Create Rule"
              )}
            </button>
          </div>

          {/* ── Test section (edit mode only) ─────────────────────────────── */}
          {isEdit && (
            <div className="border-t border-slate-100 pt-4 space-y-3">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Test This Rule
              </p>
              <textarea
                value={testJson}
                onChange={(e) => {
                  setTestJson(e.target.value);
                  setTestResult(null);
                  setTestError(null);
                }}
                rows={5}
                spellCheck={false}
                className="block w-full text-xs font-mono border border-slate-200 rounded-lg px-3 py-2 resize-y focus:outline-none focus:ring-2 focus:ring-indigo-200 bg-slate-50"
                placeholder='{ "subject": "...", "sender": "...", "body": "..." }'
              />
              {testError && <p className="text-xs text-rose-600">{testError}</p>}
              {testResult !== null && <ResultBanner matched={testResult} />}
              <button
                onClick={handleTest}
                disabled={testLoading}
                className="px-3 py-1.5 text-sm rounded-lg border border-indigo-200 text-indigo-700 bg-indigo-50 hover:bg-indigo-100 flex items-center gap-2 disabled:opacity-50 transition-colors"
              >
                {testLoading ? (
                  <>
                    <span className="w-3 h-3 rounded-full border-2 border-indigo-400 border-t-transparent animate-spin" />
                    Testing…
                  </>
                ) : (
                  "Run Test"
                )}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
