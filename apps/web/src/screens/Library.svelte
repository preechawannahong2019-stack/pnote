<script lang="ts">
  import type { Author, DocumentMeta, Folder, Id, PageTemplate } from '@pnote/core/types';
  import type { EncryptedStore } from '@pnote/storage/encrypted-store';
  import { FolderNotEmptyError, Library } from '@pnote/storage/library';
  import { BlobStore } from '@pnote/storage/blob-store';
  import Editor from './Editor.svelte';
  import Thumbnail from '../components/Thumbnail.svelte';
  import SearchResults from '../components/SearchResults.svelte';
  import ImportButton from '../components/ImportButton.svelte';
  import CaptureDialog from '../components/CaptureDialog.svelte';
  import IncomingPrompt from '../components/IncomingPrompt.svelte';
  import BackupDialog from '../components/BackupDialog.svelte';
  import RestoreDialog from '../components/RestoreDialog.svelte';
  import { backupFileName, exportAll, exportDoc, importBackup, isBackupFile, runExport } from '../lib/backup-flow';
  import { currentServices } from '../platform';
  import type { CaptureResult } from '../platform/capture';
  import { importFile, makeImporter } from '../lib/import-export';
  import { searchLibrary, type SearchHit } from '@pnote/pdf/search';

  let { store, author, onLock }: { store: EncryptedStore; author: Author; onLock: () => void } = $props();
  const lib = new Library(store, author);
  const blobs = new BlobStore(store);
  lib.cleanupOrphans().catch(() => {});
  const importer = makeImporter(lib, blobs, author);
  let capturing = $state(false);

  async function saveCapture(c: CaptureResult) {
    importing = 'กำลังบันทึกหน้าเว็บ…';
    try {
      const meta = await importer.importWebCapture(c, folderId);
      capturing = false;
      await refresh();
      openDoc = meta.id;
    } finally {
      importing = '';
    }
  }
  let importing = $state<string | null>(null);
  let dragOver = $state(false);

  let backup = $state<null | { doc: DocumentMeta | null }>(null);
  let restoring = $state<File | null>(null);
  let pnoteInput = $state<HTMLInputElement>();

  async function doBackup(password: string, how: 'save' | 'share') {
    const exp = currentServices().exporter;
    const target = backup?.doc ?? null;
    const name = backupFileName(target ? target.title : author.name);
    await runExport(exp, how, name, target ? exportDoc(lib, blobs, target.id, password, author)
      : exportAll(lib, blobs, password, author, (d, t) => (importing = `กำลังสำรอง ${d}/${t} เอกสาร`)));
    importing = null;
    backup = null;
  }

  async function importFiles(files: File[]) {
    error = '';
    const backups = files.filter(isBackupFile);
    if (backups.length) { restoring = backups[0]; files = files.filter((f) => !isBackupFile(f)); if (!files.length) return; }
    let lastOk: DocumentMeta | null = null;
    for (const f of files) {
      importing = `กำลังนำเข้า ${f.name}`;
      const r = await importFile(importer, f, folderId, (p) => (importing = `กำลังนำเข้า ${f.name} ${Math.round(p * 100)}%`));
      if (typeof r === 'string') error = `${f.name}: ${r}`;
      else lastOk = r;
    }
    importing = null;
    await refresh();
    if (lastOk && files.length === 1) openDoc = lastOk.id;
  }

  let folders = $state<Folder[]>([]);
  let docs = $state<DocumentMeta[]>([]);
  let folderId = $state<Id | null>(null);
  let query = $state('');
  let openDoc = $state<Id | null>(null);
  let openPage = $state(0);
  let found = $state<{ titleMatches: DocumentMeta[]; hits: SearchHit[] }>({ titleMatches: [], hits: [] });
  let searching = $state(false);
  let allDocs = $state(new Map<Id, DocumentMeta>());
  let searchTimer: ReturnType<typeof setTimeout> | null = null;
  let searchAbort: AbortController | null = null;

  $effect(() => {
    const q = query.trim();
    if (searchTimer) clearTimeout(searchTimer);
    searchAbort?.abort();
    if (!q) { found = { titleMatches: [], hits: [] }; return; }
    searchTimer = setTimeout(async () => {
      const ac = (searchAbort = new AbortController());
      searching = true;
      try {
        allDocs = new Map((await lib.searchByTitle('')).map((d) => [d.id, d]));
        const r = await searchLibrary(lib, q, { signal: ac.signal });
        if (!ac.signal.aborted) found = r;
      } finally {
        if (!ac.signal.aborted) searching = false;
      }
    }, 300);
  });
  let dialog = $state<null | 'notebook' | 'folder'>(null);
  let newTitle = $state('');
  let newTemplate = $state<PageTemplate>('plain');
  let error = $state('');

  async function refresh() {
    folders = await lib.listFolders();
    docs = query.trim() ? await lib.searchByTitle(query) : await lib.listDocuments(folderId);
  }
  $effect(() => { void folderId; void query; void openDoc; refresh(); });

  const childFolders = $derived(query.trim() ? [] : folders.filter((f) => f.parentId === folderId));
  const crumbs = $derived.by(() => {
    const out: Folder[] = [];
    let cur = folders.find((f) => f.id === folderId);
    while (cur) { out.unshift(cur); cur = folders.find((f) => f.id === cur!.parentId); }
    return out;
  });

  async function create(e: Event) {
    e.preventDefault();
    const title = newTitle.trim();
    if (!title) return;
    if (dialog === 'notebook') {
      const d = await lib.createNotebook(title, folderId, newTemplate);
      openDoc = d.id;
    } else {
      await lib.createFolder(title, folderId);
    }
    dialog = null;
    newTitle = '';
    await refresh();
  }

  async function rename(d: DocumentMeta) {
    const t = prompt('ชื่อใหม่', d.title);
    if (t?.trim()) { await lib.renameDocument(d.id, t.trim()); await refresh(); }
  }

  async function move(d: DocumentMeta, target: string) {
    await lib.moveDocument(d.id, target === '' ? null : target);
    await refresh();
  }

  async function removeFolder(f: Folder) {
    error = '';
    try { await lib.deleteFolder(f.id); await refresh(); }
    catch (err) { if (err instanceof FolderNotEmptyError) error = 'ลบไม่ได้ โฟลเดอร์ยังมีเอกสารหรือโฟลเดอร์ย่อย'; else throw err; }
  }
