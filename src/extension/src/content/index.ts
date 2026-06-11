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

// ── Snippet Engine ────────────────────────────────────────────────────────

let snippetCache: Snippet[] | null = null;

// Tracks the last active compose view and cursor position so the popup can insert templates
interface ComposeViewRef { getBodyElement(): Element | null; }
let lastComposeView: ComposeViewRef | null = null;
let lastRange: Range | null = null;

chrome.runtime.onMessage.addListener((msg: { type: string; content: string; language: string }) => {
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

  sdk.Conversations.registerThreadViewHandler(async (threadView) => {
    const id = await threadView.getThreadIDAsync();
    threadViews.set(id, threadView);
    threadView.on('destroy', () => threadViews.delete(id));
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

  function renderResult(data: AnalyzeResponse): void {
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
  }

  sdk.Toolbars.registerThreadButton({
    title: 'AI Analysis',
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
        // Route through service worker to avoid Mixed-Content block (HTTPS page → HTTP localhost)
        const response = await new Promise<{ ok: boolean; data?: AnalyzeResponse; error?: string }>(
          (resolve) => chrome.runtime.sendMessage(
            { type: 'ANALYZE_EMAIL', subject, body: body || '(no body)', sender, token },
            resolve,
          ),
        );
        if (!response.ok) {
          console.error('[AI Analysis] API call failed:', response.error);
          renderError('Analysis failed — check the console for details.');
          return;
        }
        renderResult(response.data!);
      })();
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
            fetch(`${API_BASE}/tasks/${taskId}/cancel`, {
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

            const threadText = (threadView?.getMessageViews() ?? [])
              .filter((mv) => mv.isLoaded())
              .map((mv) => mv.getBodyElement()?.innerText ?? '')
              .filter(Boolean)
              .join('\n---\n');

            const subject = composeView.getSubject() || threadView?.getSubject() || '';

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
              { subject, text: threadText || '(no thread body)', sender: '', task_id: taskId, tone: selectedTone },
              {
                headers: { Authorization: `Bearer ${token}` },
                signal: controller.signal,
              },
            );

            const reply = data.draft_content ?? data.summary;
            safeSetBodyHTML(composeView,`<p>${escapeHtml(reply)}</p>`);
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
