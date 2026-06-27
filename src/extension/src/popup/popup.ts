const tokenInput = document.getElementById('token') as HTMLTextAreaElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const clearBtn = document.getElementById('clear') as HTMLButtonElement;
const fetchBtn = document.getElementById('fetch-btn') as HTMLButtonElement;
const spamBtn = document.getElementById('spam-btn') as HTMLButtonElement;
const aiCleanupBtn = document.getElementById('ai-cleanup-btn') as HTMLButtonElement;
const aiStopBtn = document.getElementById('ai-stop-btn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

let _aiAbortController: AbortController | null = null;
let _aiCurrentTaskId: string | null = null;

const API_BASE = 'http://localhost:8000/api/v1';
const STORAGE_KEY = 'ai_reply_token';

function setStatus(msg: string, color: string) {
  statusDiv.textContent = msg;
  statusDiv.style.color = color;
}

chrome.storage.local.get(STORAGE_KEY, (result) => {
  const stored = result[STORAGE_KEY] as string | undefined;
  if (stored) {
    tokenInput.value = stored;
    spamBtn.disabled = false;
    aiCleanupBtn.disabled = false;
  }
});

fetchBtn.addEventListener('click', async () => {
  fetchBtn.disabled = true;
  setStatus('Fetching…', '#555');
  try {
    const res = await fetch(`${API_BASE}/auth/token`, { credentials: 'include' });
    if (!res.ok) {
      const detail = await res.json().then((d) => d.detail ?? res.statusText).catch(() => res.statusText);
      setStatus(`Error ${res.status}: ${detail}. Log in first.`, 'red');
      return;
    }
    const data = (await res.json()) as { access_token: string };
    await chrome.storage.local.set({ [STORAGE_KEY]: data.access_token });
    tokenInput.value = data.access_token;
    spamBtn.disabled = false;
    aiCleanupBtn.disabled = false;
    setStatus('Token saved automatically.', 'green');
    setTimeout(() => setStatus('', ''), 3000);
  } catch {
    setStatus('Could not reach localhost:8000. Is the backend running?', 'red');
  } finally {
    fetchBtn.disabled = false;
  }
});

saveBtn.addEventListener('click', () => {
  const token = tokenInput.value.trim();
  if (!token) {
    setStatus('Paste a token first.', 'red');
    return;
  }
  chrome.storage.local.set({ [STORAGE_KEY]: token }, () => {
    spamBtn.disabled = false;
    aiCleanupBtn.disabled = false;
    setStatus('Token saved.', 'green');
    setTimeout(() => setStatus('', ''), 2000);
  });
});

clearBtn.addEventListener('click', () => {
  tokenInput.value = '';
  chrome.storage.local.remove(STORAGE_KEY, () => {
    spamBtn.disabled = true;
    aiCleanupBtn.disabled = true;
    setStatus('Token cleared.', '#666');
    setTimeout(() => setStatus('', ''), 2000);
  });
});

spamBtn.addEventListener('click', async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const token = stored[STORAGE_KEY] as string | undefined;
  if (!token) {
    setStatus('Chưa có token. Vui lòng đăng nhập trước.', 'red');
    return;
  }

  spamBtn.disabled = true;
  spamBtn.textContent = 'Đang dọn dẹp…';
  setStatus('', '');

  try {
    const res = await fetch(`${API_BASE}/emails/cleanup-spam`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const detail = await res.json().then((d: { detail?: string }) => d.detail ?? res.statusText).catch(() => res.statusText);
      setStatus(`Lỗi ${res.status}: ${detail}`, 'red');
      return;
    }
    const data = (await res.json()) as { trashed: number; errors: number };
    setStatus(`Đã dọn dẹp xong ${data.trashed} tin nhắn spam.`, 'green');
    setTimeout(() => setStatus('', ''), 5000);
  } catch {
    setStatus('Không thể kết nối backend. Backend có đang chạy không?', 'red');
  } finally {
    spamBtn.disabled = false;
    spamBtn.textContent = 'Dọn dẹp thư mục SPAM';
  }
});

aiCleanupBtn.addEventListener('click', async () => {
  const stored = await chrome.storage.local.get(STORAGE_KEY);
  const token = stored[STORAGE_KEY] as string | undefined;
  if (!token) {
    setStatus('Chưa có token. Vui lòng đăng nhập trước.', 'red');
    return;
  }

  const taskId = crypto.randomUUID();
  const controller = new AbortController();
  _aiAbortController = controller;
  _aiCurrentTaskId = taskId;

  aiCleanupBtn.disabled = true;
  aiStopBtn.style.display = 'inline-block';
  aiCleanupBtn.textContent = 'Đang phân loại…';
  setStatus('AI đang quét hộp thư…', '#555');

  try {
    const res = await fetch(`${API_BASE}/emails/cleanup-inbox`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ task_id: taskId }),
      signal: controller.signal,
    });
    if (!res.ok) {
      const detail = await res.json().then((d: { detail?: string }) => d.detail ?? res.statusText).catch(() => res.statusText);
      setStatus(`Lỗi ${res.status}: ${detail}`, 'red');
      return;
    }
    const data = (await res.json()) as { scanned: number; trashed: number; skipped: number; errors: number };
    setStatus(
      `Quét ${data.scanned} email — xóa ${data.trashed}, bỏ qua ${data.skipped}${data.errors ? `, lỗi ${data.errors}` : ''}.`,
      'green',
    );
    setTimeout(() => setStatus('', ''), 7000);
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      setStatus('Đã hủy tạo nội dung', '#555');
      setTimeout(() => setStatus('', ''), 4000);
    } else {
      setStatus('Không thể kết nối backend. Backend có đang chạy không?', 'red');
    }
  } finally {
    _aiAbortController = null;
    _aiCurrentTaskId = null;
    aiCleanupBtn.disabled = false;
    aiStopBtn.style.display = 'none';
    aiCleanupBtn.textContent = 'Dọn dẹp hộp thư (AI)';
  }
});

aiStopBtn.addEventListener('click', () => {
  _aiAbortController?.abort();
  const taskId = _aiCurrentTaskId;
  if (taskId) {
    chrome.storage.local.get(STORAGE_KEY, (result) => {
      const token = result[STORAGE_KEY] as string | undefined;
      if (token) {
        fetch(`${API_BASE}/pipeline/${taskId}/cancel`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
        }).catch(() => {});
      }
    });
  }
});
