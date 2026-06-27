const SNIPPETS_KEY = 'snippets';

export interface Snippet {
  trigger: string;
  content: string;
  language: string;
}

type SnippetMap = Record<string, Snippet>;

export async function getSnippets(): Promise<Snippet[]> {
  const result = await chrome.storage.sync.get(SNIPPETS_KEY);
  const map = (result[SNIPPETS_KEY] ?? {}) as SnippetMap;
  return Object.values(map);
}

export async function saveSnippet(snippet: Snippet): Promise<void> {
  const result = await chrome.storage.sync.get(SNIPPETS_KEY);
  const map = (result[SNIPPETS_KEY] ?? {}) as SnippetMap;
  map[snippet.trigger] = snippet;
  await chrome.storage.sync.set({ [SNIPPETS_KEY]: map });
}

export async function deleteSnippet(trigger: string): Promise<void> {
  const result = await chrome.storage.sync.get(SNIPPETS_KEY);
  const map = (result[SNIPPETS_KEY] ?? {}) as SnippetMap;
  delete map[trigger];
  await chrome.storage.sync.set({ [SNIPPETS_KEY]: map });
}
