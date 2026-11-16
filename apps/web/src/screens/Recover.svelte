<script lang="ts">
  import { MIN_WEB_SECRET_LENGTH, type ProfileService, type ProfileSummary, type UnlockResult } from '@pnote/storage/profiles';
  import PinPad from '../components/PinPad.svelte';
  type Ok = Extract<UnlockResult, { ok: true }>;
  let { service, profile, pin = false, onUnlocked, onBack }: {
    service: ProfileService; profile: ProfileSummary; pin?: boolean; onUnlocked: (r: Ok) => void; onBack: () => void;
  } = $props();
  let code = $state('');
  let secret = $state('');
  let confirm = $state('');
  let error = $state('');
  let busy = $state(false);
  let step = $state<'code' | 'pin1' | 'pin2'>('code');
  let firstPin = '';
  let pinReset = $state(0);

  async function recoverWith(value: string) {
    busy = true;
    try {
      const r = await service.recover(profile.id, code, value);
      if (r.ok) onUnlocked(r);
      else { error = 'รหัสกู้คืนไม่ถูกต้อง'; step = 'code'; }
    } catch (e) {
      error = `กู้คืนไม่สำเร็จ: ${(e as Error)?.message ?? e}`;
      step = 'code';
    } finally {
      busy = false;
    }
  }

  function submit(e: Event) {
    e.preventDefault();
    error = '';
    if (!code.trim()) { error = 'กรุณาใส่รหัสกู้คืน'; return; }
    if (pin) { step = 'pin1'; return; }
    if (secret.length < MIN_WEB_SECRET_LENGTH) { error = `รหัสผ่านต้องมีอย่างน้อย ${MIN_WEB_SECRET_LENGTH} ตัวอักษร`; return; }
    if (secret !== confirm) { error = 'รหัสผ่านไม่ตรงกัน'; return; }
    void recoverWith(secret);
  }

  function onPin(value: string) {
    if (step === 'pin1') { firstPin = value; step = 'pin2'; error = ''; pinReset++; return; }
    if (value !== firstPin) { error = 'PIN ไม่ตรงกัน'; firstPin = ''; step = 'pin1'; pinReset++; return; }
    void recoverWith(value);
  }
</script>

<main class="screen">
  <h1>กู้คืนโปรไฟล์ {profile.name}</h1>
  {#if pin && step !== 'code'}
    <PinPad length={6} label={step === 'pin1' ? 'ตั้ง PIN ใหม่ 6 หลัก' : 'ยืนยัน PIN ใหม่'} disabled={busy} resetKey={pinReset} onComplete={onPin} />
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    <div class="row"><button type="button" onclick={() => (step = 'code')}>กลับ</button></div>
  {:else}
    <form onsubmit={submit}>
      <label>รหัสกู้คืน <input bind:value={code} autocomplete="off" /></label>
      {#if !pin}
        <label>รหัสผ่านใหม่ <input type="password" bind:value={secret} autocomplete="new-password" /></label>
        <label>ยืนยันรหัสผ่านใหม่ <input type="password" bind:value={confirm} autocomplete="new-password" /></label>
      {/if}
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="row">
        <button type="button" onclick={onBack}>กลับ</button>
        <button class="primary" type="submit" disabled={busy}>{pin ? 'ถัดไป' : 'ตั้งรหัสผ่านใหม่'}</button>
      </div>
    </form>
  {/if}
</main>
