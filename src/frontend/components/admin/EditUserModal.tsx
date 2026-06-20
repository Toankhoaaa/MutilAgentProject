import { useState } from "react";
import api from "@/lib/axios";
import type { AdminUser } from "@/lib/types";

interface Props {
  user: AdminUser;
  onClose: () => void;
  onSaved: () => void;
}

interface EditForm {
  subscription_tier: string;
  max_requests: number;
  status: string;
  tier_expires_at: string;
}

const TIERS = ["FREE", "PRO", "ENTERPRISE"] as const;

function extractError(err: unknown): string {
  return (
    (err as { response?: { data?: { error?: { message?: string } } } })
      ?.response?.data?.error?.message ?? "An unexpected error occurred."
  );
}

export default function EditUserModal({ user, onClose, onSaved }: Props) {
  const [form, setForm] = useState<EditForm>({
    subscription_tier: user.subscription_tier,
    max_requests: user.max_requests,
    status: user.status,
    tier_expires_at: user.tier_expires_at ? user.tier_expires_at.slice(0, 10) : "",
  });
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [revoked, setRevoked] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.put(`/admin/users/${user.id}`, {
        subscription_tier: form.subscription_tier,
        max_requests: form.max_requests,
        status: form.status,
        is_active: form.status === "ACTIVE",
        tier_expires_at: form.tier_expires_at
          ? new Date(form.tier_expires_at).toISOString()
          : null,
      });
      onSaved();
      onClose();
    } catch (err) {
      setSaveError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleResetUsage = async () => {
    setSaving(true);
    setSaveError(null);
    try {
      await api.put(`/admin/users/${user.id}`, { request_count: 0 });
      onSaved();
      onClose();
    } catch (err) {
      setSaveError(extractError(err));
    } finally {
      setSaving(false);
    }
  };

  const handleRevokeSession = async () => {
    setRevoking(true);
    try {
      await api.post(`/admin/users/${user.id}/revoke-session`);
      setRevoked(true);
    } catch {
      // silently fail — session may already be gone
    } finally {
      setRevoking(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm"
      onClick={() => !saving && onClose()}
    >
      <div
        className="bg-white rounded-xl shadow-xl border border-zinc-100 p-6 w-full max-w-sm mx-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-5">
          <h2 className="text-base font-semibold text-zinc-900">Edit User</h2>
          <p className="text-xs text-zinc-400 mt-0.5 truncate">{user.email}</p>
        </div>

        <div className="space-y-4">
          {/* Subscription Tier */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1.5">
              Subscription Tier
            </label>
            <select
              value={form.subscription_tier}
              onChange={(e) => setForm((f) => ({ ...f, subscription_tier: e.target.value }))}
              className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 bg-white text-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              {TIERS.map((t) => (
                <option key={t} value={t}>{t}</option>
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
              min={0}
              value={form.max_requests}
              onChange={(e) =>
                setForm((f) => ({ ...f, max_requests: Math.max(0, Number(e.target.value)) }))
              }
              className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 bg-white text-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>

          {/* Account Status */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1.5">
              Account Status
            </label>
            <select
              value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}
              className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 bg-white text-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
            >
              <option value="ACTIVE">ACTIVE</option>
              <option value="SUSPENDED">SUSPENDED</option>
            </select>
          </div>

          {/* Tier Expiry */}
          <div>
            <label className="block text-xs font-medium text-zinc-600 mb-1.5">
              Tier Expiry Date
            </label>
            <input
              type="date"
              value={form.tier_expires_at}
              onChange={(e) => setForm((f) => ({ ...f, tier_expires_at: e.target.value }))}
              className="w-full text-sm px-3 py-2 rounded-lg border border-zinc-200 bg-white text-zinc-800 focus:outline-none focus:ring-2 focus:ring-blue-200"
            />
          </div>
        </div>

        {/* Utility actions */}
        <div className="mt-5 pt-4 border-t border-zinc-100 flex flex-col gap-2">
          <button
            type="button"
            onClick={handleResetUsage}
            disabled={saving}
            className="w-full text-sm px-3 py-2 rounded-lg border border-amber-200 text-amber-700 bg-amber-50 hover:bg-amber-100 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
          >
            <span>🔄</span> Reset Usage Count
          </button>
          <button
            type="button"
            onClick={handleRevokeSession}
            disabled={revoking || revoked}
            className={`w-full text-sm px-3 py-2 rounded-lg border transition-colors flex items-center justify-center gap-2 disabled:opacity-50 ${
              revoked
                ? "border-emerald-200 text-emerald-700 bg-emerald-50"
                : "border-rose-200 text-rose-700 bg-rose-50 hover:bg-rose-100"
            }`}
          >
            <span>{revoked ? "✓" : "🔒"}</span>
            {revoking ? "Revoking…" : revoked ? "Session Revoked" : "Revoke OAuth Session"}
          </button>
        </div>

        {saveError && (
          <p className="mt-3 text-xs text-rose-600">{saveError}</p>
        )}

        <div className="flex gap-2 mt-5">
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
            onClick={onClose}
            disabled={saving}
            className="btn-secondary disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
