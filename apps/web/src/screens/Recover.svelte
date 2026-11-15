<script lang="ts">
  import { MIN_WEB_SECRET_LENGTH, type ProfileService, type ProfileSummary, type UnlockResult } from '@pnote/storage/profiles';
  type Ok = Extract<UnlockResult, { ok: true }>;
  let { service, profile, onUnlocked, onBack }: { service: ProfileService; profile: ProfileSummary; onUnlocked: (r: Ok) => void; onBack: () => void } = $props();
  let code = $state('');
  let secret = $state('');
  let confirm = $state('');
  let error = $state('');

  async function submit(e: Event) {
    e.preventDefault();
    error = '';
    if (secret.length < MIN_WEB_SECRET_LENGTH) { error = `รหัสผ่านต้องมีอย่างน้อย ${MIN_WEB_SECRET_LENGTH} ตัวอักษร`; return; }
    if (secret !== confirm) { error = 'รหัสผ่านไม่ตรงกัน'; return; }
    const r = await service.recover(profile.id, code, secret);
    if (r.ok) onUnlocked(r);
    else error = 'รหัสกู้คืนไม่ถูกต้อง';
  }
</script>

<main class="screen">
  <h1>กู้คืนโปรไฟล์ {profile.name}</h1>
  <form onsubmit={submit}>
    <label>รหัสกู้คืน <input bind:value={code} autocomplete="off" /></label>
    <label>รหัสผ่านใหม่ <input type="password" bind:value={secret} autocomplete="new-password" /></label>
    <label>ยืนยันรหัสผ่านใหม่ <input type="password" bind:value={confirm} autocomplete="new-password" /></label>
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="row">
      <button type="button" onclick={onBack}>กลับ</button>
      <button class="primary" type="submit">ตั้งรหัสผ่านใหม่</button>
    </div>
  </form>
</main>
