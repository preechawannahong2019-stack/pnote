<script lang="ts">
  import type { TextBox } from '@pnote/core/types';
  import { DEFAULT_TEXT_SIZE, DEFAULT_TEXT_WIDTH, type TextValue } from '../lib/editor-controller';
  let { x, y, existing, color, view, onDone, onCancel }: {
    x: number; y: number; existing?: TextBox; color: string;
    view: { scale: number; offsetX: number; offsetY: number };
    onDone: (v: TextValue) => void; onCancel: () => void;
  } = $props();

  let text = $state(existing?.text ?? '');
  let sizePt = $state(existing?.sizePt ?? DEFAULT_TEXT_SIZE);
  let bold = $state(existing?.bold ?? false);
  let col = $state(existing?.color ?? color);
  const px = existing?.x ?? x, py = existing?.y ?? y, w = existing?.w ?? DEFAULT_TEXT_WIDTH;
  let area = $state<HTMLTextAreaElement>();
  $effect(() => { area?.focus(); });

  const done = () => onDone({ text, sizePt, color: col, bold, x: px, y: py, w });
  function key(e: KeyboardEvent) {
    if (e.key === 'Escape') { e.preventDefault(); onCancel(); }
    else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); done(); }
  }
</script>

<div class="wrap" style:left="{px * view.scale + view.offsetX}px" style:top="{py * view.scale + view.offsetY}px">
  <textarea
    bind:this={area} bind:value={text} onkeydown={key} aria-label="ข้อความ"
    style:width="{w * view.scale}px" style:font-size="{sizePt * view.scale}px" style:font-weight={bold ? 700 : 400} style:color={col}
    rows={Math.max(2, text.split('\n').length)}
  ></textarea>
  <div class="bar">
    <select aria-label="ขนาดตัวอักษร" bind:value={sizePt}>
      {#each [10, 12, 14, 16, 18, 20, 24, 28, 32] as s}<option value={s}>{s}</option>{/each}
    </select>
    <button aria-label="ตัวหนา" aria-pressed={bold} class:on={bold} onclick={() => (bold = !bold)}><b>B</b></button>
    <input type="color" aria-label="สีตัวอักษร" bind:value={col} />
    <button onclick={onCancel}>ยกเลิก</button>
    <button class="primary" onclick={done}>เสร็จ</button>
  </div>
</div>

<style>
  .wrap { position: absolute; z-index: 15; }
  textarea { font-family: Sarabun, 'Noto Sans Thai', sans-serif; line-height: 1.4; background: #ffffffe6; border: 1px dashed var(--accent); border-radius: 4px; padding: 0; resize: none; display: block; }
  .bar { display: flex; gap: 4px; margin-top: 4px; background: #fff; padding: 4px; border-radius: 8px; box-shadow: 0 2px 8px #0002; width: max-content; }
  .bar button, .bar select { padding: 4px 8px; }
  .on { background: var(--accent); color: #fff; }
  input[type='color'] { width: 32px; height: 28px; padding: 1px; }
</style>
