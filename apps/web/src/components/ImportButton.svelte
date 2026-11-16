<script lang="ts">
  let { onFiles, busy }: { onFiles: (files: File[]) => void; busy: boolean } = $props();
  let input = $state<HTMLInputElement>();
</script>

<button onclick={() => input?.click()} disabled={busy}>⤓ นำเข้าไฟล์</button>
<input bind:this={input} type="file" hidden multiple accept="application/pdf,.pdf,image/jpeg,image/png,image/webp,image/heic,.heic"
  onchange={(e) => { const fs = [...((e.currentTarget as HTMLInputElement).files ?? [])]; (e.currentTarget as HTMLInputElement).value = ''; if (fs.length) onFiles(fs); }} />
