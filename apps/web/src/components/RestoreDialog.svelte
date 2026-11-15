<script lang="ts">
  import type { DocumentMeta, Id } from '@pnote/core/types';
  import type { ConflictChoice } from '@pnote/storage/backup-io';
  import { backupErrorText } from '../lib/backup-flow';
  let { file, run, onDone, onCancel }: {
    file: File;
    run: (password: string, choose: (existing: DocumentMeta, incoming: { id: Id; title: string }) => Promise<ConflictChoice>) => Promise<DocumentMeta[]>;
    onDone: (imported: DocumentMeta[]) => void; onCancel: () => void;
  } = $props();
  let password = $state('');
  let error = $state('');
  let busy = $state(false);
  let asking = $state<{ title: string; answer: (c: ConflictChoice) => void } | null>(null);

  async function go(e: Event) {
    e.preventDefault();
    error = '';
    busy = true;
    try {
      const out = await run(password, (existing) => new Promise((answer) => (asking = { title: existing.title, answer })));
      onDone(out);
    } catch (err) {
      error = backupErrorText(err);
    } finally {
      busy = false;
      asking = null;
    }
  }
  const pick = (c: ConflictChoice) => { const a = asking; asking = null; a?.answer(c); };
</script>

<div class="backdrop">
  <form class="screen" role="dialog" aria-label="นำเข้าไฟล์ .pnote" onsubmit={go}>
    <h2>นำเข้า "{file.name}"</h2>
    {#if asking}
      <p>มีเอกสาร "{asking.title}" อยู่แล้ว</p>
      <div class="row">
        <button type="button" onclick={() => pick('copy')}>เก็บทั้งสองฉบับ</button>
        <button type="button" class="primary" onclick={() => pick('replace')}>แทนที่ฉบับเดิม</button>
      </div>
      <p class="hint">ฉบับเดิมจะถูกซ่อนไว้ ไม่ถูกลบ</p>
    {:else}
      <label>รหัสผ่านไฟล์สำรอง <input type="password" bind:value={password} autocomplete="off" /></label>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      {#if busy}<p role="status">กำลังนำเข้า…</p>{/if}
      <div class="row">
        <button type="button" disabled={busy} onclick={onCancel}>ยกเลิก</button>
        <button class="primary" type="submit" disabled={busy}>นำเข้า</button>
      </div>
    {/if}
  </form>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: #0004; display: grid; place-items: center; z-index: 40; }
  .screen { margin: 0; width: min(440px, 92vw); }
  .hint { color: #6b7380; font-size: 13px; }
</style>
