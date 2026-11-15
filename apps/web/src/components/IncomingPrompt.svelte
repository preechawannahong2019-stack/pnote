<script lang="ts">
  import type { IncomingFiles } from '../platform/incoming';
  let { incoming, profileName, onImport }: { incoming: IncomingFiles; profileName: string; onImport: (f: File) => Promise<void> } = $props();
  let pending = $state(incoming.pending);
  let busy = $state(false);
  $effect(() => incoming.onChange(() => (pending = incoming.pending)));
  const current = $derived(pending[0]);

  async function accept() {
    if (!current) return;
    busy = true;
    try {
      const f = current;
      const blob = await incoming.take(f);
      await onImport(new File([blob], f.name, { type: f.mime || blob.type }));
    } finally {
      busy = false;
    }
  }
</script>

{#if current}
  <div class="backdrop">
    <div class="screen" role="dialog" aria-label="ไฟล์จากแอปอื่น">
      <p>นำเข้า "{current.name}" ไปที่โปรไฟล์ {profileName}?</p>
      <div class="row">
        <button disabled={busy} onclick={() => incoming.discard(current)}>ไม่นำเข้า</button>
        <button class="primary" disabled={busy} onclick={accept}>นำเข้า</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .backdrop { position: fixed; inset: 0; background: #0004; display: grid; place-items: center; z-index: 45; }
  .screen { margin: 0; width: min(420px, 92vw); }
</style>
