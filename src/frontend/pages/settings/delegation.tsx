import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/router";
import useSWR from "swr";

import Layout from "@/components/Layout";
import api from "@/lib/axios";
import type { DelegationSettings, UserProfile } from "@/lib/types";

const fetcher = (url: string) => api.get(url).then((r) => r.data);

export default function DelegationSettingsPage() {
  const router = useRouter();

  const { data: user, error: authError } = useSWR<UserProfile>("/auth/me", fetcher, {
    onError: () => router.replace("/login"),
    revalidateOnFocus: false,
  });
  const { data: settings, isLoading: settingsLoading, mutate } = useSWR<DelegationSettings | null>(
    "/delegation-settings",
    fetcher,
  );

  const [header, setHeader] = useState("");
  const [signature, setSignature] = useState("");
  const [saving, setSaving] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Populate form when settings load — handle both null (no saved config) and object with null fields
  useEffect(() => {
    if (settings !== undefined) {
      setHeader(settings?.company_header ?? "");
      setSignature(settings?.signature ?? "");
    }
  }, [settings]);

  const handleSave = useCallback(async () => {
    setSaving(true);
    setError(null);
    setSavedMsg(null);
    try {
      await api.put("/delegation-settings", {
        company_header: header.trim() || null,
        signature: signature.trim() || null,
      });
      await mutate();
      setSavedMsg("Đã lưu cấu hình.");
    } catch {
      setError("Lưu thất bại. Vui lòng thử lại.");
    } finally {
      setSaving(false);
    }
  }, [header, signature, mutate]);

  if (authError) return null;

  return (
    <Layout user={user ?? null}>
      <div style={{ maxWidth: 640 }}>
            <h1 className="page-title" style={{ marginBottom: "0.25rem" }}>
              Cấu hình email phân công
            </h1>
            <p style={{ color: "#64748B", fontSize: "0.875rem", marginBottom: "2rem" }}>
              Header và chữ ký sẽ được thêm vào mọi email phân công AI soạn.
            </p>

            <div className="card" style={{ padding: "1.5rem", display: "flex", flexDirection: "column", gap: "1.5rem" }}>
              {settingsLoading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: "2rem 0" }}>
                  <span style={{ width: 20, height: 20, borderRadius: "50%", border: "2px solid #CBD5E1", borderTopColor: "#64748B", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                </div>
              ) : (
              <>
              {/* Company header */}
              <div>
                <label
                  htmlFor="company-header"
                  style={{ display: "block", fontWeight: 600, fontSize: "0.875rem", color: "#1E293B", marginBottom: "0.5rem" }}
                >
                  Header công ty
                </label>
                <p style={{ fontSize: "0.8125rem", color: "#64748B", marginBottom: "0.5rem" }}>
                  Hiển thị đầu email (ví dụ: tên công ty, địa chỉ, logo ASCII). Để trống nếu không dùng.
                </p>
                <textarea
                  id="company-header"
                  rows={4}
                  value={header}
                  onChange={(e) => setHeader(e.target.value)}
                  placeholder="Công ty TNHH ABC&#10;123 Đường XYZ, Quận 1, TP.HCM"
                  style={{
                    width: "100%",
                    padding: "0.625rem 0.75rem",
                    border: "1px solid #E2E8F0",
                    borderRadius: "0.5rem",
                    fontSize: "0.875rem",
                    fontFamily: "inherit",
                    resize: "vertical",
                    outline: "none",
                  }}
                />
              </div>

              {/* Signature */}
              <div>
                <label
                  htmlFor="signature"
                  style={{ display: "block", fontWeight: 600, fontSize: "0.875rem", color: "#1E293B", marginBottom: "0.5rem" }}
                >
                  Chữ ký
                </label>
                <p style={{ fontSize: "0.8125rem", color: "#64748B", marginBottom: "0.5rem" }}>
                  Hiển thị cuối email sau &quot;Trân trọng,&quot;. Để trống nếu không dùng.
                </p>
                <textarea
                  id="signature"
                  rows={4}
                  value={signature}
                  onChange={(e) => setSignature(e.target.value)}
                  placeholder="Nguyễn Văn A&#10;Trưởng phòng Điều phối&#10;Tel: 0900 000 000"
                  style={{
                    width: "100%",
                    padding: "0.625rem 0.75rem",
                    border: "1px solid #E2E8F0",
                    borderRadius: "0.5rem",
                    fontSize: "0.875rem",
                    fontFamily: "inherit",
                    resize: "vertical",
                    outline: "none",
                  }}
                />
              </div>

              {/* Actions */}
              <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
                <button
                  onClick={handleSave}
                  disabled={saving}
                  className="btn btn-primary"
                  style={{ minWidth: 100 }}
                >
                  {saving ? "Đang lưu…" : "Lưu"}
                </button>
                {savedMsg && (
                  <span style={{ fontSize: "0.875rem", color: "#10B981" }}>{savedMsg}</span>
                )}
                {error && (
                  <span style={{ fontSize: "0.875rem", color: "#EF4444" }}>{error}</span>
                )}
              </div>
              </> )}
            </div>

            {/* Preview */}
            {(header.trim() || signature.trim()) && (
              <div style={{ marginTop: "1.5rem" }}>
                <p style={{ fontWeight: 600, fontSize: "0.875rem", color: "#1E293B", marginBottom: "0.5rem" }}>
                  Xem trước cấu trúc email
                </p>
                <div
                  className="card"
                  style={{
                    padding: "1rem 1.25rem",
                    fontFamily: "monospace",
                    fontSize: "0.8125rem",
                    whiteSpace: "pre-wrap",
                    color: "#334155",
                    background: "#F8FAFC",
                  }}
                >
                  {header.trim() && `${header.trim()}\n\n`}
                  {`Kính gửi bộ phận [Tên phòng],\n\n`}
                  {`Câu mở đầu ngắn về bối cảnh...\n\n`}
                  {`Các công việc được giao:\n1. Công việc thứ nhất\n2. Công việc thứ hai\n\n`}
                  {`Thời hạn: [ngày]\n\n`}
                  {`Trân trọng,\n`}
                  {signature.trim() && signature.trim()}
                </div>
              </div>
            )}
      </div>
    </Layout>
  );
}
