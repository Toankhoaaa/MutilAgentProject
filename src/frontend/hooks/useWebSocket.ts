import { useEffect, useRef, useCallback } from "react";

export interface WsMessage {
  type: string;
  [key: string]: unknown;
}

type MessageHandler = (msg: WsMessage) => void;

export function useWebSocket(onMessage: MessageHandler) {
  const wsRef = useRef<WebSocket | null>(null);
  const handlerRef = useRef(onMessage);
  handlerRef.current = onMessage;

  const connect = useCallback(async () => {
    // Exchange the active session cookie for a short-lived JWT.
    // /api/v1/auth/token is proxied by Next.js, so the httpOnly cookie is sent
    // automatically — no token is ever read from JS storage.
    let token: string;
    try {
      const res = await fetch("/api/v1/auth/token", { credentials: "include" });
      if (!res.ok) return; // not authenticated — skip connection
      const data = (await res.json()) as { access_token: string };
      token = data.access_token;
    } catch {
      return; // network error — skip
    }

    const wsUrl = process.env.NEXT_PUBLIC_WS_URL ?? "ws://localhost:8000";
    const ws = new WebSocket(`${wsUrl}/ws/notifications?token=${token}`);

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as WsMessage;
        handlerRef.current(data);
      } catch {
        // ignore malformed frames
      }
    };

    ws.onclose = () => {
      setTimeout(connect, 5000);
    };

    wsRef.current = ws;
  }, []);

  useEffect(() => {
    connect();
    return () => {
      wsRef.current?.close();
    };
  }, [connect]);
}
