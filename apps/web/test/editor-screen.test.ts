import { fireEvent, render, screen } from '@testing-library/svelte';
import type { Library } from '@pnote/storage/library';
import Editor from '../src/screens/Editor.svelte';

describe('Editor screen', () => {
  it('shows an error with a way back when the document cannot be opened', async () => {
    const lib = {
      openDocument: vi.fn(async () => { throw new Error('tampered'); }),
      listPresets: vi.fn(async () => []),
    } as unknown as Library;
    const onClose = vi.fn();
    render(Editor, { lib, author: { profileId: 'p1', name: 'A' }, docId: 'd1', onClose });
    expect(await screen.findByText('เปิดเอกสารไม่สำเร็จ ไฟล์อาจเสียหายหรือถูกแก้ไข')).toBeInTheDocument();
    await fireEvent.click(screen.getByRole('button', { name: 'กลับ' }));
    expect(onClose).toHaveBeenCalled();
  });
});
