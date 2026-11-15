<script lang="ts">
  import { checkBackupPassword } from '../lib/backup-flow';
  let { heading, canShare = false, onSubmit, onCancel }: {
    heading: string; canShare?: boolean; onSubmit: (password: string, how: 'save' | 'share') => Promise<void>; onCancel: () => void;
  } = $props();
  let a = $state('');
  let b = $state('');
  let error = $state('');
  let busy = $state(false);

  async function go(how: 'save' | 'share') {
    error = checkBackupPassword(a, b) ?? '';
    if (error) return;
    busy = true;
    try {
      await onSubmit(a, how);
      a = b = '';
    } catch (e) {
      error = `ส่งออกไม่สำเร็จ: ${(e as Error)?.message ?? e}`;
    } finally {
      busy = false;
    }
  }
</script>

<div class="backdrop">
  <form class="screen" role="dialog" aria-label={heading} onsubmit={(e) => { e.preventDefault(); void go('save'); }}>
    <h2>{heading}</h2>
    <label>รหัสผ่านไฟล์สำรอง (อย่างน้อย 10 ตัวอักษร) <input type="password" bind:value={a} autocomplete="new-password" /></label>
    <label>ยืนยันรหัสผ่านไฟล์สำรอง <input type="password" bind:value={b} autocomplete="new-password" /></label>
    <p class="warn">ถ้าลืมรหัสผ่านนี้ จะเปิดไฟล์สำรองไม่ได้</p>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if busy}<p role="status">กำลังเข้ารหัสและบันทึก…</p>{/if}
    <div class="row">
      <button type="button" disabled={busy} onclick={onCancel}>ยกเลิก</button>
      {#if canShare}<button type="button" disabled={busy} onclick={() => go('share')}>แชร์</button>{/if}
      <button class="primary" type="submit" disabled={busy}>บันทึกไฟล์</button>
    </div>
  </form>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: #0004; display: grid; place-items: center; z-index: 40; }
  .screen { margin: 0; width: min(440px, 92vw); }
</style>
