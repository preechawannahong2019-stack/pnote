import { readFileSync } from 'node:fs';
import { degrees, PDFDocument, StandardFonts } from 'pdf-lib';

export async function plainPdf(pages = 3, opts: { padBytes?: number } = {}): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  for (let i = 1; i <= pages; i++) {
    const p = doc.addPage([595.28, 841.89]);
    p.drawText(i === 2 ? 'EVIDENCE 2569 page two' : `Page ${i} of the fixture document`, { x: 72, y: 760, size: 18, font });
  }
  if (opts.padBytes) {
    // an unreferenced-by-text, large stream on the last page so the file is big
    const pad = new Uint8Array(opts.padBytes);
    for (let i = 0; i < pad.length; i++) pad[i] = (i * 31) & 0xff;
    const stream = doc.context.stream(pad);
    const ref = doc.context.register(stream);
    doc.getPage(pages - 1).node.set(doc.context.obj('PadData') as never, ref);
  }
  return doc.save({ useObjectStreams: false });
}

export async function rotatedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([595.28, 841.89]);
  p.drawText('ROTATED TEXT', { x: 72, y: 760, size: 18, font });
  p.setRotation(degrees(90));
  return doc.save();
}

export async function croppedPdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  const p = doc.addPage([595.28, 841.89]);
  p.setCropBox(50, 60, 350, 440);
  return doc.save();
}

export function notPdf(): Uint8Array {
  return new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(200).fill(1)]);
}

export async function brokenPdf(): Promise<Uint8Array> {
  const b = await plainPdf(3);
  return b.slice(0, Math.floor(b.length / 3));
}

/** Generated once with: qpdf --encrypt user owner 256 -- plain.pdf encrypted.pdf */
export function encryptedPdf(): Uint8Array {
  return new Uint8Array(readFileSync(new URL('./encrypted.pdf', import.meta.url)));
}

/** Owner-password only ("restricted"): opens without a password but is encrypted (qpdf --encrypt "" owner 256). */
export function restrictedPdf(): Uint8Array {
  return new Uint8Array(readFileSync(new URL('./restricted.pdf', import.meta.url)));
}
