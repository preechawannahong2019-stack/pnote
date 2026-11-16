export type Id = string;
export type InputKind = 'pen' | 'touch' | 'mouse';
export type Tool = 'pen' | 'highlighter';
export type PressureCurve = 'soft' | 'normal' | 'firm' | 'off';

/** width 0.2–20 pt; opacity, taperStart, taperEnd, smoothing in 0–1 */
export interface PenStyle {
  color: string;
  width: number;
  opacity: number;
  pressureCurve: PressureCurve;
  taperStart: number;
  taperEnd: number;
  smoothing: number;
}

export interface Author { profileId: Id; name: string }

/** points: x, y, pressure, t repeating (page points, ms) */
export interface Stroke {
  id: Id;
  pageId: Id;
  tool: Tool;
  style: PenStyle;
  points: Float32Array;
  input: InputKind;
  author: Author;
  hidden?: boolean;
  createdAt: number;
}

export type ShapeGeometry =
  | { kind: 'line' | 'arrow'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'ellipse'; cx: number; cy: number; rx: number; ry: number }
  | { kind: 'rect'; x: number; y: number; w: number; h: number }
  | { kind: 'triangle'; pts: [number, number, number, number, number, number] };

export interface Shape {
  id: Id;
  pageId: Id;
  geometry: ShapeGeometry;
  style: PenStyle;
  sourceStrokeId: Id;
  author: Author;
  hidden?: boolean;
  createdAt: number;
}

export type PageTemplate = 'plain' | 'lined' | 'grid';
export type PageSource =
  | { type: 'blank'; template: PageTemplate }
  | { type: 'pdf'; pageNo: number }
  | { type: 'image'; blobId: Id };

/** Crop box in PDF user space plus the page's /Rotate. */
export interface PdfPageBox { x: number; y: number; w: number; h: number; rotate: 0 | 90 | 180 | 270 }

/** widthPt/heightPt are the page as displayed (after rotation). */
export interface PageRef { id: Id; source: PageSource; widthPt: number; heightPt: number; pdfBox?: PdfPageBox }

export interface TextBox {
  id: Id;
  pageId: Id;
  x: number;
  y: number;
  w: number;
  h: number;
  text: string;
  font: 'sarabun';
  sizePt: number;
  color: string;
  bold: boolean;
  author: Author;
  hidden?: boolean;
  createdAt: number;
  updatedAt: number;
}

export type DocKind = 'notebook' | 'pdf' | 'image' | 'web';

export interface DocumentMeta {
  id: Id;
  profileId: Id;
  folderId: Id | null;
  title: string;
  kind: DocKind;
  sourceBlobId?: Id;
  sourceSha256?: string;
  sourceUrl?: string;
  capturedAt?: number;
  originalName?: string;
  importedAt?: number;
  pages: PageRef[];
  createdAt: number;
  updatedAt: number;
}

export interface Folder { id: Id; profileId: Id; parentId: Id | null; name: string }

export interface PenPreset { id: Id; name: string; tool: Tool; style: PenStyle }

export const A4 = { widthPt: 595.28, heightPt: 841.89 } as const;

/** A recognized word in page space (pt). */
export interface OcrWord { text: string; bbox: [number, number, number, number]; conf: number }
/** Searchable text of one page: from the PDF's own text or from OCR. */
export interface OcrPage { pageId: Id; engine: 'tesseract' | 'pdf-text'; lang: 'tha+eng'; words: OcrWord[]; doneAt: number }
