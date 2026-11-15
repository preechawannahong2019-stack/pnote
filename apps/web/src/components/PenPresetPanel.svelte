<script lang="ts">
  import type { PenPreset, PenStyle, PressureCurve } from '@pnote/core/types';
  import { MAX_PRESETS } from '@pnote/storage/library';
  let { style, presets, onStyle, onSavePreset, onApplyPreset, onDeletePreset }: {
    style: PenStyle; presets: PenPreset[];
    onStyle: (s: PenStyle) => void; onSavePreset: (name: string) => void; onApplyPreset: (p: PenPreset) => void; onDeletePreset: (id: string) => void;
  } = $props();
  const curves: [PressureCurve, string][] = [['soft', 'นุ่ม'], ['normal', 'ปกติ'], ['firm', 'แข็ง'], ['off', 'ปิด']];
  const set = (patch: Partial<PenStyle>) => onStyle({ ...style, ...patch });
  const num = (e: Event) => Number((e.currentTarget as HTMLInputElement).value);
</script>

<div class="panel" role="dialog" aria-label="ตั้งค่าปากกา">
  <label>ความโปร่งใส <input type="range" min="0.05" max="1" step="0.05" value={style.opacity} oninput={(e) => set({ opacity: num(e) })} /></label>
  <label>ความไวแรงกด
    <select value={style.pressureCurve} onchange={(e) => set({ pressureCurve: (e.currentTarget as HTMLSelectElement).value as PressureCurve })}>
      {#each curves as [v, t]}<option value={v}>{t}</option>{/each}
    </select>
  </label>
  <label>เรียวปลายเริ่ม <input type="range" min="0" max="1" step="0.05" value={style.taperStart} oninput={(e) => set({ taperStart: num(e) })} /></label>
  <label>เรียวปลายจบ <input type="range" min="0" max="1" step="0.05" value={style.taperEnd} oninput={(e) => set({ taperEnd: num(e) })} /></label>
  <label>ความเรียบของเส้น <input type="range" min="0" max="1" step="0.05" value={style.smoothing} oninput={(e) => set({ smoothing: num(e) })} /></label>
  <h3>ปากกาโปรด ({presets.length}/{MAX_PRESETS})</h3>
  <ul>
    {#each presets as p (p.id)}
      <li>
        <button class="preset" onclick={() => onApplyPreset(p)}>
          <span class="dot" style:background={p.style.color} style:opacity={p.style.opacity}></span>{p.name}
        </button>
        <button class="x" aria-label="ลบ {p.name}" onclick={() => onDeletePreset(p.id)}>✕</button>
      </li>
    {/each}
  </ul>
  <button disabled={presets.length >= MAX_PRESETS} onclick={() => { const n = prompt('ชื่อปากกาโปรด', `ปากกา ${presets.length + 1}`); if (n?.trim()) onSavePreset(n.trim()); }}>บันทึกเป็นปากกาโปรด</button>
</div>

<style>
  .panel { position: absolute; top: 100%; right: 0; z-index: 30; background: #fff; border-radius: 12px; box-shadow: 0 4px 20px #0003; padding: 14px; width: 260px; display: flex; flex-direction: column; gap: 10px; }
  ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 4px; }
  li { display: flex; gap: 4px; }
  .preset { flex: 1; display: flex; gap: 8px; align-items: center; text-align: left; padding: 6px 8px; }
  .dot { width: 14px; height: 14px; border-radius: 50%; display: inline-block; }
  .x { padding: 4px 8px; }
  h3 { margin: 6px 0 0; font-size: 14px; }
</style>
