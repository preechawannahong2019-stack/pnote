<script lang="ts">
  import { onDestroy } from 'svelte';
  import { newId } from '@pnote/core/ids';
  import type { Author, Id, PageTemplate, PenPreset, PenStyle } from '@pnote/core/types';
  import { InputRouter, type InputMode, type PointerSample, type RouterAction } from '@pnote/ink/input-router';
  import { PageRenderer } from '@pnote/ink/renderer';
  import type { Library } from '@pnote/storage/library';
  import Toolbar from '../components/Toolbar.svelte';
  import PageStrip from '../components/PageStrip.svelte';
  import { EditorController, type ActiveTool } from '../lib/editor-controller';
  import { READ_ONLY_MESSAGE } from '../lib/doc-lock';
  import { EditorSession } from '../lib/session';
  import { loadToolbarState, saveToolbarState, type ToolbarState } from '../lib/toolbar-state';
  import { loadSettings, saveSettings } from '../lib/settings';
  import { createRenderPlan } from '../lib/render-plan';

  let { lib, author, docId, onClose }: { lib: Library; author: Author; docId: Id; onClose: () => void } = $props();

  let session = $state<EditorSession | null>(null);
  let ctrl: EditorController | null = null;
  let router: InputRouter | null = null;
  let renderer: PageRenderer | null = null;

  let host = $state<HTMLDivElement>();
  let base = $state<HTMLCanvasElement>();
  let live = $state<HTMLCanvasElement>();

  // UI mirrors of controller state
  let mode = $state<InputMode>('pen');
  let tool = $state<ActiveTool>('pen');
  let style = $state<PenStyle>({ color: '#000', width: 1, opacity: 1, pressureCurve: 'normal', taperStart: 0, taperEnd: 0, smoothing: 0.5 });
  let presets = $state<PenPreset[]>([]);
  let tb = $state<ToolbarState>(loadToolbarState(window.innerWidth));
  let settings = $state(loadSettings());
  let pageIndex = $state(0);
  let version = $state(0);
  let view = { scale: 1, offsetX: 0, offsetY: 0 };
  let fitted = false;

  const pages = $derived.by(() => { void version; return session?.history.state.pages ?? []; });
  const page = $derived(pages[Math.min(pageIndex, pages.length - 1)]);

  function sync() {
    if (!ctrl) return;
    mode = ctrl.mode; tool = ctrl.tool; style = { ...ctrl.style };
  }

  let openError = $state('');
  let saveError = $state(false);
  let auditBroken = $state(false);
  let destroyed = false;

  (async () => {
    let s: EditorSession;
    try {
      s = await EditorSession.open(lib, author, docId);
    } catch {
      openError = 'เปิดเอกสารไม่สำเร็จ ไฟล์อาจเสียหายหรือถูกแก้ไข';
      return;
    }
    if (destroyed) { await s.close(); return; }
    ctrl = new EditorController(s, { scribbleToErase: settings.scribble, autoShapes: settings.autoShapes });
    router = new InputRouter(ctrl.mode);
    s.history.onChange(() => { version++; plan.markBase(); requestRender(); });
    s.onSaveError(() => { saveError = true; });
    auditBroken = s.auditBroken;
    presets = await lib.listPresets().catch(() => []);
    session = s;
    sync();
  })();

  const plan = createRenderPlan();
  let raf = 0;
  function requestRender() {
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; render(); });
  }

  function fit() {
    if (!host || !page) return;
    const w = host.clientWidth;
    view.scale = Math.min(2, (w - 32) / page.widthPt);
    view.offsetX = (w - page.widthPt * view.scale) / 2;
    view.offsetY = 70;
  }

  function render() {
    if (!renderer || !session || !page || !host || !base || !live) return;
    const dpr = window.devicePixelRatio || 1;
    const w = host.clientWidth, h = host.clientHeight;
    for (const c of [base, live]) {
      if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    }
    if (!fitted) { fit(); fitted = true; plan.markBase(); }
    renderer.setViewport({ ...view, dpr });
    const todo = plan.take();
    if (todo.base) {
      const st = session.history.state;
      const erasing = ctrl?.erasing ?? new Set<Id>();
      const strokes = (st.strokes[page.id] ?? []).map((s) => (erasing.has(s.id) ? { ...s, hidden: true } : s));
      const shapes = (st.shapes[page.id] ?? []).map((s) => (erasing.has(s.id) ? { ...s, hidden: true } : s));
      renderer.renderPage(page, strokes, shapes);
    }
    if (!todo.live) return;
    const pts = ctrl?.livePoints();
    if (pts && ctrl) {
      if (ctrl.tool === 'lasso') drawLasso(pts);
      else renderer.drawLive(pts, ctrl.inkTool, ctrl.style, ctrl.liveInput);
    } else {
      renderer.clearLive();
      drawSelection();
    }
  }

  function drawLasso(pts: Float32Array) {
    const ctx = live!.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, live!.width, live!.height);
    ctx.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, view.offsetX * dpr, view.offsetY * dpr);
    ctx.setLineDash([4 / view.scale, 4 / view.scale]);
    ctx.strokeStyle = '#3b6ea5';
    ctx.lineWidth = 1 / view.scale;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i += 4) (i ? ctx.lineTo : ctx.moveTo).call(ctx, pts[i], pts[i + 1]);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  function drawSelection() {
    const b = ctrl?.selectionBBox();
    if (!b) return;
    const ctx = live!.getContext('2d')!;
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(view.scale * dpr, 0, 0, view.scale * dpr, view.offsetX * dpr, view.offsetY * dpr);
    ctx.setLineDash([4 / view.scale, 4 / view.scale]);
    ctx.strokeStyle = '#3b6ea5';
    ctx.lineWidth = 1 / view.scale;
    ctx.strokeRect(b.minX - 6, b.minY - 6, b.maxX - b.minX + 12, b.maxY - b.minY + 12);
    ctx.setLineDash([]);
  }

  $effect(() => {
    if (base && live && !renderer) renderer = new PageRenderer(base, live);
    void page; void version;
    plan.markBase();
    requestRender();
  });

  $effect(() => {
    if (!host) return;
    const ro = new ResizeObserver(() => { plan.markBase(); requestRender(); });
    ro.observe(host);
    return () => ro.disconnect();
  });

  function toPt(a: RouterAction): RouterAction {
    if (a.kind === 'stroke-begin' || a.kind === 'stroke-point') {
      return { ...a, x: (a.x - view.offsetX) / view.scale, y: (a.y - view.offsetY) / view.scale };
    }
    return a;
  }

  async function handle(actions: RouterAction[], t: number) {
    if (!ctrl || !page) return;
    const ink: RouterAction[] = [];
    for (const a of actions) {
      if (a.kind === 'pan') { view.offsetX += a.dx; view.offsetY += a.dy; plan.markBase(); }
      else if (a.kind === 'zoom') {
        const s = Math.min(8, Math.max(0.25, view.scale * a.scale));
        const k = s / view.scale;
        view.offsetX = a.cx - (a.cx - view.offsetX) * k;
        view.offsetY = a.cy - (a.cy - view.offsetY) * k;
        view.scale = s;
        plan.markBase();
      } else if (a.kind === 'three-finger-tap') setToolbar({ ...tb, fullscreen: !tb.fullscreen });
      else ink.push(toPt(a));
    }
    if (ink.length && !session?.readOnly) {
      await ctrl.onActions(page.id, ink, t);
      if (ctrl.tool === 'eraser') plan.markBase(); // erase preview lives on the base layer
      if (ink.some((a) => a.kind === 'stroke-end' || a.kind === 'stroke-cancel')) {
        version++; // selection, undo state and toolbar depend on the finished stroke
        plan.markBase();
        sync();
      }
    }
    plan.markLive();
    requestRender();
  }

  function sample(e: PointerEvent, type: PointerSample['type']): PointerSample {
    const r = host!.getBoundingClientRect();
    const kind = e.pointerType === 'pen' ? 'pen' : e.pointerType === 'touch' ? 'touch' : 'mouse';
    const pressure = kind === 'pen' ? e.pressure : 0.5;
    return { type, pointerId: e.pointerId, pointerType: kind, x: e.clientX - r.left, y: e.clientY - r.top, pressure, t: e.timeStamp };
  }

  function onDown(e: PointerEvent) {
    if (!router) return;
    host!.setPointerCapture(e.pointerId);
    void handle(router.handle(sample(e, 'down')), e.timeStamp);
  }
  function onMove(e: PointerEvent) {
    if (!router) return;
    const evs = e.getCoalescedEvents?.() ?? [e];
    const acts = (evs.length ? evs : [e]).flatMap((ev) => router!.handle(sample(ev, 'move')));
    void handle(acts, e.timeStamp);
  }
  function onUp(e: PointerEvent, type: 'up' | 'cancel') {
    if (!router) return;
    void handle(router.handle(sample(e, type)), e.timeStamp);
  }
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const r = host!.getBoundingClientRect();
      void handle([{ kind: 'zoom', scale: Math.exp(-e.deltaY / 300), cx: e.clientX - r.left, cy: e.clientY - r.top }], e.timeStamp);
    } else {
      void handle([{ kind: 'pan', dx: -e.deltaX, dy: -e.deltaY }], e.timeStamp);
    }
  }

  function onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.closest?.('input, select, textarea')) return;
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); void (e.shiftKey ? redo() : undo()); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); void redo(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && ctrl?.selection.length) { e.preventDefault(); void deleteSelection(); }
  }

  async function undo() { await session?.undo(); ctrl?.clearSelection(); sync(); }
  async function redo() { await session?.redo(); sync(); }
  async function deleteSelection() { await ctrl?.deleteSelection(); version++; requestRender(); }

  function setMode(m: InputMode) { if (!ctrl || !router) return; ctrl.mode = m; void handle(router.setMode(m), performance.now()); sync(); }
  function setTool(t: ActiveTool) { if (!ctrl) return; ctrl.tool = t; if (t !== 'lasso') ctrl.clearSelection(); sync(); requestRender(); }
  function setStyle(s: PenStyle) { if (!ctrl) return; ctrl.style = s; sync(); }
  function setToolbar(s: ToolbarState) { tb = s; saveToolbarState(window.innerWidth, s); }
  function setSettings(s: { scribble: boolean; autoShapes: boolean }) {
    settings = s; saveSettings(s);
    if (ctrl) ctrl.opts = { scribbleToErase: s.scribble, autoShapes: s.autoShapes };
  }

  async function savePreset(name: string) {
    if (!ctrl) return;
    const next = [...presets, { id: newId(), name, tool: ctrl.inkTool, style: { ...ctrl.style } }];
    await lib.savePresets(next);
    presets = next;
  }
  function applyPreset(p: PenPreset) { ctrl?.applyPreset(p); sync(); }
  async function deletePreset(id: string) { const next = presets.filter((p) => p.id !== id); await lib.savePresets(next); presets = next; }

  async function addPage(t: PageTemplate) { await ctrl?.addPage(t); pageIndex = pages.length - 1; }
  async function removePage(i: number) {
    if (!session || pages.length <= 1) return;
    await session.run({ type: 'removePage', pageId: pages[i].id });
    pageIndex = Math.max(0, i - 1);
  }
  async function movePage(i: number, to: number) {
    if (!session) return;
    await session.run({ type: 'reorderPage', pageId: pages[i].id, toIndex: to });
    pageIndex = to;
  }

  async function close() { await session?.close(); onClose(); }
  onDestroy(() => { destroyed = true; if (raf) cancelAnimationFrame(raf); void session?.close(); });
