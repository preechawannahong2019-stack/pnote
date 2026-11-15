<script lang="ts">
  import type { Author } from '@pnote/core/types';
  import type { EncryptedStore } from '@pnote/storage/encrypted-store';
  let { store, author, onLock }: { store: EncryptedStore; author: Author; onLock: () => void } = $props();
</script>

<main class="screen"><h1>{author.name}</h1><button onclick={onLock}>ล็อก</button></main>
