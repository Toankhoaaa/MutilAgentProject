import * as InboxSDK from '@inboxsdk/core';
import axios from 'axios';
import { getSnippets, type Snippet } from '../services/storage';

const APP_ID = 'sdk_muiltiAgent_7834f5e8f1';
const API_BASE = 'http://localhost:8000/api/v1';

const AI_REPLY_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%234285f4'%3E%3Cpath d='M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z'/%3E%3C/svg%3E";

const TONE_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%235f6368'%3E%3Cpath d='M2.5 4v3h5v12h3V7h5V4h-13zm19 5h-9v3h3v7h3v-7h3V9z'/%3E%3C/svg%3E";

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
