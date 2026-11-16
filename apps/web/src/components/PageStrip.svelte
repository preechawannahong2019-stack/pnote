<script lang="ts">
  import type { PageRef, PageTemplate } from '@pnote/core/types';
  let { pages, current, readOnly, onSelect, onAdd, onRemove, onMove }: {
    pages: PageRef[]; current: number; readOnly: boolean;
    onSelect: (i: number) => void; onAdd: (t: PageTemplate) => void; onRemove: (i: number) => void; onMove: (i: number, to: number) => void;
  } = $props();
  let template = $state<PageTemplate>('plain');
</script>

<nav class="strip" aria-label="หน้า">
  {#each pages as pg, i (pg.id)}
    <button class="page" class:on={i === current} aria-current={i === current ? 'page' : undefined} onclick={() => onSelect(i)}>{i + 1}</button>
  {/each}
  {#if !readOnly}
    <select aria-label="แบบกระดาษ" bind:value={template}>
      <option value="plain">เปล่า</option><option value="lined">มีเส้น</option><option value="grid">ตาราง</option>
    </select>
    <button aria-label="เพิ่มหน้า" onclick={() => onAdd(template)}>＋</button>
    <button aria-label="ย้ายหน้าขึ้น" disabled={current === 0} onclick={() => onMove(current, current - 1)}>◀</button>
    <button aria-label="ย้ายหน้าลง" disabled={current === pages.length - 1} onclick={() => onMove(current, current + 1)}>▶</button>
    <button aria-label="ลบหน้า" disabled={pages.length <= 1} onclick={() => onRemove(current)}>🗑</button>
  {/if}
</nav>

<style>
  .strip { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); z-index: 9; display: flex; gap: 4px; background: #fffffff2; padding: 6px; border-radius: 10px; box-shadow: 0 2px 10px #0002; max-width: 95vw; overflow-x: auto; }
  .page { min-width: 34px; padding: 4px 8px; }
  .page.on { background: var(--accent); color: #fff; }
  button, select { padding: 4px 8px; }
</style>
