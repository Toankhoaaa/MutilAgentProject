import { useState, useCallback } from "react";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";

interface UrgentToast {
  id: number;
  type: "NEW_URGENT_EMAIL";
  subject: string;
  summary: string;
}

interface SecurityToast {
  id: number;
  type: "SECURITY_ALERT";
  risk_level: string;
  warnings: string[];
}

type Toast = UrgentToast | SecurityToast;

let _nextId = 1;

export default function NotificationToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleMessage = useCallback(
    (msg: WsMessage) => {
      if (msg.type === "NEW_URGENT_EMAIL") {
        const toast: UrgentToast = {
          id: _nextId++,
          type: "NEW_URGENT_EMAIL",
          subject: (msg.subject as string) ?? "(No subject)",
          summary: (msg.summary as string) ?? "",
        };
        setToasts((prev) => [...prev.slice(-4), toast]);
        setTimeout(() => dismiss(toast.id), 8000);
      } else if (msg.type === "SECURITY_ALERT") {
        const toast: SecurityToast = {
          id: _nextId++,
          type: "SECURITY_ALERT",
          risk_level: (msg.risk_level as string) ?? "high",
          warnings: (msg.warnings as string[]) ?? [],
        };
        setToasts((prev) => [...prev.slice(-4), toast]);
        // Security alerts stay longer — 12s
        setTimeout(() => dismiss(toast.id), 12000);
      }
    },
    [dismiss],
  );

  useWebSocket(handleMessage);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => {
        if (t.type === "SECURITY_ALERT") {
          return (
            <div key={t.id} className="toast toast-security">
              <div className="flex-1 min-w-0">
                <p className="toast-title flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-red-400 shrink-0" fill="currentColor" viewBox="0 0 20 20">
                    <path fillRule="evenodd" d="M10 1.944A11.954 11.954 0 012.166 5C2.056 5.649 2 6.319 2 7c0 5.225 3.34 9.67 8 11.317C14.66 16.67 18 12.225 18 7c0-.682-.057-1.35-.166-2.001A11.954 11.954 0 0110 1.944zM11 14a1 1 0 11-2 0 1 1 0 012 0zm0-7a1 1 0 10-2 0v3a1 1 0 102 0V7z" clipRule="evenodd" />
                  </svg>
                  Cảnh báo bảo mật — Email nguy hiểm
                </p>
                {t.warnings.length > 0 && (
                  <ul className="mt-1 space-y-0.5">
                    {t.warnings.slice(0, 3).map((w, i) => (
                      <li key={i} className="toast-body flex items-start gap-1">
                        <span className="mt-px shrink-0">•</span>
                        <span>{w}</span>
                      </li>
                    ))}
                    {t.warnings.length > 3 && (
                      <li className="toast-body">+{t.warnings.length - 3} cảnh báo khác</li>
                    )}
                  </ul>
                )}
              </div>
              <button className="toast-close" onClick={() => dismiss(t.id)}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          );
        }

        return (
          <div key={t.id} className="toast toast-urgent">
            <div className="flex-1 min-w-0">
              <p className="toast-title">⚠ Urgent: {t.subject}</p>
              {t.summary && <p className="toast-body">{t.summary}</p>}
            </div>
            <button className="toast-close" onClick={() => dismiss(t.id)}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        );
      })}
    </div>
  );
}
