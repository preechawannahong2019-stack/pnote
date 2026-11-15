<script lang="ts">
  import type { DocumentMeta } from '@pnote/core/types';
  import { PageRenderer } from '@pnote/ink/renderer';
  import type { Library } from '@pnote/storage/library';
  let { lib, meta }: { lib: Library; meta: DocumentMeta } = $props();
  let base = $state<HTMLCanvasElement>();
  let live = $state<HTMLCanvasElement>();
  const W = 150;

  $effect(() => {
    if (!base || !live || !meta.pages[0]) return;
    const page = meta.pages[0];
    const scale = W / page.widthPt;
    base.width = live.width = W;
    base.height = live.height = Math.round(page.heightPt * scale);
    const r = new PageRenderer(base, live);
    r.setViewport({ scale, offsetX: 0, offsetY: 0, dpr: 1 });
    let cancelled = false;
    lib.openDocument(meta.id).then(({ state }) => {
      if (!cancelled) r.renderPage(page, state.strokes[page.id] ?? [], state.shapes[page.id] ?? []);
    });
    return () => { cancelled = true; };
  });
</script>

<div class="thumb"><canvas bind:this={base}></canvas><canvas bind:this={live} hidden></canvas></div>

<style>
  .thumb { background: #f3f5f8; border-radius: 6px; overflow: hidden; display: grid; place-items: center; }
  canvas { display: block; width: 100%; height: auto; }
</style>
