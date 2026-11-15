export interface EditorSettings { scribble: boolean; autoShapes: boolean }
const KEY = 'pnote.settings';
const DEFAULT: EditorSettings = { scribble: true, autoShapes: true };

export function loadSettings(): EditorSettings {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<EditorSettings> | null;
    return { scribble: v?.scribble !== false, autoShapes: v?.autoShapes !== false };
  } catch { return { ...DEFAULT }; }
}
export function saveSettings(s: EditorSettings): void {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch { /* unavailable */ }
}
