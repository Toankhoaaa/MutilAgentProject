import { useState, useEffect } from 'react';
import { getSnippets, saveSnippet, deleteSnippet, type Snippet } from '../services/storage';

export function SnippetsManager() {
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [trigger, setTrigger] = useState('');
  const [content, setContent] = useState('');
  const [language, setLanguage] = useState<'text' | 'template'>('text');
  const [error, setError] = useState('');

  useEffect(() => {
    getSnippets().then(setSnippets);
  }, []);

  const resetForm = () => {
    setShowForm(false);
    setTrigger('');
    setContent('');
    setLanguage('text');
    setError('');
  };

  const handleAdd = async () => {
    const trimmedTrigger = trigger.trim();
    if (!trimmedTrigger) { setError('Trigger is required.'); return; }
    if (!content.trim()) { setError('Content is required.'); return; }
    if (snippets.some((s) => s.trigger === trimmedTrigger)) {
      setError('A snippet with this trigger already exists.');
      return;
    }
    await saveSnippet({ trigger: trimmedTrigger, content, language });
    setSnippets(await getSnippets());
    resetForm();
  };

  const handleDelete = async (t: string) => {
    await deleteSnippet(t);
    setSnippets((prev) => prev.filter((s) => s.trigger !== t));
  };

  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <strong style={{ fontSize: 13 }}>Snippets</strong>
        {!showForm && (
          <button
            onClick={() => setShowForm(true)}
            style={{ fontSize: 12, padding: '3px 8px', cursor: 'pointer', borderRadius: 4 }}
          >
            + Add
          </button>
        )}
      </div>

      {showForm && (
        <div style={{ border: '1px solid #e0e0e0', borderRadius: 4, padding: 8, marginBottom: 8 }}>
          <input
            placeholder="Trigger (e.g. /hello)"
            value={trigger}
            onChange={(e) => { setTrigger(e.target.value); setError(''); }}
            style={{ width: '100%', boxSizing: 'border-box', marginBottom: 4, fontSize: 12, padding: '4px 6px' }}
          />
          <select
            value={language}
            onChange={(e) => setLanguage(e.target.value as 'text' | 'template')}
            style={{ width: '100%', boxSizing: 'border-box', marginBottom: 4, fontSize: 12, padding: '4px 6px' }}
          >
            <option value="text">Plain text</option>
            <option value="template">HTML template</option>
          </select>
          <textarea
            placeholder="Content"
            rows={3}
            value={content}
            onChange={(e) => { setContent(e.target.value); setError(''); }}
            style={{ width: '100%', boxSizing: 'border-box', fontSize: 11, fontFamily: 'monospace', marginBottom: 4, resize: 'vertical' }}
          />
          {error && <p style={{ margin: '0 0 4px', fontSize: 11, color: '#d32f2f' }}>{error}</p>}
          <div style={{ display: 'flex', gap: 6 }}>
            <button
              onClick={handleAdd}
              style={{ fontSize: 12, padding: '4px 10px', background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
            >
              Save
            </button>
            <button onClick={resetForm} style={{ fontSize: 12, padding: '4px 10px', cursor: 'pointer', borderRadius: 4 }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {snippets.length === 0 && !showForm ? (
        <p style={{ fontSize: 12, color: '#888', margin: 0 }}>No snippets yet. Type a trigger in Gmail to auto-expand.</p>
      ) : (
        snippets.map((s) => (
          <div
            key={s.trigger}
            style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', borderBottom: '1px solid #f0f0f0', padding: '5px 0', gap: 6 }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <code style={{ fontSize: 11, background: '#f5f5f5', padding: '1px 4px', borderRadius: 3 }}>{s.trigger}</code>
              <span style={{ fontSize: 10, color: '#888', marginLeft: 4 }}>{s.language}</span>
              <p style={{ fontSize: 11, color: '#555', margin: '2px 0 0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {s.content}
              </p>
            </div>
            <button
              onClick={() => handleDelete(s.trigger)}
              style={{ fontSize: 11, color: '#d32f2f', background: 'none', border: 'none', cursor: 'pointer', padding: '0 2px', flexShrink: 0 }}
              title="Delete snippet"
            >
              ✕
            </button>
          </div>
        ))
      )}
    </div>
  );
}
