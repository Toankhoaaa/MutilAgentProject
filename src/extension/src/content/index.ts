import * as InboxSDK from '@inboxsdk/core';
import axios from 'axios';
import { getSnippets, type Snippet } from '../services/storage';

const APP_ID = 'sdk_muiltiAgent_7834f5e8f1';
const API_BASE = 'http://localhost:8000/api/v1';

const AI_REPLY_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%234285f4'%3E%3Cpath d='M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z'/%3E%3C/svg%3E";

const TONE_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%235f6368'%3E%3Cpath d='M2.5 4v3h5v12h3V7h5V4h-13zm19 5h-9v3h3v7h3v-7h3V9z'/%3E%3C/svg%3E";

const AI_ANALYSIS_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%230f9d58'%3E%3Cpath d='M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z'/%3E%3C/svg%3E";

const SNOOZE_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%235f6368'%3E%3Cpath d='M7.88 3.39L6.6 1.86 2 5.71l1.29 1.53 4.59-3.85zM22 5.72l-4.6-3.86-1.29 1.53 4.6 3.86L22 5.72zM12 4c-4.97 0-9 4.03-9 9s4.02 9 9 9c4.97 0 9-4.03 9-9s-4.03-9-9-9zm0 16c-3.87 0-7-3.13-7-7s3.13-7 7-7 7 3.13 7 7-3.13 7-7 7zm-1.5-11.5v5.25l4.5 2.67-.75 1.23L9 15V8.5h1.5z'/%3E%3C/svg%3E";

const KB_SAVE_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%236366f1'%3E%3Cpath d='M4 7c0-1.657 3.582-3 8-3s8 1.343 8 3M4 7v5c0 1.657 3.582 3 8 3s8-1.343 8-3V7M4 12v5c0 1.657 3.582 3 8 3s8-1.343 8-3v-5'/%3E%3C/svg%3E";

const TONES = ['Formal', 'Polite', 'Professional', 'Friendly', 'Casual'] as const;
type Tone = typeof TONES[number];

interface ProcessEmailResult {
  category: string;
  priority_score: number;
  summary: string;
  confidence: number;
  draft_content: string | null;
  draft_subject: string | null;
}

function escapeHtml(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

function safeSetBodyHTML(view: InboxSDK.ComposeView, html: string): void {
  try {
    view.setBodyHTML(html);
  } catch (e) {
    console.warn('[AI Reply] setBodyHTML failed (compose may be closing):', e);
  }
}

// ── Toast Notification System ─────────────────────────────────────────────

interface ToastOptions {
  title: string;
  body: string;
  color?: string;
  bgColor?: string;
  pulse?: boolean;
  duration?: number;
  action?: { label: string; onClick: () => void };
}

const toastContainer = document.createElement('div');
toastContainer.style.cssText = [
  'position:fixed',
  'bottom:20px',
  'right:20px',
  'z-index:2147483647',
  'pointer-events:none',
  'display:flex',
  'flex-direction:column-reverse',
  'gap:8px',
  'align-items:flex-end',
].join(';');
document.body.appendChild(toastContainer);

function showToast(opts: ToastOptions): void {
  const { title, body, color = '#fff', bgColor = '#333', pulse = false, duration = 5000, action } = opts;

  const toast = document.createElement('div');

  const style = document.createElement('style');
  style.textContent = `
    @keyframes slideIn { from { transform: translateX(110%); opacity: 0; } to { transform: translateX(0); opacity: 1; } }
    @keyframes pulse { 0%,100% { box-shadow: 0 4px 16px rgba(0,0,0,.3); } 50% { box-shadow: 0 0 0 6px ${bgColor}55, 0 4px 20px rgba(0,0,0,.4); } }
  `;
  toast.appendChild(style);

  toast.style.cssText = [
    `background:${bgColor}`,
    `color:${color}`,
    'border-radius:10px',
    'padding:12px 16px',
    'min-width:280px',
    'max-width:360px',
    'box-shadow:0 4px 16px rgba(0,0,0,.3)',
    'pointer-events:all',
    'font-family:Google Sans,Roboto,sans-serif',
    `animation:slideIn .3s ease${pulse ? ',pulse 1.5s ease-in-out .3s infinite' : ''}`,
  ].join(';');

  const titleEl = document.createElement('div');
  titleEl.style.cssText = 'font-size:13px;font-weight:600;margin-bottom:4px';
  titleEl.textContent = title;

  const bodyEl = document.createElement('div');
  bodyEl.style.cssText = 'font-size:12px;opacity:.9;line-height:1.4';
  bodyEl.textContent = body;

  toast.appendChild(titleEl);
  toast.appendChild(bodyEl);

  if (action) {
    const btn = document.createElement('button');
    btn.textContent = action.label;
    btn.style.cssText = [
      'display:block',
      'margin-top:8px',
      'padding:4px 12px',
      'border:1.5px solid rgba(255,255,255,.7)',
      'border-radius:6px',
      'background:transparent',
      `color:${color}`,
      'font-size:12px',
      'font-family:Google Sans,Roboto,sans-serif',
      'cursor:pointer',
      'font-weight:600',
    ].join(';');
    btn.addEventListener('click', action.onClick);
    toast.appendChild(btn);
  }

  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), duration);
}

function handleWsEvent(data: Record<string, unknown>): void {
  const type = typeof data.type === 'string' ? data.type : '';
  const title = typeof data.title === 'string' ? data.title : '';
  const body = typeof data.body === 'string' ? data.body : '';
  const schedulingId = typeof data.scheduling_id === 'string' ? data.scheduling_id : undefined;

  if (type === 'NEW_URGENT_EMAIL') {
    showToast({ title: title || 'New Urgent Email', body, color: '#fff', bgColor: '#e37400' });
  } else if (type === 'SECURITY_ALERT') {
    showToast({ title: title || 'Security Alert', body, color: '#fff', bgColor: '#d93025', pulse: true, duration: 12000 });
  } else if (type === 'NEW_CALENDAR_EVENT') {
    showToast({
      title: title || 'New Calendar Event',
      body,
      color: '#fff',
      bgColor: '#0f9d58',
      duration: 15000,
      action: schedulingId ? {
        label: 'Confirm on Calendar',
        onClick: () => {
          void chrome.storage.local.get('ai_reply_token').then((stored) => {
            const token = stored['ai_reply_token'] as string | undefined;
            if (!token) return;
            fetch(`${API_BASE}/emails/scheduled-events/${schedulingId}/confirm`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
            }).catch(() => {});
          });
        },
      } : undefined,
    });
  } else if (type === 'SNOOZED_EMAIL_DUE') {
    const subj = typeof data.subject === 'string' ? data.subject : 'Email';
    const threadId = typeof data.thread_id === 'string' ? data.thread_id : undefined;
    showToast({
      title: '⏰ Snooze Reminder',
      body: subj || 'A snoozed email is ready for your attention.',
      color: '#fff',
      bgColor: '#1a73e8',
      pulse: true,
      duration: 15000,
      action: threadId ? {
        label: 'Open Thread',
        onClick: () => {
          window.open(`https://mail.google.com/mail/u/0/#inbox/${threadId}`, '_blank');
        },
      } : undefined,
    });
  }
}

