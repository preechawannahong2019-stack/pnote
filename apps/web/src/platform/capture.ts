import type { WebCaptureInput } from '@pnote/storage/importer';

export type CaptureResult = WebCaptureInput;
export type CaptureErrorCode = 'CANCELLED' | 'TIMEOUT' | 'LOAD_FAILED' | 'INVALID_URL';

export interface WebCapture { available: boolean; capture(url: string): Promise<CaptureResult> }

/** The browser cannot fetch other sites (CORS): the UI tells the user to print to PDF and import it. */
export const webCaptureFallback: WebCapture = {
  available: false,
  capture: async () => { throw Object.assign(new Error('capture is not available in the browser'), { code: 'LOAD_FAILED' }); },
};

export interface NativeCaptureReply {
  requestedUrl: string; finalUrl: string; title: string; userAgent: string; capturedAt: number; timeZone: string;
  pdfPath: string; pngPath: string; archivePath: string; archiveType: 'mht' | 'webarchive';
}

export interface CaptureFiles { read(path: string): Promise<Uint8Array>; remove(path: string): Promise<void> }

/** PnoteCapture writes its three files to the app cache; read them, then delete them whatever happens. */
export function nativeCapture(plugin: { capture(o: { url: string }): Promise<NativeCaptureReply> }, files: CaptureFiles): WebCapture {
  return {
    available: true,
    async capture(url) {
      const r = await plugin.capture({ url });
      const paths = [r.pdfPath, r.pngPath, r.archivePath];
      try {
        const [pdf, png, archive] = await Promise.all(paths.map((p) => files.read(p)));
        return {
          requestedUrl: r.requestedUrl, finalUrl: r.finalUrl, title: r.title, userAgent: r.userAgent, capturedAt: r.capturedAt, timeZone: r.timeZone,
          pdf, png, archive, archiveType: r.archiveType,
        };
      } finally {
        await Promise.allSettled(paths.map((p) => files.remove(p)));
      }
    },
  };
}

export function captureErrorMessage(code: string | undefined): string {
  switch (code) {
    case 'CANCELLED': return '';
    case 'TIMEOUT': return 'หน้าเว็บโหลดไม่เสร็จภายใน 60 วินาที';
    case 'INVALID_URL': return 'ลิงก์ไม่ถูกต้อง';
    case 'LOAD_FAILED': return 'เปิดหน้าเว็บไม่สำเร็จ';
    default: return 'บันทึกหน้าเว็บไม่สำเร็จ';
  }
}
