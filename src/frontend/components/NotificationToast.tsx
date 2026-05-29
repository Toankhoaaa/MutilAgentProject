import { useState, useCallback } from "react";
import { useWebSocket, type WsMessage } from "@/hooks/useWebSocket";

interface Toast {
  id: number;
  type: string;
  subject: string;
  summary: string;
}

let _nextId = 1;

export default function NotificationToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleMessage = useCallback(
    (msg: WsMessage) => {
      if (msg.type !== "NEW_URGENT_EMAIL") return;

      const toast: Toast = {
        id: _nextId++,
        type: msg.type,
        subject: (msg.subject as string) ?? "(No subject)",
        summary: (msg.summary as string) ?? "",
      };

      setToasts((prev) => [...prev.slice(-4), toast]);

      // auto-dismiss after 8s
      setTimeout(() => dismiss(toast.id), 8000);
    },
    [dismiss],
  );

  useWebSocket(handleMessage);

  if (toasts.length === 0) return null;

  return (
    <div className="toast-container">
      {toasts.map((t) => (
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
      ))}
    </div>
  );
}
