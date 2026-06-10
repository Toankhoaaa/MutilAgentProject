import { useState, useEffect } from 'react';
import { getSnippets, type Snippet } from '../services/storage';

interface InsertMessage {
  type: 'INSERT_TEMPLATE';
  content: string;
  language: string;
}

export function TemplateSelector() {
  const [groups, setGroups] = useState<Map<string, Snippet[]>>(new Map());
  const [status, setStatus] = useState('');

  useEffect(() => {
    getSnippets().then((snippets) => {
      const map = new Map<string, Snippet[]>();
      for (const s of snippets) {
        const list = map.get(s.language) ?? [];
        list.push(s);
        map.set(s.language, list);
      }
      setGroups(map);
    });
  }, []);

  const handleInsert = async (snippet: Snippet) => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) {
      setStatus('No active tab found.');
      setTimeout(() => setStatus(''), 2500);
      return;
    }
    const msg: InsertMessage = { type: 'INSERT_TEMPLATE', content: snippet.content, language: snippet.language };
    try {
      await chrome.tabs.sendMessage(tab.id, msg);
      window.close();
    } catch {
      setStatus('Open a Gmail compose window first.');
      setTimeout(() => setStatus(''), 3000);
    }
  };

  if (groups.size === 0) {
    return (
      <p style={{ fontSize: 12, color: '#888', margin: '8px 0 0' }}>
        No snippets yet. Add snippets in the Snippets tab — they'll appear here grouped by language.
      </p>
    );
  }

  return (
    <div style={{ marginTop: 8 }}>
      {status && <p style={{ margin: '0 0 6px', fontSize: 11, color: '#d32f2f' }}>{status}</p>}
      {[...groups.entries()].map(([lang, items]) => (
        <div key={lang} style={{ marginBottom: 10 }}>
          <p style={{ margin: '0 0 4px', fontSize: 10, fontWeight: 700, color: '#888', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
            {lang}
          </p>
          {items.map((s) => (
            <button
              key={s.trigger}
              onClick={() => handleInsert(s)}
              title={s.content}
              style={{
                display: 'block',
                width: '100%',
                textAlign: 'left',
                padding: '5px 8px',
                marginBottom: 3,
                background: '#f8f9fa',
                border: '1px solid #e0e0e0',
                borderRadius: 4,
                cursor: 'pointer',
                fontSize: 12,
                lineHeight: 1.3,
              }}
            >
              <code style={{ fontSize: 11, color: '#1a73e8' }}>{s.trigger}</code>
              <span style={{ display: 'block', fontSize: 11, color: '#555', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 1 }}>
                {s.content.slice(0, 50)}{s.content.length > 50 ? '…' : ''}
              </span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
