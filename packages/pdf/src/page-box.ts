import type { PdfPageBox } from '@pnote/core/types';

/**
 * Page space: the page as displayed (after /Rotate), origin top-left, y down, points.
 * PDF space: PDF user space, origin bottom-left, y up.
 * Matrix [a b c d e f]: X = a·px + c·py + e, Y = b·px + d·py + f.
 */
export function pageToPdfMatrix(box: PdfPageBox): [number, number, number, number, number, number] {
  const { x, y, w, h } = box;
  switch (box.rotate) {
    case 0: return [1, 0, 0, -1, x, y + h];
    case 90: return [0, 1, 1, 0, x, y];
    case 180: return [-1, 0, 0, 1, x + w, y];
    case 270: return [0, -1, -1, 0, x + w, y + h];
  }
}

export function pageToPdf(box: PdfPageBox, px: number, py: number): [number, number] {
  const [a, b, c, d, e, f] = pageToPdfMatrix(box);
  return [a * px + c * py + e, b * px + d * py + f];
}

export function pdfToPage(box: PdfPageBox, X: number, Y: number): [number, number] {
  const [a, b, c, d, e, f] = pageToPdfMatrix(box);
  const det = a * d - b * c;
  const dx = X - e, dy = Y - f;
  return [(d * dx - c * dy) / det, (a * dy - b * dx) / det];
}