</script>

<IncomingPrompt incoming={currentServices().incoming} profileName={author.name} onImport={(f) => importFiles([f])} />
{#if backup}
  <BackupDialog heading={backup.doc ? `ส่งออก "${backup.doc.title}" เป็น .pnote` : 'สำรองโปรไฟล์ทั้งหมด'} canShare={currentServices().exporter.canShare}
    onSubmit={doBackup} onCancel={() => (backup = null)} />
{/if}
{#if restoring}
  <RestoreDialog file={restoring} run={(pw, choose) => importBackup(lib, blobs, restoring!, pw, author, choose)}
    onDone={async (out) => { restoring = null; await refresh(); error = out.length ? '' : 'ไม่มีเอกสารที่นำเข้าได้'; }} onCancel={() => (restoring = null)} />
{/if}
<input bind:this={pnoteInput} type="file" hidden accept=".pnote,application/x-pnote-backup" data-testid="pnote-input"
  onchange={(e) => { const f = (e.currentTarget as HTMLInputElement).files?.[0]; (e.currentTarget as HTMLInputElement).value = ''; if (f) restoring = f; }} />
{#if capturing}
  <CaptureDialog capture={currentServices().capture} onCaptured={saveCapture} onCancel={() => (capturing = false)} />
{/if}
{#if openDoc}
  <Editor {lib} {blobs} {author} docId={openDoc} initialPage={openPage} highlight={query.trim()} onClose={() => { openDoc = null; openPage = 0; }} />
{:else}
  <div class="library">
    <header>
      <nav class="crumbs">
        <button class="link" onclick={() => (folderId = null)}>ห้องสมุด</button>
        {#each crumbs as c (c.id)}<span>›</span><button class="link" onclick={() => (folderId = c.id)}>{c.name}</button>{/each}
      </nav>
      <input class="search" type="search" placeholder="ค้นหาชื่อเอกสาร" aria-label="ค้นหาชื่อเอกสาร" bind:value={query} />
      <ImportButton busy={!!importing} onFiles={importFiles} />
      <button onclick={() => (capturing = true)}>＋ บันทึกหน้าเว็บ</button>
      <button onclick={() => { dialog = 'folder'; newTitle = ''; }}>＋ โฟลเดอร์</button>
      <button class="primary" onclick={() => { dialog = 'notebook'; newTitle = 'สมุดใหม่'; }}>＋ สมุดใหม่</button>
      <button onclick={() => pnoteInput?.click()}>นำเข้าไฟล์ .pnote</button>
      <button onclick={() => (backup = { doc: null })}>สำรองโปรไฟล์ทั้งหมด</button>
      <button onclick={onLock}>🔒 ล็อก</button>
    </header>

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if importing}<p role="status">{importing}</p>{/if}
    {#if query.trim()}
      <SearchResults titleMatches={found.titleMatches} hits={found.hits} docs={allDocs} busy={searching} onOpen={(id, i) => { openPage = i; openDoc = id; }} />
    {/if}

    <section class="grid" class:drag={dragOver} aria-label="เอกสาร"
      ondragover={(e) => { e.preventDefault(); dragOver = true; }} ondragleave={() => (dragOver = false)}
      ondrop={(e) => { e.preventDefault(); dragOver = false; const fs = [...(e.dataTransfer?.files ?? [])]; if (fs.length) void importFiles(fs); }}>
      {#each childFolders as f (f.id)}
        <div class="card folder">
          <button class="open" onclick={() => (folderId = f.id)}>📁 {f.name}</button>
          <button class="small" aria-label="ลบโฟลเดอร์ {f.name}" onclick={() => removeFolder(f)}>✕</button>
        </div>
      {/each}
      {#each docs as d (d.id)}
        <div class="card doc">
          <button class="open" onclick={() => (openDoc = d.id)} aria-label="เปิด {d.title}">
            <Thumbnail {lib} meta={d} />
            <span class="title">{d.title}</span>
          </button>
          <div class="actions">
            <button class="small" onclick={() => rename(d)}>เปลี่ยนชื่อ</button>
            <button class="small" aria-label="ส่งออก {d.title} เป็น .pnote" onclick={() => (backup = { doc: d })}>ส่งออกเป็น .pnote</button>
            <select aria-label="ย้ายไปโฟลเดอร์" value={d.folderId ?? ''} onchange={(e) => move(d, (e.currentTarget as HTMLSelectElement).value)}>
              <option value="">ห้องสมุด</option>
              {#each folders as f (f.id)}<option value={f.id}>{f.name}</option>{/each}
            </select>
          </div>
        </div>
      {/each}
      {#if !childFolders.length && !docs.length}<p class="empty">ยังไม่มีเอกสาร</p>{/if}
    </section>
  </div>

  {#if dialog}
    <div class="backdrop">
      <form class="screen" onsubmit={create}>
        <h2>{dialog === 'notebook' ? 'สมุดใหม่' : 'โฟลเดอร์ใหม่'}</h2>
        <label>ชื่อ <input bind:value={newTitle} /></label>
        {#if dialog === 'notebook'}
          <label>กระดาษ
            <select bind:value={newTemplate}>
              <option value="plain">เปล่า</option>
              <option value="lined">มีเส้น</option>
              <option value="grid">ตาราง</option>
            </select>
          </label>
        {/if}
        <div class="row">
          <button type="button" onclick={() => (dialog = null)}>ยกเลิก</button>
          <button class="primary" type="submit">สร้าง</button>
        </div>
      </form>
    </div>
  {/if}
{/if}

<style>
  .library { padding: 16px; max-width: 1200px; margin: 0 auto; }
  header { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin-bottom: 16px; }
  .crumbs { display: flex; gap: 4px; align-items: center; margin-right: auto; font-size: 18px; }
  .link { border: 0; background: none; padding: 4px; font-weight: 600; }
  .search { min-width: 200px; }
  .grid.drag { outline: 3px dashed var(--accent); outline-offset: 6px; }
  .grid { min-height: 200px; display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 14px; }
  .card { background: #fff; border-radius: 12px; padding: 8px; box-shadow: 0 1px 4px #0001; display: flex; flex-direction: column; gap: 6px; }
  .card.folder { flex-direction: row; align-items: center; }
  .open { border: 0; background: none; padding: 0; display: flex; flex-direction: column; gap: 6px; text-align: left; flex: 1; }
  .folder .open { flex-direction: row; padding: 10px; }
  .title { font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .actions { display: flex; gap: 4px; }
  .actions select { flex: 1; min-width: 0; padding: 4px; font-size: 13px; }
  .small { padding: 4px 8px; font-size: 13px; }
  .empty { color: #6b7380; }
  .backdrop { position: fixed; inset: 0; background: #0004; display: grid; place-items: center; z-index: 20; }
  .backdrop .screen { margin: 0; width: min(420px, 92vw); }
</style>