</script>

<svelte:window onkeydown={onKey} />

<div class="editor">
  {#if session}
    <Toolbar
      title={session.meta.title} {mode} {tool} {style} {presets} {tb}
      canUndo={version >= 0 && session.history.canUndo} canRedo={version >= 0 && session.history.canRedo}
      readOnly={session.readOnly} hasSelection={version >= 0 && (ctrl?.selection.length ?? 0) > 0}
      scribble={settings.scribble} autoShapes={settings.autoShapes}
      onBack={close} onMode={setMode} onTool={setTool} onStyle={setStyle} onUndo={undo} onRedo={redo}
      onToolbar={setToolbar} onDeleteSelection={deleteSelection}
      onSavePreset={savePreset} onApplyPreset={applyPreset} onDeletePreset={deletePreset} onSettings={setSettings}
    />
    {#if session.readOnly}<div class="ro" role="status">{READ_ONLY_MESSAGE}</div>{/if}
    {#if saveError && version >= 0 && session.saveFailed}<div class="ro err" role="alert">บันทึกไม่สำเร็จ กำลังลองใหม่ — อย่าปิดแอป</div>{/if}
    {#if auditBroken}<div class="ro err" role="alert">ประวัติการแก้ไขของเอกสารนี้ไม่ต่อเนื่อง อาจถูกแก้ไขจากภายนอก</div>{/if}
  {:else if openError}
    <div class="screen open-error">
      <p class="error" role="alert">{openError}</p>
      <button onclick={onClose}>กลับ</button>
    </div>
  {/if}
  <div
    class="canvas-host" role="application" aria-label="พื้นที่เขียน" bind:this={host} data-testid="canvas-host"
    onpointerdown={onDown} onpointermove={onMove}
    onpointerup={(e) => onUp(e, 'up')} onpointercancel={(e) => onUp(e, 'cancel')}
    onwheel={onWheel}
  >
    <canvas bind:this={base} class="layer"></canvas>
    <canvas bind:this={live} class="layer"></canvas>
  </div>
  {#if session && !tb.fullscreen}
    <PageStrip {pages} current={pageIndex} readOnly={session.readOnly} onSelect={(i) => { pageIndex = i; fitted = false; requestRender(); }} onAdd={addPage} onRemove={removePage} onMove={movePage} />
  {/if}
</div>

<style>
  .editor { position: fixed; inset: 0; background: #dfe3ea; overflow: hidden; }
  .canvas-host { position: absolute; inset: 0; touch-action: none; user-select: none; -webkit-user-select: none; }
  .layer { position: absolute; inset: 0; width: 100%; height: 100%; }
  .open-error { position: relative; z-index: 12; }
  .err { background: #fde2e1 !important; color: #8c1d18; top: 96px !important; }
  .ro { position: absolute; top: 56px; left: 50%; transform: translateX(-50%); z-index: 11; background: #fff4d6; padding: 6px 12px; border-radius: 8px; }
</style>
