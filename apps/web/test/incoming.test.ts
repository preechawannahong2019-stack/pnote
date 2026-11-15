import { IncomingFiles, type IncomingFile } from '../src/platform/incoming';

function fakeSource() {
  let cb: ((f: IncomingFile) => void) | null = null;
  const removed: string[] = [];
  return {
    removed,
    emit: (f: IncomingFile) => cb?.(f),
    source: {
      onFile: (c: (f: IncomingFile) => void) => { cb = c; return () => { cb = null; }; },
      read: async (path: string) => new Blob([path], { type: 'application/pdf' }),
      remove: async (path: string) => { removed.push(path); },
    },
  };
}

describe('IncomingFiles', () => {
  it('queues files in arrival order', () => {
    const f = fakeSource();
    const inc = new IncomingFiles(f.source);
    f.emit({ name: 'a.pdf', mime: 'application/pdf', path: 'in/a.pdf' });
    f.emit({ name: 'b.png', mime: 'image/png', path: 'in/b.png' });
    expect(inc.pending.map((x) => x.name)).toEqual(['a.pdf', 'b.png']);
  });

  it('take reads the file, removes it from the cache and from the queue', async () => {
    const f = fakeSource();
    const inc = new IncomingFiles(f.source);
    const changes = vi.fn();
    inc.onChange(changes);
    f.emit({ name: 'a.pdf', mime: 'application/pdf', path: 'in/a.pdf' });
    const blob = await inc.take(inc.pending[0]);
    expect(await blob.text()).toBe('in/a.pdf');
    expect(f.removed).toEqual(['in/a.pdf']);
    expect(inc.pending).toEqual([]);
    expect(changes).toHaveBeenCalledTimes(2);
  });

  it('discard removes the file without reading it', async () => {
    const f = fakeSource();
    const inc = new IncomingFiles(f.source);
    f.emit({ name: 'a.pdf', mime: 'application/pdf', path: 'in/a.pdf' });
    await inc.discard(inc.pending[0]);
    expect(f.removed).toEqual(['in/a.pdf']);
    expect(inc.pending).toEqual([]);
  });
});

describe('IncomingPrompt', () => {
  it('asks which profile receives the file; confirming imports it there and cancelling discards it', async () => {
    const { render, screen, fireEvent } = await import('@testing-library/svelte');
    const { default: IncomingPrompt } = await import('../src/components/IncomingPrompt.svelte');
    const f = fakeSource();
    const inc = new IncomingFiles(f.source);
    f.emit({ name: 'คำสั่ง.pdf', mime: 'application/pdf', path: 'in/a.pdf' });
    f.emit({ name: 'รูป.png', mime: 'image/png', path: 'in/b.png' });
    const onImport = vi.fn(async (_file: File) => {});
    render(IncomingPrompt, { incoming: inc, profileName: 'ปรีชา', onImport });
    expect(screen.getByText('นำเข้า "คำสั่ง.pdf" ไปที่โปรไฟล์ ปรีชา?')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'นำเข้า' }));
    await vi.waitFor(() => expect(onImport).toHaveBeenCalledTimes(1));
    const file = onImport.mock.calls[0][0];
    expect(file.name).toBe('คำสั่ง.pdf');
    expect(file.type).toBe('application/pdf');
    expect(await screen.findByText('นำเข้า "รูป.png" ไปที่โปรไฟล์ ปรีชา?')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'ไม่นำเข้า' }));
    await vi.waitFor(() => expect(inc.pending).toEqual([]));
    expect(onImport).toHaveBeenCalledTimes(1);
    expect(f.removed.sort()).toEqual(['in/a.pdf', 'in/b.png']);
  });
});
