import type { ExportFonts } from './export';

/** Load the Sarabun WOFF subsets the app ships under ./vendor/fonts (browser). */
export async function loadExportFonts(base = './vendor/fonts/'): Promise<ExportFonts> {
  const get = async (f: string) => new Uint8Array(await (await fetch(`${base}sarabun-${f}-normal.woff`)).arrayBuffer());
  const [thai400, thai700, latin400, latin700] = await Promise.all(['thai-400', 'thai-700', 'latin-400', 'latin-700'].map(get));
  return { thai400, thai700, latin400, latin700 };
}
