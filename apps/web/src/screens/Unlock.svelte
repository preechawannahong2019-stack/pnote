<script lang="ts">
  import type { ProfileService, ProfileSummary, UnlockResult } from '@pnote/storage/profiles';
  import PinPad from '../components/PinPad.svelte';
  type Ok = Extract<UnlockResult, { ok: true }>;
  let { service, profile, pin = false, onUnlocked, onRecover, onBack }: {
    service: ProfileService; profile: ProfileSummary; pin?: boolean; onUnlocked: (r: Ok) => void; onRecover: () => void; onBack: () => void;
  } = $props();

  let secret = $state('');
  let message = $state('');
  let locked = $state(profile.locked);
  let keyMissing = $state(false);
  let busy = $state(false);
  let reset = $state(0);

  async function attempt(value: string) {
    if (!value) return;
    busy = true;
    message = '';
    try {
      const r = await service.unlock(profile.id, value);
      secret = '';
      reset++;
      if (r.ok) { onUnlocked(r); return; }
      if (r.reason === 'wrong') message = pin ? `PIN ไม่ถูกต้อง เหลือ ${r.attemptsLeft} ครั้ง` : `รหัสผ่านไม่ถูกต้อง เหลือ ${r.attemptsLeft} ครั้ง`;
      else if (r.reason === 'delayed') message = `ใส่รหัสผิดหลายครั้ง ลองใหม่ได้ใน ${Math.ceil(r.retryAfterMs / 1000)} วินาที`;
      else if (r.reason === 'device-key-missing') keyMissing = true;
      else locked = true;
    } finally {
      busy = false;
    }
  }

  function submit(e: Event) { e.preventDefault(); void attempt(secret); }
</script>

<main class="screen">
  <h1>{profile.name}</h1>
  {#if keyMissing}
    <p class="error" role="alert">ไม่พบกุญแจของเครื่องนี้ ใช้รหัสกู้คืนเพื่อเปิดโปรไฟล์</p>
  {:else if locked}
    <p class="error" role="alert">โปรไฟล์ถูกล็อก ใช้รหัสกู้คืนเพื่อปลดล็อก</p>
  {:else if pin}
    <PinPad length={6} label="ใส่ PIN 6 หลัก" disabled={busy} resetKey={reset} onComplete={attempt} />
    {#if message}<p class="error" role="alert">{message}</p>{/if}
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
