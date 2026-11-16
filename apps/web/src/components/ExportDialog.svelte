<script lang="ts">
  let { busy, canShare, onDownload, onShare, onCancel, error, warning = '' }: {
    busy: boolean; canShare: boolean; error: string; warning?: string;
    onDownload: (o: { includeTextLayer: boolean }) => void; onShare: (o: { includeTextLayer: boolean }) => void; onCancel: () => void;
  } = $props();
  let includeTextLayer = $state(true);
</script>

<div class="backdrop">
  <div class="screen" role="dialog" aria-label="ส่งออก PDF">
    <h2>ส่งออกเป็น PDF</h2>
    <label class="check"><input type="checkbox" bind:checked={includeTextLayer} /> ใส่ข้อความที่ค้นหาได้ (จาก OCR)</label>
    <p class="warn">ไฟล์ PDF ที่ส่งออกไม่ได้เข้ารหัส ผู้ที่ได้รับไฟล์จะเปิดอ่านได้ทันที</p>
    <p class="muted">ท้ายไฟล์จะมีหน้า "ข้อมูลรับรองเอกสาร" (SHA-256 ต้นฉบับ ผู้เขียน และผลตรวจประวัติการแก้ไข)</p>
    {#if warning}<p class="warn" role="status">{warning}</p>{/if}
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="row">
      <button onclick={onCancel} disabled={busy}>ยกเลิก</button>
      {#if canShare}<button onclick={() => onShare({ includeTextLayer })} disabled={busy}>แชร์</button>{/if}
      <button class="primary" onclick={() => onDownload({ includeTextLayer })} disabled={busy}>{busy ? 'กำลังสร้างไฟล์…' : 'ดาวน์โหลด'}</button>
    </div>
  </div>
</div>

<style>
  .backdrop { position: fixed; inset: 0; background: #0004; display: grid; place-items: center; z-index: 40; }
  .screen { margin: 0; width: min(440px, 92vw); }
  .muted { color: #6b7380; font-size: 13px; margin: 0; }
</style>
