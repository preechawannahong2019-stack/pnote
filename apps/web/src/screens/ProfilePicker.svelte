<script lang="ts">
  import type { ProfileService, ProfileSummary } from '@pnote/storage/profiles';
  let { service, onPick, onCreate }: { service: ProfileService; onPick: (p: ProfileSummary) => void; onCreate: () => void } = $props();
  let profiles = $state<ProfileSummary[]>([]);
  $effect(() => { service.list().then((p) => (profiles = p)); });
</script>

<main class="screen">
  <h1>เลือกโปรไฟล์</h1>
  <ul class="profiles">
    {#each profiles as p (p.id)}
      <li>
        <button class="profile" onclick={() => onPick(p)}>
          <span class="avatar" style:background={p.avatarColor}>{p.name.slice(0, 1)}</span>
          <span>{p.name}</span>
          {#if p.locked}<span class="tag">ล็อก</span>{/if}
        </button>
      </li>
    {/each}
  </ul>
  <button class="primary" onclick={onCreate}>สร้างโปรไฟล์ใหม่</button>
</main>
