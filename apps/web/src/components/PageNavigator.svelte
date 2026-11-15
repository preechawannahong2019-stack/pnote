<script lang="ts">
  import type { PageRef } from '@pnote/core/types';
  import type { PageSources } from '../lib/page-sources';
  let { pages, current, sources, onSelect }: { pages: PageRef[]; current: number; sources: PageSources | null; onSelect: (i: number) => void } = $props();

  const ITEM = 132;
  let open = $state(false);
  let list = $state<HTMLDivElement>();
  let scrollTop = $state(0);
  let height = $state(600);
  let jump = $state('');
  const first = $derived(Math.max(0, Math.floor(scrollTop / ITEM) - 2));
  const last = $derived(Math.min(pages.length, Math.ceil((scrollTop + height) / ITEM) + 2));

  function go(e: Event) {
    e.preventDefault();
    const n = Number(jump);
    if (Number.isInteger(n) && n >= 1 && n <= pages.length) onSelect(n - 1);
    jump = '';
  }

  function thumb(node: HTMLCanvasElement, page: PageRef) {
    let alive = true;
    sources?.background(page, 120).then((bg) => {
      if (!alive || !bg) return;
      node.width = 100;
      node.height = Math.round((100 * page.heightPt) / page.widthPt);
      node.getContext('2d')!.drawImage(bg, 0, 0, node.width, node.height);
    }).catch(() => {});
    return { destroy: () => { alive = false; } };
  }

  $effect(() => {
    if (open && list) { list.scrollTop = Math.max(0, current * ITEM - ITEM); height = list.clientHeight; }
  });
</script>

<nav class="nav" aria-label="หน้า">
  <button aria-label="หน้าก่อน" disabled={current === 0} onclick={() => onSelect(current - 1)}>◀</button>
  <form onsubmit={go}>
    <input aria-label="ไปหน้า" inputmode="numeric" placeholder={String(current + 1)} bind:value={jump} size="4" />
    <span>/ {pages.length}</span>
  </form>
  <button aria-label="หน้าถัดไป" disabled={current >= pages.length - 1} onclick={() => onSelect(current + 1)}>▶</button>
  <button aria-label="ภาพย่อทุกหน้า" aria-expanded={open} onclick={() => (open = !open)}>▤</button>
</nav>

{#if open}
  <div class="thumbs" bind:this={list} onscroll={() => (scrollTop = list!.scrollTop)} role="list">
    <div style:height="{pages.length * ITEM}px" class="spacer">
      {#each pages.slice(first, last) as pg, k (pg.id)}
        {@const i = first + k}
        <button class="item" class:on={i === current} style:top="{i * ITEM}px" onclick={() => { onSelect(i); open = false; }} role="listitem">
          <canvas use:thumb={pg}></canvas><span>{i + 1}</span>
        </button>
      {/each}
    </div>
  </div>
{/if}

<style>
  .nav { position: absolute; bottom: 8px; left: 50%; transform: translateX(-50%); z-index: 9; display: flex; gap: 6px; align-items: center; background: #fffffff2; padding: 6px 10px; border-radius: 10px; box-shadow: 0 2px 10px #0002; }
  .nav form { display: flex; gap: 4px; align-items: center; }
  .nav input { width: 56px; padding: 4px; text-align: center; }
  .nav button { padding: 4px 10px; }
  .thumbs { position: absolute; right: 8px; top: 64px; bottom: 64px; width: 140px; overflow-y: auto; z-index: 9; background: #fffffff2; border-radius: 10px; box-shadow: 0 2px 10px #0002; }
  .spacer { position: relative; }
  .item { position: absolute; left: 10px; width: 120px; height: 124px; display: flex; flex-direction: column; align-items: center; gap: 2px; padding: 4px; }
  .item canvas { width: 100px; max-height: 96px; background: #f3f5f8; }
  .item.on { outline: 2px solid var(--accent); }
</style>
