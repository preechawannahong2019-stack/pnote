import { mkdirSync, writeFileSync } from 'node:fs';
import { notPdf, plainPdf } from '../../../packages/pdf/test/fixtures/make-fixtures';

export default async function globalSetup() {
  const dir = new URL('./.fixtures/', import.meta.url).pathname;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}plain.pdf`, await plainPdf(3));
  writeFileSync(`${dir}not-a-pdf.pdf`, notPdf());
}
