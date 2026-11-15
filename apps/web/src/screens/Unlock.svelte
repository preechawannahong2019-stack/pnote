<script lang="ts">
  import type { ProfileService, ProfileSummary, UnlockResult } from '@pnote/storage/profiles';
  type Ok = Extract<UnlockResult, { ok: true }>;
  let { service, profile, onUnlocked, onRecover, onBack }: {
    service: ProfileService; profile: ProfileSummary; onUnlocked: (r: Ok) => void; onRecover: () => void; onBack: () => void;
  } = $props();

  let secret = $state('');
  let message = $state('');
  let locked = $state(profile.locked);
  let busy = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    busy = true;
    message = '';
    try {
      const r = await service.unlock(profile.id, secret);
      secret = '';
      if (r.ok) { onUnlocked(r); return; }
      if (r.reason === 'wrong') message = `รหัสผ่านไม่ถูกต้อง เหลือ ${r.attemptsLeft} ครั้ง`;
      else if (r.reason === 'delayed') message = `ใส่รหัสผิดหลายครั้ง ลองใหม่ได้ใน ${Math.ceil(r.retryAfterMs / 1000)} วินาที`;
      else locked = true;
    } finally {
      busy = false;
    }
  }
</script>

<main class="screen">
  <h1>{profile.name}</h1>
  {#if locked}
    <p class="error" role="alert">โปรไฟล์ถูกล็อก ใช้รหัสกู้คืนเพื่อปลดล็อก</p>
  {:else}
    <form onsubmit={submit}>
      <label>รหัสผ่าน <input type="password" bind:value={secret} autocomplete="current-password" /></label>
      {#if message}<p class="error" role="alert">{message}</p>{/if}
      <button class="primary" type="submit" disabled={busy}>ปลดล็อก</button>
    </form>
  {/if}
  <div class="row">
    <button onclick={onBack}>กลับ</button>
    <button onclick={onRecover}>ใช้รหัสกู้คืน</button>
  </div>
</main>