// ── Snippet Engine ────────────────────────────────────────────────────────

let snippetCache: Snippet[] | null = null;

// Tracks the last active compose view and cursor position so the popup can insert templates
interface ComposeViewRef { getBodyElement(): Element | null; }
let lastComposeView: ComposeViewRef | null = null;
let lastRange: Range | null = null;

chrome.runtime.onMessage.addListener((msg: { type: string; content?: string; language?: string; data?: Record<string, unknown> }) => {
  if (msg.type === 'WS_EVENT' && msg.data) {
    handleWsEvent(msg.data);
    return;
  }
  if (msg.type !== 'INSERT_TEMPLATE' || !lastComposeView) return;
  const body = lastComposeView.getBodyElement();
  if (!body) return;
  (body as HTMLElement).focus();
  const sel = window.getSelection();
  if (sel && lastRange) {
    sel.removeAllRanges();
    sel.addRange(lastRange);
  }
  const cmd = msg.language === 'template' ? 'insertHTML' : 'insertText';
  document.execCommand(cmd, false, msg.content);
});

setInterval(() => {
  void chrome.storage.local.get('ai_reply_token').then((stored) => {
    const token = stored['ai_reply_token'] as string | undefined;
    chrome.runtime.sendMessage({ type: 'KEEPALIVE', token }).catch(() => {});
  });
}, 20000);

function debounce<T extends unknown[]>(fn: (...args: T) => void, ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  return (...args: T): void => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

async function warmSnippetCache(): Promise<void> {
  snippetCache = await getSnippets();
}

// Invalidate after a quiet period so rapid snippet saves don't thrash storage reads
const invalidateSnippetCache = debounce(() => {
  snippetCache = null;
}, 300);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && 'snippets' in changes) invalidateSnippetCache();
});

// ── Inbox Priority Badges ─────────────────────────────────────────────────────

const BADGE_CONFIG: Record<string, { bg: string; fg: string; label: string }> = {
  urgent:     { bg: '#d93025', fg: '#fff', label: '🔴 Urgent' },
  important:  { bg: '#e37400', fg: '#fff', label: '🟠 Important' },
  need_reply: { bg: '#1a73e8', fg: '#fff', label: '💬 Reply' },
  newsletter: { bg: '#6366f1', fg: '#fff', label: '📰 Newsletter' },
  spam:       { bg: '#80868b', fg: '#fff', label: '🚫 Spam' },
};

const BADGE_CACHE_TTL_MS = 8 * 60 * 1000; // 8 minutes — allows re-classify after new message arrives
const badgeCache = new Map<string, { category: string; priority_score: number; expiresAt: number }>();
const pendingRows = new Map<string, InboxSDK.ThreadRowView>();
let batchTimer: ReturnType<typeof setTimeout> | null = null;

function applyBadge(row: InboxSDK.ThreadRowView, category: string): void {
  const cfg = BADGE_CONFIG[category];
  if (!cfg) return;
  row.addLabel({
    title: cfg.label,
    foregroundColor: cfg.fg,
    backgroundColor: cfg.bg,
    maxWidth: '90px',
  });
}

async function flushBatch(token: string): Promise<void> {
  const snapshot = new Map(pendingRows);
  pendingRows.clear();
  batchTimer = null;

  if (snapshot.size === 0) return;

  const items = Array.from(snapshot.entries()).map(([thread_id, row]) => ({
    thread_id,
    subject: row.getSubject(),
    snippet: '',
    sender: row.getContacts()[0]?.emailAddress ?? null,
  }));

  try {
    const response = await fetch(`${API_BASE}/emails/classify-quick`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(items),
    });

    if (!response.ok) return;

    const results: Array<{ thread_id: string; category: string; priority_score: number; confidence: number }> =
      await response.json() as Array<{ thread_id: string; category: string; priority_score: number; confidence: number }>;

    for (const result of results) {
      badgeCache.set(result.thread_id, { category: result.category, priority_score: result.priority_score, expiresAt: Date.now() + BADGE_CACHE_TTL_MS });
      const row = snapshot.get(result.thread_id);
      if (row) applyBadge(row, result.category);
    }
  } catch {
    // Silently ignore network errors so the inbox remains functional
  }
}

// ─────────────────────────────────────────────────────────────────────────────

