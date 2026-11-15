import type { PageTemplate } from '@pnote/core/types';

export interface TemplateLine { x1: number; y1: number; x2: number; y2: number }

export const LINE_SPACING_PT = 24;
export const LINE_TOP_PT = 72;
export const GRID_PT = 14.17; // 5 mm

export function templateLines(t: PageTemplate, widthPt: number, heightPt: number): TemplateLine[] {
  const out: TemplateLine[] = [];
  if (t === 'lined') {
    for (let y = LINE_TOP_PT; y < heightPt; y += LINE_SPACING_PT) out.push({ x1: 0, y1: y, x2: widthPt, y2: y });
  } else if (t === 'grid') {
    for (let x = GRID_PT; x < widthPt; x += GRID_PT) out.push({ x1: x, y1: 0, x2: x, y2: heightPt });
    for (let y = GRID_PT; y < heightPt; y += GRID_PT) out.push({ x1: 0, y1: y, x2: widthPt, y2: y });
  }
  return out;
}
