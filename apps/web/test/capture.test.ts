import { captureErrorMessage, nativeCapture, webCaptureFallback } from '../src/platform/capture';

function fakeNative(failRead?: string) {
  const removed: string[] = [];
  const files: Record<string, Uint8Array> = { 'c/page.pdf': new Uint8Array([37, 80]), 'c/shot.png': new Uint8Array([1]), 'c/page.mht': new Uint8Array([2]) };
  return {
    removed,
    plugin: {
      capture: async () => ({ requestedUrl: 'https://a', finalUrl: 'https://a/b', title: 'T', userAgent: 'UA', capturedAt: 5, timeZone: 'Asia/Bangkok', pdfPath: 'c/page.pdf', pngPath: 'c/shot.png', archivePath: 'c/page.mht', archiveType: 'mht' as const }),
    },
    files: {
      read: async (p: string) => { if (p === failRead) throw new Error('read failed'); return files[p]; },
      remove: async (p: string) => { removed.push(p); },
    },
  };
}

describe('web capture', () => {
  it('reads the three files and deletes them', async () => {
    const f = fakeNative();
    const c = await nativeCapture(f.plugin, f.files).capture('https://a');
    expect(c).toMatchObject({ finalUrl: 'https://a/b', archiveType: 'mht', timeZone: 'Asia/Bangkok' });
    expect(c.pdf).toEqual(new Uint8Array([37, 80]));
    expect(f.removed.sort()).toEqual(['c/page.mht', 'c/page.pdf', 'c/shot.png']);
  });

  it('deletes every cache file even when reading one fails', async () => {
    const f = fakeNative('c/shot.png');
    await expect(nativeCapture(f.plugin, f.files).capture('https://a')).rejects.toThrow('read failed');
    expect(f.removed.sort()).toEqual(['c/page.mht', 'c/page.pdf', 'c/shot.png']);
  });

  it('is unavailable on the web', () => {
    expect(webCaptureFallback.available).toBe(false);
  });

  it('maps native error codes to Thai messages', () => {
    expect(captureErrorMessage('TIMEOUT')).toBe('หน้าเว็บโหลดไม่เสร็จภายใน 60 วินาที');
    expect(captureErrorMessage('INVALID_URL')).toBe('ลิงก์ไม่ถูกต้อง');
    expect(captureErrorMessage('LOAD_FAILED')).toBe('เปิดหน้าเว็บไม่สำเร็จ');
    expect(captureErrorMessage('CANCELLED')).toBe('');
    expect(captureErrorMessage(undefined)).toBe('บันทึกหน้าเว็บไม่สำเร็จ');
  });
});