function attachSnippetEngine(composeView: InboxSDK.ComposeView): void {
  const body = composeView.getBodyElement();
  if (!body) return;

  let buffer = '';

  // ── Slash-command dropdown state ────────────────────────────────────────
  let slashQuery: string | null = null;
  let selectedIndex = 0;
  let filteredItems: Snippet[] = [];
  let dropdown: HTMLDivElement | null = null;

  function positionDropdown(): void {
    if (!dropdown) return;
    const sel = window.getSelection();
    if (!sel || !sel.rangeCount) return;
    const r = sel.getRangeAt(0).cloneRange();
    r.collapse(true);
    const rect = r.getBoundingClientRect();
    dropdown.style.top = `${rect.bottom + 6}px`;
    dropdown.style.left = `${Math.max(rect.left, 8)}px`;
  }

  function renderItems(): void {
    if (!dropdown) return;
    const el = dropdown;
    el.innerHTML = '';
    if (filteredItems.length === 0) {
      const msg = document.createElement('div');
      msg.style.cssText = 'padding:8px 14px;color:#80868b;font-size:12px';
      msg.textContent = 'No templates found';
      el.appendChild(msg);
      return;
    }
    filteredItems.forEach((item, i) => {
      const row = document.createElement('div');
      row.style.cssText = [
        'padding:7px 14px',
        'cursor:pointer',
        `background:${i === selectedIndex ? '#e8f0fe' : '#fff'}`,
        i < filteredItems.length - 1 ? 'border-bottom:1px solid #f1f3f4' : '',
      ].join(';');
      const trig = document.createElement('div');
      trig.style.cssText = 'font-weight:600;color:#1a73e8;font-size:12px';
      trig.textContent = item.trigger;
      const preview = document.createElement('div');
      preview.style.cssText = 'color:#5f6368;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:230px;margin-top:2px';
      preview.textContent = item.content.length > 60 ? item.content.slice(0, 60) + '…' : item.content;
      row.appendChild(trig);
      row.appendChild(preview);
      row.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        selectedIndex = i;
        confirmSelection();
      });
      el.appendChild(row);
    });
  }

  function applyFilter(): void {
    const cache = snippetCache ?? [];
    filteredItems = slashQuery
      ? cache.filter((s) => s.trigger.toLowerCase().includes(slashQuery!.toLowerCase()))
      : [...cache];
    selectedIndex = Math.min(selectedIndex, Math.max(filteredItems.length - 1, 0));
    renderItems();
    positionDropdown();
  }

  function showDropdown(): void {
    if (!dropdown) {
      dropdown = document.createElement('div');
      dropdown.style.cssText = [
        'position:fixed',
        'z-index:2147483647',
        'background:#fff',
        'border:1px solid #dadce0',
        'border-radius:8px',
        'box-shadow:0 2px 10px rgba(0,0,0,.2)',
        'max-height:220px',
        'overflow-y:auto',
        'min-width:260px',
        'font-family:Google Sans,Roboto,sans-serif',
      ].join(';');
      document.body.appendChild(dropdown);
    }
    applyFilter();
  }

  function hideDropdown(): void {
    dropdown?.remove();
    dropdown = null;
    slashQuery = null;
    selectedIndex = 0;
    filteredItems = [];
  }

  function confirmSelection(): void {
    if (filteredItems.length === 0 || slashQuery === null) { hideDropdown(); return; }
    const snippet = filteredItems[selectedIndex];
    if (!snippet) { hideDropdown(); return; }
    const sel = window.getSelection();
    if (sel && sel.rangeCount) {
      // All chars of "/<query>" are in the DOM (Tab is not a printable insert)
      for (let i = 0; i < slashQuery.length + 1; i++) {
        sel.modify('extend', 'backward', 'character');
      }
      const cmd = snippet.language === 'template' ? 'insertHTML' : 'insertText';
      document.execCommand(cmd, false, snippet.content);
    }
    buffer = '';
    hideDropdown();
  }

  // Close dropdown when clicking outside
  const onOutsideClick = (e: MouseEvent) => {
    if (dropdown && !dropdown.contains(e.target as Node)) hideDropdown();
  };
  document.addEventListener('mousedown', onOutsideClick);

  // ── Lifecycle ────────────────────────────────────────────────────────────
  if (!snippetCache) void warmSnippetCache();

  body.addEventListener('blur', () => {
    lastComposeView = composeView;
    const sel = window.getSelection();
    if (sel && sel.rangeCount) lastRange = sel.getRangeAt(0).cloneRange();
  });

  composeView.on('destroy', () => {
    hideDropdown();
    document.removeEventListener('mousedown', onOutsideClick);
  });

  // ── Keydown ──────────────────────────────────────────────────────────────
  body.addEventListener('keydown', (e: KeyboardEvent) => {

    // ── Dropdown mode ──
    if (slashQuery !== null && dropdown) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, filteredItems.length - 1);
        renderItems();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        renderItems();
        return;
      }
      if (e.key === 'Tab') {
        e.preventDefault();
        confirmSelection();
        return;
      }
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        hideDropdown();
        buffer = '';
        return; // don't preventDefault — let the char/newline/space through
      }
      if (e.key === 'Backspace') {
        if (slashQuery.length === 0) {
          hideDropdown();
        } else {
          slashQuery = slashQuery.slice(0, -1);
          selectedIndex = 0;
          applyFilter();
        }
        buffer = buffer.slice(0, -1);
        return;
      }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        slashQuery += e.key;
        selectedIndex = 0;
        applyFilter();
        buffer = (buffer + e.key).slice(-20);
        return; // char inserts normally (no preventDefault)
      }
      return;
    }

    // ── Normal mode ──
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Backspace') { buffer = buffer.slice(0, -1); return; }
    if (e.key === 'Escape' || e.key === 'Enter') { buffer = ''; return; }
    if (e.key.length !== 1) return;

    // "/" at a word boundary opens the slash-command picker
    if (e.key === '/' && (buffer === '' || /[\s\n]$/.test(buffer))) {
      buffer = (buffer + '/').slice(-20);
      slashQuery = '';
      selectedIndex = 0;
      if (!snippetCache) {
        void warmSnippetCache().then(() => { if (slashQuery !== null) showDropdown(); });
      } else {
        showDropdown();
      }
      return; // "/" inserts normally (no preventDefault)
    }

    // Auto-expand trigger detection
    const tentative = (buffer + e.key).slice(-20);
    const cache = snippetCache;

    if (cache) {
      for (const snippet of cache) {
        if (tentative.endsWith(snippet.trigger)) {
          e.preventDefault();
          const sel = window.getSelection();
          if (sel && sel.rangeCount) {
            for (let i = 0; i < snippet.trigger.length - 1; i++) {
              sel.modify('extend', 'backward', 'character');
            }
            const cmd = snippet.language === 'template' ? 'insertHTML' : 'insertText';
            document.execCommand(cmd, false, snippet.content);
          }
          buffer = tentative.slice(0, -snippet.trigger.length);
          return;
        }
      }
    } else {
      void warmSnippetCache();
    }

    buffer = tentative;
  });
}

// ─────────────────────────────────────────────────────────────────────────────

