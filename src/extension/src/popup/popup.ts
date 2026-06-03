const tokenInput = document.getElementById('token') as HTMLTextAreaElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const clearBtn = document.getElementById('clear') as HTMLButtonElement;
const fetchBtn = document.getElementById('fetch-btn') as HTMLButtonElement;
const statusDiv = document.getElementById('status') as HTMLDivElement;

const API_BASE = 'http://localhost:8000/api/v1';
const STORAGE_KEY = 'ai_reply_token';

function setStatus(msg: string, color: string) {
  statusDiv.textContent = msg;
  statusDiv.style.color = color;
}

chrome.storage.local.get(STORAGE_KEY, (result) => {
  const stored = result[STORAGE_KEY] as string | undefined;
  if (stored) tokenInput.value = stored;
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
    setStatus('Token saved.', 'green');
    setTimeout(() => setStatus('', ''), 2000);
  });
});

clearBtn.addEventListener('click', () => {
  tokenInput.value = '';
  chrome.storage.local.remove(STORAGE_KEY, () => {
    setStatus('Token cleared.', '#666');
    setTimeout(() => setStatus('', ''), 2000);
  });
});
