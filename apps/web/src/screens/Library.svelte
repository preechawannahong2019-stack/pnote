<script lang="ts">
  import type { Author, DocumentMeta, Folder, Id, PageTemplate } from '@pnote/core/types';
  import type { EncryptedStore } from '@pnote/storage/encrypted-store';
  import { FolderNotEmptyError, Library } from '@pnote/storage/library';
  import { BlobStore } from '@pnote/storage/blob-store';
  import Editor from './Editor.svelte';
  import Thumbnail from '../components/Thumbnail.svelte';
  import SearchResults from '../components/SearchResults.svelte';
  import { searchLibrary, type SearchHit } from '@pnote/pdf/search';

  let { store, author, onLock }: { store: EncryptedStore; author: Author; onLock: () => void } = $props();
  const lib = new Library(store, author);
  const blobs = new BlobStore(store);
  lib.cleanupOrphans().catch(() => {});

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
      <button onclick={() => { dialog = 'folder'; newTitle = ''; }}>＋ โฟลเดอร์</button>
      <button class="primary" onclick={() => { dialog = 'notebook'; newTitle = 'สมุดใหม่'; }}>＋ สมุดใหม่</button>
      <button onclick={onLock}>🔒 ล็อก</button>
    </header>

    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if query.trim()}
      <SearchResults titleMatches={found.titleMatches} hits={found.hits} docs={allDocs} busy={searching} onOpen={(id, i) => { openPage = i; openDoc = id; }} />
    {/if}

    <section class="grid">
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
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(170px, 1fr)); gap: 14px; }
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