InboxSDK.load(2, APP_ID).then((sdk) => {
  // Track open thread views by thread ID so the compose handler can read them
  const threadViews = new Map<string, InboxSDK.ThreadView>();

  // Guards the cached-security-banner check below so it fires once per
  // message ID per session, not on every re-render of the same thread.
  const securityCacheChecked = new Set<string>();

  // ── Knowledge Base: floating save modal ─────────────────────────────────────
  const kbModal = document.createElement('div');
  kbModal.style.cssText = [
    'display:none',
    'position:fixed',
    'inset:0',
    'z-index:2147483647',
    'background:rgba(0,0,0,.45)',
    'align-items:center',
    'justify-content:center',
  ].join(';');

  const kbModalBox = document.createElement('div');
  kbModalBox.style.cssText = [
    'background:#fff',
    'border-radius:12px',
    'box-shadow:0 8px 32px rgba(0,0,0,.22)',
    'padding:20px 22px 18px',
    'width:400px',
    'font-family:Google Sans,Roboto,sans-serif',
  ].join(';');
  kbModal.appendChild(kbModalBox);
  document.body.appendChild(kbModal);

  let kbSaveHandler: (() => void) | null = null;

  function openKBModal(
    getDownloadURL: () => Promise<string | null | undefined>,
    filename: string,
    sourceEmail: string,
  ): void {
    kbModalBox.innerHTML = '';

    // Title
    const title = document.createElement('div');
    title.style.cssText = 'font-size:14px;font-weight:600;color:#202124;margin-bottom:14px';
    title.textContent = `Save "${filename}" to Knowledge Base`;
    kbModalBox.appendChild(title);

    // Notes label + textarea
    const notesLabel = document.createElement('div');
    notesLabel.style.cssText = 'font-size:12px;color:#5f6368;margin-bottom:5px';
    notesLabel.textContent = 'Notes (optional)';
    kbModalBox.appendChild(notesLabel);

    const notesArea = document.createElement('textarea');
    notesArea.rows = 3;
    notesArea.placeholder = 'Add context about this document…';
    notesArea.style.cssText = [
      'width:100%',
      'box-sizing:border-box',
      'border:1px solid #dadce0',
      'border-radius:6px',
      'padding:8px 10px',
      'font-size:13px',
      'font-family:Google Sans,Roboto,sans-serif',
      'resize:none',
      'outline:none',
      'color:#202124',
    ].join(';');
    kbModalBox.appendChild(notesArea);

    // Status line
    const statusLine = document.createElement('div');
    statusLine.style.cssText = 'font-size:12px;min-height:18px;margin:8px 0 12px';
    kbModalBox.appendChild(statusLine);

    // Buttons
    const btnRow = document.createElement('div');
    btnRow.style.cssText = 'display:flex;justify-content:flex-end;gap:8px';

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = [
      'padding:7px 16px',
      'border:1px solid #dadce0',
      'border-radius:6px',
      'background:#fff',
      'color:#3c4043',
      'font-size:13px',
      'font-family:Google Sans,Roboto,sans-serif',
      'cursor:pointer',
    ].join(';');
    cancelBtn.addEventListener('click', () => { kbModal.style.display = 'none'; });

    const saveBtn = document.createElement('button');
    saveBtn.textContent = 'Save to KB';
    saveBtn.style.cssText = [
      'padding:7px 16px',
      'border:none',
      'border-radius:6px',
      'background:#6366f1',
      'color:#fff',
      'font-size:13px',
      'font-family:Google Sans,Roboto,sans-serif',
      'cursor:pointer',
      'font-weight:600',
    ].join(';');

    btnRow.appendChild(cancelBtn);
    btnRow.appendChild(saveBtn);
    kbModalBox.appendChild(btnRow);

    kbSaveHandler = () => {
      saveBtn.disabled = true;
      cancelBtn.disabled = true;
      statusLine.style.color = '#5f6368';
      statusLine.textContent = '⏳ Downloading attachment…';

      void (async () => {
        try {
          const stored = await chrome.storage.local.get('ai_reply_token');
          const token = stored['ai_reply_token'] as string | undefined;
          if (!token) {
            statusLine.style.color = '#d93025';
            statusLine.textContent = '❌ No API token saved. Open the extension popup first.';
            saveBtn.disabled = false;
            cancelBtn.disabled = false;
            return;
          }

          const url = await getDownloadURL();
          if (!url) {
            statusLine.style.color = '#d93025';
            statusLine.textContent = '❌ Could not get download URL for this attachment.';
            saveBtn.disabled = false;
            cancelBtn.disabled = false;
            return;
          }

          const response = await new Promise<{ ok: boolean; error?: string }>(
            (resolve) => chrome.runtime.sendMessage(
              {
                type: 'SAVE_ATTACHMENT',
                downloadUrl: url,
                filename,
                sourceEmail,
                notes: notesArea.value.trim(),
                token,
              },
              resolve,
            ),
          );

          if (!response.ok) {
            statusLine.style.color = '#d93025';
            statusLine.textContent = `❌ ${response.error ?? 'Upload failed.'}`;
            saveBtn.disabled = false;
            cancelBtn.disabled = false;
            return;
          }

          statusLine.style.color = '#0f9d58';
          statusLine.textContent = '✓ Saved! AI summary is generating in the background.';
          cancelBtn.textContent = 'Close';
          cancelBtn.disabled = false;
          saveBtn.style.display = 'none';
        } catch (err) {
          statusLine.style.color = '#d93025';
          statusLine.textContent = `❌ ${(err as Error).message}`;
          saveBtn.disabled = false;
          cancelBtn.disabled = false;
        }
      })();
    };

    saveBtn.addEventListener('click', () => kbSaveHandler?.());
    kbModal.style.display = 'flex';
    notesArea.focus();
  }

  kbModal.addEventListener('mousedown', (e) => {
    if (e.target === kbModal) kbModal.style.display = 'none';
  });

  // ── Attachment button injection ───────────────────────────────────────────
  // WeakSet prevents adding duplicate buttons if messageViewsChanged fires again
  const processedAttachmentCards = new WeakSet<Element>();

  function injectKBButtons(mv: InboxSDK.MessageView, subject: string): void {
    if (!mv.isLoaded()) return;
    const sender = mv.getSender()?.emailAddress ?? '';
    const sourceEmail = [sender, subject].filter(Boolean).join(' — ');

    for (const card of mv.getFileAttachmentCardViews()) {
      if (card.getAttachmentType() !== 'FILE') continue;
      const filename = card.getTitle();
      if (!/\.(pdf|docx)$/i.test(filename)) continue;
      const el = card.getElement();
      if (processedAttachmentCards.has(el)) continue;
      processedAttachmentCards.add(el);

      card.addButton({
        iconUrl: KB_SAVE_ICON,
        tooltip: 'Save to AI Knowledge Base',
        onClick: (event) => {
          const getUrl = event?.getDownloadURL ?? (() => card.getDownloadURL());
          openKBModal(getUrl, filename, sourceEmail);
        },
      });
    }
  }

  sdk.Conversations.registerThreadViewHandler(async (threadView) => {
    const id = await threadView.getThreadIDAsync();
    threadViews.set(id, threadView);
    threadView.on('destroy', () => threadViews.delete(id));

    // Display-only: show a previously-cached security verdict immediately on
    // open. Never triggers a new analysis — only reads email_analysis_cache.
    checkAndShowCachedSecurity(threadView);
  });

  sdk.Lists.registerThreadRowViewHandler((row) => {
    const threadId = row.getThreadIDIfStable();
    if (!threadId) return;

    const cached = badgeCache.get(threadId);
    if (cached && Date.now() < cached.expiresAt) {
      applyBadge(row, cached.category);
      return;
    }

    pendingRows.set(threadId, row);

    if (!batchTimer) {
      batchTimer = setTimeout(() => {
        void chrome.storage.local.get('ai_reply_token').then((stored) => {
          const token = stored['ai_reply_token'] as string | undefined;
          if (token) {
            void flushBatch(token);
          } else {
            pendingRows.clear();
            batchTimer = null;
          }
        });
      }, 400);
    }
  });

  // registerMessageViewHandler fires once per message as it loads — reliable
  // for both initial messages and new ones added to a thread later.
  sdk.Conversations.registerMessageViewHandler((mv) => {
    const subject = mv.getThreadView().getSubject();
    injectKBButtons(mv, subject);
  });

  // ── AI Analysis button (thread toolbar — visible, not hidden in overflow) ──

  interface AnalyzeResponse {
    summary: string[];
    sentiment: string;
    action_items: string[];
    translation: string | null;
    detected_language: string;
    has_event: boolean;
    event_details: { event_title: string | null; start_time: string | null; end_time: string | null; attendees: string[] } | null;
    is_safe: boolean;
    risk_level: 'low' | 'medium' | 'high';
    warnings: string[];
  }

  function sentimentColor(s: string): string {
    if (s === 'Positive') return '#0f9d58';
    if (s === 'Negative') return '#d93025';
    return '#5f6368';
  }

  function formatIso(iso: string | null): string {
    if (!iso) return '';
    try {
      return new Date(iso).toLocaleString('vi-VN', {
        day: '2-digit', month: '2-digit', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      });
    } catch { return iso; }
  }

  // Single floating panel shared across all threads
  const summaryPanel = document.createElement('div');
  summaryPanel.setAttribute('data-ai-summary-panel', '');
  summaryPanel.style.cssText = [
    'display:none',
    'position:fixed',
    'z-index:2147483647',
    'background:#fff',
    'border:1px solid #dadce0',
    'border-radius:12px',
    'box-shadow:0 4px 16px rgba(0,0,0,.18)',
    'padding:16px 18px',
    'font-family:Google Sans,Roboto,sans-serif',
    'min-width:320px',
    'max-width:420px',
    'max-height:70vh',
    'overflow-y:auto',
    'right:24px',
    'top:80px',
  ].join(';');

  const summaryCloseBtn = document.createElement('button');
  summaryCloseBtn.innerHTML = '&times;';
  summaryCloseBtn.title = 'Đóng';
  summaryCloseBtn.style.cssText = [
    'position:absolute',
    'top:10px',
    'right:12px',
    'background:none',
    'border:none',
    'font-size:18px',
    'color:#5f6368',
    'cursor:pointer',
    'line-height:1',
  ].join(';');
  summaryCloseBtn.addEventListener('click', () => { summaryPanel.style.display = 'none'; });
  summaryPanel.appendChild(summaryCloseBtn);

  const panelContent = document.createElement('div');
  summaryPanel.appendChild(panelContent);
  document.body.appendChild(summaryPanel);

  function renderLoading(): void {
    panelContent.innerHTML = [
      '<div style="display:flex;align-items:center;gap:10px;color:#5f6368;font-size:13px;padding:8px 0">',
      '<svg style="width:18px;height:18px;animation:spin 1s linear infinite" viewBox="0 0 24 24" fill="none">',
      '<circle cx="12" cy="12" r="10" stroke="#dadce0" stroke-width="3"/>',
      '<path d="M12 2a10 10 0 0 1 10 10" stroke="#1a73e8" stroke-width="3" stroke-linecap="round"/>',
      '</svg>Đang phân tích email...</div>',
      '<style>@keyframes spin{to{transform:rotate(360deg)}}</style>',
    ].join('');
  }

  function renderError(msg: string): void {
    panelContent.innerHTML = `<div style="color:#d93025;font-size:13px;padding:8px 0">❌ ${escapeHtml(msg)}</div>`;
  }

  let currentNoticeBar: InboxSDK.SimpleElementView | null = null;

  function injectSecurityBanner(threadView: InboxSDK.ThreadView, riskLevel: string, warnings: string[]): void {
    if (currentNoticeBar && !currentNoticeBar.destroyed) currentNoticeBar.destroy();
    currentNoticeBar = null;
    if (riskLevel === 'low') return;

    const isHigh = riskLevel === 'high';
    const colors = isHigh
      ? { bg: '#fce8e6', border: '#d93025', text: '#c5221f' }
      : { bg: '#fef7e0', border: '#f9ab00', text: '#b06000' };

    const noticeBar = threadView.addNoticeBar();
    currentNoticeBar = noticeBar;
    noticeBar.el.style.cssText = [
      `background:${colors.bg}`,
      `border-left:4px solid ${colors.border}`,
      'padding:10px 14px',
      'margin:8px 0',
      'border-radius:4px',
      'font-family:Google Sans,Roboto,sans-serif',
      'position:relative',
    ].join(';');

    const warningItems = warnings
      .map((w) => `<li style="margin-bottom:3px">${escapeHtml(w)}</li>`)
      .join('');

    noticeBar.el.innerHTML = `
      <div style="font-size:13px;font-weight:600;color:${colors.text};margin-bottom:6px">
        ${isHigh ? '🚨 Cảnh báo bảo mật cao' : '⚠️ Cảnh báo bảo mật'}
      </div>
      <ul style="margin:0;padding-left:18px;font-size:12px;color:${colors.text}">${warningItems}</ul>
      <button style="position:absolute;top:8px;right:10px;background:none;border:none;font-size:16px;color:${colors.text};cursor:pointer;line-height:1">&times;</button>
    `;

    noticeBar.el.querySelector('button')?.addEventListener('click', () => noticeBar.destroy());
  }

  // Display-only check: looks up an existing cached analysis for the thread's
  // latest message and renders the warning banner if it's risky. Never calls
  // the analysis agents — a cache miss means "not yet analyzed" and shows nothing.
  function checkAndShowCachedSecurity(threadView: InboxSDK.ThreadView): void {
    void (async () => {
      const messages = threadView.getMessageViews();
      const latestMessage = messages[messages.length - 1];
      if (!latestMessage) return;

      const gmailMsgId = (latestMessage as { getMessageIDAsync?: () => Promise<string> }).getMessageIDAsync
        ? await (latestMessage as { getMessageIDAsync: () => Promise<string> }).getMessageIDAsync()
        : null;
      if (!gmailMsgId || securityCacheChecked.has(gmailMsgId)) return;
      securityCacheChecked.add(gmailMsgId);

      const stored = await chrome.storage.local.get('ai_reply_token');
      const token = stored['ai_reply_token'] as string | undefined;
      if (!token) return;

      const response = await new Promise<{ ok: boolean; data?: Record<string, AnalyzeResponse>; error?: string }>(
        (resolve) => chrome.runtime.sendMessage(
          { type: 'CHECK_ANALYSIS_CACHE', gmail_message_id: gmailMsgId, token },
          resolve,
        ),
      );
      if (!response.ok || !response.data) return;

      const cached = response.data[gmailMsgId];
      if (!cached) return; // never analyzed — show nothing automatically

      if (cached.risk_level === 'medium' || cached.risk_level === 'high') {
        injectSecurityBanner(threadView, cached.risk_level, cached.warnings);
      }
    })();
  }

  function renderResult(data: AnalyzeResponse, threadView: InboxSDK.ThreadView): void {
    const summaryHtml = data.summary
      .map((b) => `<li style="margin-bottom:4px">${escapeHtml(b)}</li>`)
      .join('');

    const actionHtml = data.action_items.length
      ? `<div style="margin-top:12px">
          <div style="font-size:11px;font-weight:600;color:#5f6368;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Hành động cần làm</div>
          <ul style="margin:0;padding-left:18px;font-size:13px;color:#3c4043">
            ${data.action_items.map((a) => `<li style="margin-bottom:3px">${escapeHtml(a)}</li>`).join('')}
          </ul>
        </div>`
      : '';

    const eventHtml = data.has_event && data.event_details
      ? `<div style="margin-top:14px;background:#e8f5e9;border:1px solid #a8d5b5;border-radius:8px;padding:12px">
          <div style="font-size:11px;font-weight:600;color:#0f9d58;text-transform:uppercase;letter-spacing:.5px;margin-bottom:8px">📅 Lịch hẹn phát hiện</div>
          <div style="font-size:13px;font-weight:600;color:#1e4620;margin-bottom:6px">${escapeHtml(data.event_details.event_title ?? '')}</div>
          <div style="font-size:12px;color:#2e7d32">
            🕐 ${escapeHtml(formatIso(data.event_details.start_time))} – ${escapeHtml(formatIso(data.event_details.end_time))}
          </div>
          ${data.event_details.attendees.length
            ? `<div style="font-size:12px;color:#2e7d32;margin-top:4px">👥 ${data.event_details.attendees.map(escapeHtml).join(', ')}</div>`
            : ''}
          <div style="font-size:11px;color:#4caf50;margin-top:6px;font-style:italic">✓ Đã lưu vào lịch trình</div>
        </div>`
      : '';

    const translationHtml = data.translation
      ? `<div style="margin-top:12px;padding:10px;background:#f8f9fa;border-radius:6px;font-size:12px;color:#5f6368;font-style:italic">${escapeHtml(data.translation)}</div>`
      : '';

    panelContent.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px">
        <span style="font-size:14px;font-weight:600;color:#202124">AI Analysis</span>
        <span style="font-size:11px;font-weight:600;color:${sentimentColor(data.sentiment)};background:${sentimentColor(data.sentiment)}1a;padding:2px 8px;border-radius:10px">${escapeHtml(data.sentiment)}</span>
      </div>
      <div style="font-size:11px;font-weight:600;color:#5f6368;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px">Tóm tắt</div>
      <ul style="margin:0;padding-left:18px;font-size:13px;color:#3c4043">${summaryHtml}</ul>
      ${actionHtml}
      ${translationHtml}
      ${eventHtml}
    `;
    injectSecurityBanner(threadView, data.risk_level, data.warnings);
  }

  sdk.Toolbars.registerThreadButton({
    title: 'Phân tích đầy đủ',
    iconUrl: AI_ANALYSIS_ICON,
    positions: ['THREAD'],
    onClick(event) {
      if (summaryPanel.style.display !== 'none') {
        summaryPanel.style.display = 'none';
        return;
      }
      summaryPanel.style.display = 'block';
      renderLoading();

      const threadView = event.selectedThreadViews[0];
      if (!threadView) {
        renderError('Không tìm thấy thread.');
        return;
      }

      const subject = threadView.getSubject();
      const messages = threadView.getMessageViews();
      const latestMessage = messages[messages.length - 1];
      const body = latestMessage?.getBodyElement()?.innerText ?? '';
      const sender = latestMessage?.getSender()?.emailAddress ?? '';

      (async () => {
        const stored = await chrome.storage.local.get('ai_reply_token');
        const token = stored['ai_reply_token'] as string | undefined;
        if (!token) {
          renderError('No API token saved. Open the extension popup and save your token first.');
          return;
        }
        // Approach B: real message id only — no threadId fallback.
        // threadId would merge distinct messages in the same thread, silently overwriting a different email's event.
        const gmailMsgId = (latestMessage as { getMessageIDAsync?: () => Promise<string> }).getMessageIDAsync
          ? await (latestMessage as { getMessageIDAsync: () => Promise<string> }).getMessageIDAsync()
          : null;
        // Route through service worker to avoid Mixed-Content block (HTTPS page → HTTP localhost)
        const response = await new Promise<{ ok: boolean; data?: AnalyzeResponse; error?: string }>(
          (resolve) => chrome.runtime.sendMessage(
            { type: 'ANALYZE_EMAIL', subject, body: body || '(no body)', sender, token, gmail_message_id: gmailMsgId || null },
            resolve,
          ),
        );
        if (!response.ok) {
          console.error('[AI Analysis] API call failed:', response.error);
          renderError('Analysis failed — check the console for details.');
          return;
        }
        renderResult(response.data!, threadView);
      })();
    },
  });

  // ── Snooze Toolbar ────────────────────────────────────────────────────────

  interface SnoozeOption { label: string; offsetMs: number }

  const SNOOZE_OPTIONS: SnoozeOption[] = [
    { label: 'In 1 hour',       offsetMs: 60 * 60 * 1000 },
    { label: 'In 3 hours',      offsetMs: 3 * 60 * 60 * 1000 },
    { label: 'Tomorrow 9 AM',   offsetMs: -1 }, // special-cased below
    { label: 'In 2 days',       offsetMs: 2 * 24 * 60 * 60 * 1000 },
    { label: 'Next week',       offsetMs: 7 * 24 * 60 * 60 * 1000 },
  ];

  function resolveSnoozeUntil(opt: SnoozeOption): Date {
    if (opt.offsetMs !== -1) return new Date(Date.now() + opt.offsetMs);
    // "Tomorrow 9 AM" in local time
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return d;
  }

  const snoozePanel = document.createElement('div');
  snoozePanel.setAttribute('data-ai-snooze-panel', '');
  snoozePanel.style.cssText = [
    'display:none',
    'position:fixed',
    'z-index:2147483647',
    'background:#fff',
    'border:1px solid #dadce0',
    'border-radius:10px',
    'box-shadow:0 4px 16px rgba(0,0,0,.18)',
    'padding:10px 0',
    'font-family:Google Sans,Roboto,sans-serif',
    'min-width:200px',
  ].join(';');

  const snoozePanelTitle = document.createElement('div');
  snoozePanelTitle.style.cssText = 'padding:6px 16px 10px;font-size:11px;font-weight:600;color:#5f6368;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid #f1f3f4;margin-bottom:4px';
  snoozePanelTitle.textContent = 'Snooze until';
  snoozePanel.appendChild(snoozePanelTitle);

  // Status line (shown briefly after API call)
  const snoozeStatus = document.createElement('div');
  snoozeStatus.style.cssText = 'padding:4px 16px;font-size:12px;min-height:18px';
  snoozePanel.appendChild(snoozeStatus);

  SNOOZE_OPTIONS.forEach((opt) => {
    const item = document.createElement('div');
    item.style.cssText = [
      'padding:8px 16px',
      'font-size:13px',
      'color:#3c4043',
      'cursor:pointer',
    ].join(';');
    item.textContent = opt.label;
    item.addEventListener('mouseenter', () => { item.style.background = '#f1f3f4'; });
    item.addEventListener('mouseleave', () => { item.style.background = ''; });

    item.addEventListener('click', () => {
      const snoozeUntil = resolveSnoozeUntil(opt);
      snoozeStatus.style.color = '#5f6368';
      snoozeStatus.textContent = '⏳ Snoozing…';

      void chrome.storage.local.get('ai_reply_token').then(async (stored) => {
        const token = stored['ai_reply_token'] as string | undefined;
        if (!token) {
          snoozeStatus.style.color = '#d93025';
          snoozeStatus.textContent = '❌ No API token saved.';
          return;
        }
        // activeSnoozeThread is captured from the button onClick closure below
        const tv = activeSnoozeThread;
        if (!tv) {
          snoozePanel.style.display = 'none';
          return;
        }
        const msgs = tv.getMessageViews();
        const latest = msgs[msgs.length - 1];
        const gmailMsgId = (latest as { getMessageIDAsync?: () => Promise<string> }).getMessageIDAsync
          ? await (latest as { getMessageIDAsync: () => Promise<string> }).getMessageIDAsync()
          : '';
        const threadId = await tv.getThreadIDAsync();
        const subject = tv.getSubject();
        const sender = latest?.getSender()?.emailAddress ?? '';

        try {
          const res = await fetch(`${API_BASE}/emails/snooze`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
            },
            body: JSON.stringify({
              gmail_message_id: gmailMsgId || threadId,
              thread_id: threadId,
              subject,
              sender,
              snooze_until: snoozeUntil.toISOString(),
            }),
          });
          if (!res.ok) {
            const text = await res.text();
            snoozeStatus.style.color = '#d93025';
            snoozeStatus.textContent = `❌ Error: ${text.slice(0, 80)}`;
            return;
          }
          snoozeStatus.style.color = '#0f9d58';
          snoozeStatus.textContent = `✓ Snoozed until ${opt.label.toLowerCase()}`;
          setTimeout(() => { snoozePanel.style.display = 'none'; snoozeStatus.textContent = ''; }, 1800);
        } catch (err) {
          snoozeStatus.style.color = '#d93025';
          snoozeStatus.textContent = `❌ ${(err as Error).message}`;
        }
      });
    });

    snoozePanel.appendChild(item);
  });

  document.body.appendChild(snoozePanel);

  let activeSnoozeThread: InboxSDK.ThreadView | null = null;

  const onSnoozePanelOutside = (e: MouseEvent) => {
    if (snoozePanel.style.display !== 'none' && !snoozePanel.contains(e.target as Node)) {
      snoozePanel.style.display = 'none';
      snoozeStatus.textContent = '';
    }
  };
  document.addEventListener('mousedown', onSnoozePanelOutside);

  sdk.Toolbars.registerThreadButton({
    title: 'Snooze',
    iconUrl: SNOOZE_ICON,
    positions: ['THREAD'],
    onClick(event) {
      const threadView = event.selectedThreadViews[0];
      if (!threadView) return;
      activeSnoozeThread = threadView;

      if (snoozePanel.style.display !== 'none') {
        snoozePanel.style.display = 'none';
        return;
      }

      // Position panel near the toolbar (top-right area)
      snoozePanel.style.right = '24px';
      snoozePanel.style.top = '80px';
      snoozeStatus.textContent = '';
      snoozePanel.style.display = 'block';
    },
  });

  sdk.Compose.registerComposeViewHandler((composeView) => {
    attachSnippetEngine(composeView);
    composeView.on('destroy', () => {
      if (lastComposeView === composeView) { lastComposeView = null; lastRange = null; }
    });

    let isLoading = false;
    let replyAbortController: AbortController | null = null;
    let replyTaskId: string | null = null;
    let selectedTone: Tone = 'Professional';

    const composeEl = composeView.getElement() as HTMLElement;
    composeEl.style.position = 'relative';

    // ── Tone selector panel ──────────────────────────────────────────────────
    // Mounted to document.body (position:fixed) so Gmail's overflow:hidden cannot clip it.
    const tonePanel = document.createElement('div');
    tonePanel.setAttribute('data-ai-tone-panel', '');
    tonePanel.style.cssText = [
      'display:none',
      'position:fixed',
      'z-index:2147483647',
      'background:#fff',
      'border:1px solid #dadce0',
      'border-radius:8px',
      'box-shadow:0 4px 12px rgba(0,0,0,.2)',
      'padding:10px 12px',
      'font-family:Google Sans,Roboto,sans-serif',
      'min-width:272px',
    ].join(';');

    const tonePanelLabel = document.createElement('div');
    tonePanelLabel.style.cssText = 'color:#5f6368;font-size:11px;font-weight:500;margin-bottom:8px';
    tonePanelLabel.textContent = 'Reply Tone';
    tonePanel.appendChild(tonePanelLabel);

    const pillRow = document.createElement('div');
    pillRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:5px';

    function pillStyle(active: boolean): string {
      return [
        'padding:5px 13px',
        'border-radius:12px',
        `border:1.5px solid ${active ? '#1a73e8' : '#dadce0'}`,
        `background:${active ? '#e8f0fe' : '#fff'}`,
        `color:${active ? '#1a73e8' : '#3c4043'}`,
        'font-size:12px',
        'font-family:Google Sans,Roboto,sans-serif',
        'cursor:pointer',
        'line-height:1.4',
        'outline:none',
      ].join(';');
    }

    TONES.forEach((tone) => {
      const pill = document.createElement('button');
      pill.textContent = tone;
      pill.style.cssText = pillStyle(tone === selectedTone);
      pill.addEventListener('click', (e) => {
        e.stopPropagation();
        selectedTone = tone;
        pillRow.querySelectorAll<HTMLButtonElement>('button').forEach((p) => {
          p.style.cssText = pillStyle(p.textContent === selectedTone);
        });
        tonePanel.style.display = 'none';
      });
      pillRow.appendChild(pill);
    });

    tonePanel.appendChild(pillRow);
    document.body.appendChild(tonePanel);

    const onTonePanelOutsideClick = (e: MouseEvent) => {
      if (tonePanel.style.display !== 'none' && !tonePanel.contains(e.target as Node)) {
        tonePanel.style.display = 'none';
      }
    };
    document.addEventListener('mousedown', onTonePanelOutsideClick);

    composeView.on('destroy', () => {
      tonePanel.remove();
      document.removeEventListener('mousedown', onTonePanelOutsideClick);
    });

    // ── Stop button ──────────────────────────────────────────────────────────
    const stopBtn = document.createElement('button');
    stopBtn.innerHTML = '🛑 Dừng';
    stopBtn.title = 'Hủy tạo nội dung AI';
    stopBtn.style.cssText = [
      'display:none',
      'position:absolute',
      'bottom:10px',
      'right:14px',
      'z-index:2147483647',
      'padding:5px 12px',
      'border:1.5px solid #e53935',
      'background:#fff',
      'color:#e53935',
      'border-radius:4px',
      'font-size:12px',
      'font-family:Google Sans,Roboto,sans-serif',
      'cursor:pointer',
      'box-shadow:0 2px 6px rgba(0,0,0,.15)',
    ].join(';');

    composeEl.appendChild(stopBtn);

    stopBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      replyAbortController?.abort();
      const taskId = replyTaskId;
      if (taskId) {
        void chrome.storage.local.get('ai_reply_token').then((stored) => {
          const token = stored['ai_reply_token'] as string | undefined;
          if (token) {
            fetch(`${API_BASE}/pipeline/${taskId}/cancel`, {
              method: 'POST',
              headers: { Authorization: `Bearer ${token}` },
            }).catch(() => {});
          }
        });
      }
    });

    composeView.on('destroy', () => {
      replyAbortController?.abort();
      stopBtn.remove();
    });

    // ── Tone picker button ───────────────────────────────────────────────────
    composeView.addButton({
      title: 'Select Reply Tone',
      iconUrl: TONE_ICON,
      onClick: () => {
        if (tonePanel.style.display !== 'none') {
          tonePanel.style.display = 'none';
          return;
        }
        console.log('[AI Reply] Rendering Tone Menu...');
        // Position above the compose toolbar, anchored to the compose window's left edge
        const rect = composeEl.getBoundingClientRect();
        tonePanel.style.left = `${rect.left + 8}px`;
        tonePanel.style.bottom = `${window.innerHeight - rect.bottom + 52}px`;
        tonePanel.style.display = 'block';
      },
    });

    // ── AI Reply button ──────────────────────────────────────────────────────
    composeView.addButton({
      title: 'AI Reply',
      iconUrl: AI_REPLY_ICON,
      onClick: () => {
        if (isLoading) return;
        isLoading = true;
        tonePanel.style.display = 'none';

        const taskId = crypto.randomUUID();
        const controller = new AbortController();
        replyAbortController = controller;
        replyTaskId = taskId;
        stopBtn.style.display = 'block';

        safeSetBodyHTML(composeView,'<p><em>⏳ Generating AI reply…</em></p>');

        void (async () => {
          try {
            const threadId = composeView.getThreadID();
            const threadView = threadViews.get(threadId);
            const messages = threadView?.getMessageViews() ?? [];
            const latestMessage = messages[messages.length - 1];

            const threadText = messages
              .filter((mv) => mv.isLoaded())
              .map((mv) => mv.getBodyElement()?.innerText ?? '')
              .filter(Boolean)
              .join('\n---\n');

            const subject = composeView.getSubject() || threadView?.getSubject() || '';
            const sender = latestMessage?.getSender()?.emailAddress ?? '';
            const gmailMsgId = (latestMessage as { getMessageIDAsync?: () => Promise<string> }).getMessageIDAsync
              ? await (latestMessage as { getMessageIDAsync: () => Promise<string> }).getMessageIDAsync()
              : null;

            const stored = await chrome.storage.local.get('ai_reply_token');
            const token = stored['ai_reply_token'] as string | undefined;
            if (!token) {
              safeSetBodyHTML(composeView,
                '<p><em>❌ No API token saved. Open the extension popup and save your token first.</em></p>',
              );
              return;
            }

            const { data } = await axios.post<ProcessEmailResult>(
              `${API_BASE}/emails/classify`,
              {
                subject,
                text: threadText || '(no thread body)',
                sender,
                task_id: taskId,
                tone: selectedTone,
                generate_draft: true,
                ...(gmailMsgId ? { gmail_message_id: gmailMsgId } : {}),
              },
              {
                headers: { Authorization: `Bearer ${token}` },
                signal: controller.signal,
              },
            );

            if (!data.draft_content) {
              safeSetBodyHTML(composeView, '<p><em>❌ AI không thể tạo nháp phản hồi cho email này.</em></p>');
              return;
            }
            safeSetBodyHTML(composeView, `<p>${escapeHtml(data.draft_content)}</p>`);
          } catch (err) {
            if (axios.isCancel(err)) {
              safeSetBodyHTML(composeView,'<p><em>🛑 Đã hủy tạo nội dung.</em></p>');
            } else {
              console.error('[AI Reply] API call failed:', err);
              safeSetBodyHTML(composeView,
                '<p><em>❌ AI Reply failed — check the console for details.</em></p>',
              );
            }
          } finally {
            isLoading = false;
            replyAbortController = null;
            replyTaskId = null;
            stopBtn.style.display = 'none';
          }
        })();
      },
    });
  });
});
