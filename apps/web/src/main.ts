import { mount } from 'svelte';
import { IndexedDbAdapter } from '@pnote/storage/idb-adapter';
import { WebNoDeviceKey } from '@pnote/storage/device-key';
import App from './App.svelte';
import '@fontsource/sarabun/thai-400.css';
import '@fontsource/sarabun/thai-700.css';
import '@fontsource/sarabun/latin-400.css';
import '@fontsource/sarabun/latin-700.css';
import './app.css';

let persistAsked = false;
async function askPersist(): Promise<void> {
  if (persistAsked || !navigator.storage?.persist) return;
  persistAsked = true;
  if (await navigator.storage.persisted()) return;
  if (!(await navigator.storage.persist())) {
    const note = document.createElement('div');
    note.setAttribute('role', 'status');
    note.className = 'persist-warning';
    note.textContent = 'เบราว์เซอร์อาจลบข้อมูลถ้าไม่ได้ใช้นาน โปรดติดตั้งแอปหรือสำรองข้อมูลเป็นประจำ';
    Object.assign(note.style, { position: 'fixed', bottom: '12px', left: '50%', transform: 'translateX(-50%)', background: '#fff4d6', padding: '8px 14px', borderRadius: '8px', zIndex: '50' });
    document.body.append(note);
    setTimeout(() => note.remove(), 10_000);
  }
}

mount(App, {
  target: document.getElementById('app')!,
  props: { adapter: new IndexedDbAdapter('pnote'), device: WebNoDeviceKey, onFirstUnlock: () => void askPersist() },
});
