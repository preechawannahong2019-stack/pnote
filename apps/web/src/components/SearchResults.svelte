<script lang="ts">
  import type { DocumentMeta, Id } from '@pnote/core/types';
  import type { SearchHit } from '@pnote/pdf/search';
  let { titleMatches, hits, docs, busy, onOpen }: {
    titleMatches: DocumentMeta[]; hits: SearchHit[]; docs: Map<Id, DocumentMeta>; busy: boolean;
    onOpen: (docId: Id, pageIndex: number) => void;
  } = $props();
  const grouped = $derived.by(() => {
    const m = new Map<Id, SearchHit[]>();
    for (const h of hits) m.set(h.docId, [...(m.get(h.docId) ?? []), h]);
    return [...m.entries()];
  });
</script>

<section class="results" aria-label="ผลการค้นหา">
  {#if busy}<p class="muted" role="status">กำลังค้นหา…</p>{/if}
  {#if titleMatches.length}
    <h3>ชื่อเอกสาร</h3>
    <ul>{#each titleMatches as d (d.id)}<li><button onclick={() => onOpen(d.id, 0)}>{d.title}</button></li>{/each}</ul>
  {/if}
  {#if grouped.length}
    <h3>ข้อความในหน้า</h3>
    {#each grouped as [docId, list] (docId)}
      <div class="doc">
        <strong>{docs.get(docId)?.title ?? 'เอกสาร'}</strong>
        <ul>
          {#each list as h (h.pageId)}
            <li><button onclick={() => onOpen(docId, h.pageIndex)}>หน้า {h.pageIndex + 1}: <span class="snip">…{h.snippet}…</span></button></li>
          {/each}
        </ul>
      </div>
    {/each}
  {/if}
  {#if !busy && !titleMatches.length && !grouped.length}<p class="muted">ไม่พบ</p>{/if}
</section>

<style>
  .results { background: #fff; border-radius: 12px; padding: 12px 16px; margin-bottom: 16px; box-shadow: 0 1px 4px #0001; }
  h3 { margin: 6px 0; font-size: 14px; color: #4a5260; }
  ul { list-style: none; padding: 0; margin: 0 0 8px; display: flex; flex-direction: column; gap: 4px; }
  li button { border: 0; background: none; padding: 4px 0; text-align: left; width: 100%; }
  li button:hover { color: var(--accent); }
  .snip { color: #4a5260; }
  .doc { margin-bottom: 8px; }
  .muted { color: #6b7380; margin: 4px 0; }
</style>
