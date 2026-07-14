import '@inboxsdk/core/background';

const API_BASE = 'http://localhost:8000/api/v1';

interface AnalyzeEmailMessage {
  type: 'ANALYZE_EMAIL';
  subject: string;
  body: string;
  sender: string;
  token: string;
  gmail_message_id?: string | null;
}

interface SaveAttachmentMessage {
  type: 'SAVE_ATTACHMENT';
  downloadUrl: string;
  filename: string;
  sourceEmail: string;
  notes: string;
  token: string;
}

interface KeepaliveMessage {
  type: 'KEEPALIVE';
  token?: string;
}

interface CheckAnalysisCacheMessage {
  type: 'CHECK_ANALYSIS_CACHE';
  gmail_message_id: string;
  token: string;
}

type IncomingMessage = AnalyzeEmailMessage | SaveAttachmentMessage | KeepaliveMessage | CheckAnalysisCacheMessage;

// ── WebSocket persistent connection ──────────────────────────────────────────

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let cachedToken: string | null = null;

function connectWS(token?: string): void {
  if (token) cachedToken = token;
  if (!cachedToken) return; // no token yet — wait for first KEEPALIVE or authenticated message
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) return;
  ws = new WebSocket(`ws://localhost:8000/ws/notifications?token=${encodeURIComponent(cachedToken)}`);

  ws.onopen = () => {
    if (reconnectTimer !== null) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }
  };

  ws.onmessage = (event: MessageEvent<string>) => {
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(event.data) as Record<string, unknown>;
    } catch {
      return;
    }
    void chrome.tabs.query({ url: 'https://mail.google.com/*' }).then((tabs) => {
      for (const tab of tabs) {
        if (tab.id !== undefined) {
          chrome.tabs.sendMessage(tab.id, { type: 'WS_EVENT', data }).catch(() => {});
        }
      }
    });
  };

  const scheduleReconnect = () => {
    ws = null;
    if (reconnectTimer === null) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectWS();
      }, 3000);
    }
  };

  ws.onclose = () => scheduleReconnect();
  ws.onerror = () => scheduleReconnect();
}

connectWS();

// ─────────────────────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (message: IncomingMessage, _sender, sendResponse) => {
    if (message.type === 'KEEPALIVE') {
      connectWS(message.token);
      sendResponse({ ok: true });
      return true;
    }

    if (message.type === 'CHECK_ANALYSIS_CACHE') {
      const { gmail_message_id, token } = message;
      // DB-only lookup — never triggers Gemini/LLM calls. Reuses the same
      // batch endpoint the web inbox uses to skip re-running the pipeline.
      fetch(`${API_BASE}/emails/fetch-cached-analyses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify([gmail_message_id]),
      })
        .then((res) => {
          if (!res.ok) {
            return res.text().then((text) => {
              sendResponse({ ok: false, error: `HTTP ${res.status}: ${text}` });
            });
          }
          return res.json().then((data) => sendResponse({ ok: true, data }));
        })
        .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (message.type === 'ANALYZE_EMAIL') {
      const { subject, body, sender, token, gmail_message_id } = message;
      connectWS(token);
      fetch(`${API_BASE}/emails/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ subject, body, sender, ...(gmail_message_id ? { gmail_message_id } : {}) }),
      })
        .then((res) => {
          if (!res.ok) {
            return res.text().then((text) => {
              sendResponse({ ok: false, error: `HTTP ${res.status}: ${text}` });
            });
          }
          return res.json().then((data) => sendResponse({ ok: true, data }));
        })
        .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    if (message.type === 'SAVE_ATTACHMENT') {
      const { downloadUrl, filename, sourceEmail, notes, token } = message;
      connectWS(token);
      // Fetch attachment bytes then POST as multipart to the knowledge upload endpoint.
      // Running in the service worker bypasses the HTTPS→HTTP mixed-content restriction.
      fetch(downloadUrl)
        .then((res) => {
          if (!res.ok) throw new Error(`Attachment fetch failed: HTTP ${res.status}`);
          return res.blob();
        })
        .then((blob) => {
          const form = new FormData();
          form.append('file', blob, filename);
          if (sourceEmail) form.append('source_email', sourceEmail);
          if (notes) form.append('notes', notes);
          return fetch(`${API_BASE}/knowledge/upload`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form,
          });
        })
        .then((res) => {
          if (!res.ok) {
            return res.text().then((text) => {
              sendResponse({ ok: false, error: `HTTP ${res.status}: ${text}` });
            });
          }
          return res.json().then((data) => sendResponse({ ok: true, data }));
        })
        .catch((err: Error) => sendResponse({ ok: false, error: err.message }));
      return true;
    }
  },
);
