import '@inboxsdk/core/background';

const API_BASE = 'http://localhost:8000/api/v1';

interface AnalyzeEmailMessage {
  type: 'ANALYZE_EMAIL';
  subject: string;
  body: string;
  sender: string;
  token: string;
}

type IncomingMessage = AnalyzeEmailMessage;

chrome.runtime.onMessage.addListener(
  (message: IncomingMessage, _sender, sendResponse) => {
    if (message.type === 'ANALYZE_EMAIL') {
      const { subject, body, sender, token } = message;
      fetch(`${API_BASE}/emails/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ subject, body, sender }),
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
      return true; // keep channel open for async sendResponse
    }
  },
);
