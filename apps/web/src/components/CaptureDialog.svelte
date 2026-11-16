<script lang="ts">
  import { captureErrorMessage, type CaptureResult, type WebCapture } from '../platform/capture';
  let { capture, onCaptured, onCancel }: { capture: WebCapture; onCaptured: (c: CaptureResult) => Promise<void>; onCancel: () => void } = $props();
  let url = $state('');
  let busy = $state(false);
  let error = $state('');

  async function submit(e: Event) {
    e.preventDefault();
    error = '';
    let target = url.trim();
    if (target && !/^https?:\/\//i.test(target)) target = `https://${target}`;
    try { new URL(target); } catch { error = 'ลิงก์ไม่ถูกต้อง'; return; }
    busy = true;
    try {
      await onCaptured(await capture.capture(target));
    } catch (err) {
      error = captureErrorMessage((err as { code?: string }).code);
      if (!error) onCancel();
    } finally {
      busy = false;
    }
  }
</script>

<div class="backdrop">
  <div class="screen" role="dialog" aria-label="บันทึกหน้าเว็บ">
    <h2>บันทึกหน้าเว็บเป็นหลักฐาน</h2>
    {#if capture.available}
      <form onsubmit={submit}>
        <label>ลิงก์ <input type="url" inputmode="url" bind:value={url} placeholder="https://" autocomplete="off" /></label>
        <p class="muted">หน้าเว็บจะเปิดให้ดูก่อน ล็อกอินเองได้ถ้าจำเป็น แล้วกด "บันทึกหน้านี้" แอปจะเก็บ PDF ภาพหน้าจอ ไฟล์หน้าเว็บ และค่า SHA-256 พร้อม URL และเวลา</p>
        {#if error}<p class="error" role="alert">{error}</p>{/if}
        <div class="row">
          <button type="button" onclick={onCancel} disabled={busy}>ยกเลิก</button>
          <button class="primary" type="submit" disabled={busy}>{busy ? 'กำลังบันทึก…' : 'เปิดหน้าเว็บ'}</button>
        </div>
      </form>
    {:else}
      <p>เวอร์ชันเว็บบันทึกหน้าเว็บจากลิงก์เองไม่ได้ ให้เปิดหน้านั้นในเบราว์เซอร์ แล้วสั่ง "พิมพ์ → บันทึกเป็น PDF" จากนั้นนำเข้าไฟล์ PDF</p>
      <div class="row"><button class="primary" onclick={onCancel}>เข้าใจแล้ว</button></div>
    {/if}
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: #0004; display: grid; place-items: center; z-index: 40; }
  .screen { margin: 0; width: min(460px, 92vw); }
  .muted { color: #6b7380; font-size: 13px; margin: 0; }
</style>
