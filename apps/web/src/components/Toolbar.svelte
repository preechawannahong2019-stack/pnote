<script lang="ts">
  import type { PenPreset, PenStyle } from '@pnote/core/types';
  import type { InputMode } from '@pnote/ink/input-router';
  import type { ActiveTool } from '../lib/editor-controller';
  import type { Dock, ToolbarState } from '../lib/toolbar-state';
  import PenPresetPanel from './PenPresetPanel.svelte';

  let p: {
    title: string; mode: InputMode; tool: ActiveTool; style: PenStyle; presets: PenPreset[]; tb: ToolbarState;
    canUndo: boolean; canRedo: boolean; readOnly: boolean; hasSelection: boolean; scribble: boolean; autoShapes: boolean;
    onBack: () => void; onMode: (m: InputMode) => void; onTool: (t: ActiveTool) => void; onStyle: (s: PenStyle) => void;
    onUndo: () => void; onRedo: () => void; onToolbar: (s: ToolbarState) => void; onDeleteSelection: () => void;
    onSavePreset: (name: string) => void; onApplyPreset: (pr: PenPreset) => void; onDeletePreset: (id: string) => void;
    onSettings: (s: { scribble: boolean; autoShapes: boolean }) => void;
  } = $props();

  let panel = $state<null | 'pen' | 'settings'>(null);
  const tools: [ActiveTool, string, string][] = [['pen', '✏️', 'ปากกา'], ['highlighter', '🖍', 'ปากกาเน้นข้อความ'], ['eraser', '🧽', 'ยางลบ'], ['lasso', '➰', 'บ่วงบาศ']];
  const docks: [Dock, string][] = [['top', 'บน'], ['bottom', 'ล่าง'], ['left', 'ซ้าย'], ['right', 'ขวา']];
  const vertical = $derived(p.tb.dock === 'left' || p.tb.dock === 'right');
</script>

