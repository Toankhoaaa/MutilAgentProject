import * as InboxSDK from '@inboxsdk/core';
import axios from 'axios';

const APP_ID = 'sdk_muiltiAgent_7834f5e8f1';
const API_BASE = 'http://localhost:8000/api/v1';

const AI_REPLY_ICON =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='%234285f4'%3E%3Cpath d='M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-2 12H6v-2h12v2zm0-3H6V9h12v2zm0-3H6V6h12v2z'/%3E%3C/svg%3E";

interface ProcessEmailResult {
  category: string;
  priority_score: number;
  summary: string;
  confidence: number;
  draft_content: string | null;
  draft_subject: string | null;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br>');
}

InboxSDK.load(2, APP_ID).then((sdk) => {
  // Track open thread views by thread ID so the compose handler can read them
  const threadViews = new Map<string, InboxSDK.ThreadView>();

  sdk.Conversations.registerThreadViewHandler(async (threadView) => {
    const id = await threadView.getThreadIDAsync();
    threadViews.set(id, threadView);
    threadView.on('destroy', () => threadViews.delete(id));
  });

  sdk.Compose.registerComposeViewHandler((composeView) => {
    let isLoading = false;

    composeView.addButton({
      title: 'AI Reply',
      iconUrl: AI_REPLY_ICON,
      onClick: () => {
        if (isLoading) return;
        isLoading = true;

        composeView.setBodyHTML('<p><em>⏳ Generating AI reply…</em></p>');

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
              composeView.setBodyHTML(
                '<p><em>❌ No API token saved. Open the extension popup and save your token first.</em></p>',
              );
              return;
            }

            const { data } = await axios.post<ProcessEmailResult>(
              `${API_BASE}/emails/process`,
              { text: threadText || '(no thread body)', subject },
              { headers: { Authorization: `Bearer ${token}` } },
            );

            const reply = data.draft_content ?? data.summary;
            composeView.setBodyHTML(`<p>${escapeHtml(reply)}</p>`);
          } catch (err) {
            console.error('[AI Reply] API call failed:', err);
            composeView.setBodyHTML(
              '<p><em>❌ AI Reply failed — check the console for details.</em></p>',
            );
          } finally {
            isLoading = false;
          }
        })();
      },
    });
  });
});
