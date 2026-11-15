export type Dock = 'top' | 'bottom' | 'left' | 'right';
export interface ToolbarState { collapsed: boolean; dock: Dock; fullscreen: boolean }

const DEFAULT: ToolbarState = { collapsed: false, dock: 'top', fullscreen: false };
const DOCKS: Dock[] = ['top', 'bottom', 'left', 'right'];

export function sizeBucket(widthPx: number): 's' | 'm' | 'l' {
  return widthPx < 768 ? 's' : widthPx < 1200 ? 'm' : 'l';
}

const key = (w: number) => `pnote.toolbar.${sizeBucket(w)}`;

export function loadToolbarState(widthPx: number): ToolbarState {
  try {
    const raw = JSON.parse(localStorage.getItem(key(widthPx)) ?? 'null') as Partial<ToolbarState> | null;
    if (!raw) return { ...DEFAULT };
    return {
      collapsed: raw.collapsed === true,
      dock: DOCKS.includes(raw.dock as Dock) ? (raw.dock as Dock) : DEFAULT.dock,
      fullscreen: raw.fullscreen === true,
    };
  } catch {
    return { ...DEFAULT };
  }
}

export function saveToolbarState(widthPx: number, s: ToolbarState): void {
  try { localStorage.setItem(key(widthPx), JSON.stringify(s)); } catch { /* storage unavailable */ }
}