{#if p.tb.fullscreen}
  <button class="fs-exit" aria-label="ออกจากโหมดเต็มจอ" onclick={() => p.onToolbar({ ...p.tb, fullscreen: false })}>⤢</button>
{:else if p.tb.collapsed}
  <div class="toolbar collapsed dock-{p.tb.dock}" data-testid="toolbar">
    <button aria-label="แสดงแถบเครื่องมือ" onclick={() => p.onToolbar({ ...p.tb, collapsed: false })}>⌄</button>
  </div>
{:else}
  <div class="toolbar dock-{p.tb.dock}" class:vertical data-testid="toolbar">
    <button aria-label="กลับ" onclick={p.onBack}>←</button>
    {#if !vertical}<span class="title">{p.title}</span>{/if}
    <div class="group" role="radiogroup" aria-label="โหมดการเขียน">
      <button role="radio" aria-checked={p.mode === 'finger'} class:on={p.mode === 'finger'} onclick={() => p.onMode('finger')}>✍️ นิ้ว</button>
      <button role="radio" aria-checked={p.mode === 'pen'} class:on={p.mode === 'pen'} onclick={() => p.onMode('pen')}>🖊 ปากกา</button>
    </div>
    <div class="group">
      {#each tools as [t, icon, label]}
        <button aria-label={label} aria-pressed={p.tool === t} class:on={p.tool === t} onclick={() => p.onTool(t)}>{icon}</button>
      {/each}
    </div>
    {#if p.tool === 'pen' || p.tool === 'highlighter'}
      <div class="group">
        <input type="color" aria-label="สี" value={p.style.color} oninput={(e) => p.onStyle({ ...p.style, color: (e.currentTarget as HTMLInputElement).value })} />
        <input type="range" aria-label="ความหนา" min="0.2" max="20" step="0.1" value={p.style.width}
          oninput={(e) => p.onStyle({ ...p.style, width: Number((e.currentTarget as HTMLInputElement).value) })} />
        <span class="num">{p.style.width.toFixed(1)}</span>
        <div class="anchor">
          <button aria-label="ตั้งค่าปากกา" aria-expanded={panel === 'pen'} onclick={() => (panel = panel === 'pen' ? null : 'pen')}>⚙︎</button>
          {#if panel === 'pen'}
            <PenPresetPanel style={p.style} presets={p.presets} onStyle={p.onStyle} onSavePreset={p.onSavePreset} onApplyPreset={p.onApplyPreset} onDeletePreset={p.onDeletePreset} />
          {/if}
        </div>
      </div>
    {/if}
    {#if p.tool === 'lasso' && p.hasSelection}
      <button onclick={p.onDeleteSelection}>ลบที่เลือก</button>
    {/if}
    <div class="group">
      <button aria-label="เลิกทำ" disabled={!p.canUndo || p.readOnly} onclick={p.onUndo}>↶</button>
      <button aria-label="ทำซ้ำ" disabled={!p.canRedo || p.readOnly} onclick={p.onRedo}>↷</button>
    </div>
    <div class="group anchor">
      <button aria-label="ตั้งค่า" aria-expanded={panel === 'settings'} onclick={() => (panel = panel === 'settings' ? null : 'settings')}>⋯</button>
      {#if panel === 'settings'}
        <div class="menu" role="dialog" aria-label="ตั้งค่า">
          <label class="check"><input type="checkbox" checked={p.scribble} onchange={(e) => p.onSettings({ scribble: (e.currentTarget as HTMLInputElement).checked, autoShapes: p.autoShapes })} /> ขีดฆ่าเพื่อลบ</label>
          <label class="check"><input type="checkbox" checked={p.autoShapes} onchange={(e) => p.onSettings({ scribble: p.scribble, autoShapes: (e.currentTarget as HTMLInputElement).checked })} /> รูปทรงอัตโนมัติ (กดค้าง)</label>
          <label>ตำแหน่งแถบเครื่องมือ
            <select value={p.tb.dock} onchange={(e) => p.onToolbar({ ...p.tb, dock: (e.currentTarget as HTMLSelectElement).value as Dock })}>
              {#each docks as [d, t]}<option value={d}>{t}</option>{/each}
            </select>
          </label>
        </div>
      {/if}
      <button aria-label="โหมดเต็มจอ" onclick={() => p.onToolbar({ ...p.tb, fullscreen: true })}>⛶</button>
      <button aria-label="ย่อแถบเครื่องมือ" onclick={() => p.onToolbar({ ...p.tb, collapsed: true })}>⌃</button>
    </div>
  </div>
{/if}

<style>
  .toolbar { position: absolute; z-index: 10; display: flex; gap: 8px; align-items: center; background: #fffffff2; padding: 6px 10px; box-shadow: 0 2px 10px #0002; flex-wrap: wrap; }
  .dock-top { top: 0; left: 0; right: 0; }
  .dock-bottom { bottom: 0; left: 0; right: 0; }
  .dock-left { left: 0; top: 0; bottom: 0; flex-direction: column; flex-wrap: nowrap; overflow-y: auto; }
  .dock-right { right: 0; top: 0; bottom: 0; flex-direction: column; flex-wrap: nowrap; overflow-y: auto; }
  .vertical .group { flex-direction: column; }
  .collapsed { padding: 4px; right: auto; bottom: auto; border-radius: 0 0 10px 0; }
  .collapsed.dock-bottom { top: auto; bottom: 0; border-radius: 0 10px 0 0; }
  .collapsed.dock-right { left: auto; right: 0; border-radius: 0 0 0 10px; }
  .group { display: flex; gap: 4px; align-items: center; }
  .title { font-weight: 600; max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  button { padding: 6px 10px; }
  button.on { background: var(--accent); color: #fff; border-color: var(--accent); }
  .num { font-size: 12px; width: 32px; }
  input[type='range'] { width: 110px; }
  input[type='color'] { width: 36px; height: 32px; padding: 2px; }
  .anchor { position: relative; }
  .menu { position: absolute; top: 100%; right: 0; z-index: 30; background: #fff; border-radius: 12px; box-shadow: 0 4px 20px #0003; padding: 14px; width: 240px; display: flex; flex-direction: column; gap: 10px; }
  .fs-exit { position: absolute; z-index: 10; top: 8px; right: 8px; opacity: .5; padding: 4px 8px; }
</style>
