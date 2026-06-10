import { useState } from 'react';
import { SnippetsManager } from './SnippetsManager';
import { TemplateSelector } from './TemplateSelector';

type Tab = 'snippets' | 'templates';

const TAB_LABELS: Record<Tab, string> = { snippets: 'Snippets', templates: 'Templates' };
const TABS = Object.keys(TAB_LABELS) as Tab[];

export function PopupApp() {
  const [active, setActive] = useState<Tab>('snippets');

  return (
    <div>
      <div style={{ display: 'flex', borderBottom: '1px solid #e0e0e0', marginBottom: 4 }}>
        {TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => setActive(tab)}
            style={{
              padding: '5px 12px',
              fontSize: 12,
              cursor: 'pointer',
              background: 'none',
              border: 'none',
              borderBottom: active === tab ? '2px solid #1a73e8' : '2px solid transparent',
              color: active === tab ? '#1a73e8' : '#555',
              fontWeight: active === tab ? 600 : 400,
            }}
          >
            {TAB_LABELS[tab]}
          </button>
        ))}
      </div>
      {active === 'snippets' ? <SnippetsManager /> : <TemplateSelector />}
    </div>
  );
}
