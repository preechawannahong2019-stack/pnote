<script lang="ts">
  import { MIN_WEB_SECRET_LENGTH, WeakSecretError, type ProfileService, type ProfileSummary } from '@pnote/storage/profiles';
  import PinPad from '../components/PinPad.svelte';
  type Created = { profile: ProfileSummary; recoveryCode: string };
  let { service, pin = false, onDone, onCancel, title = 'สร้างโปรไฟล์ใหม่', busyText = '', create }: {
    service: ProfileService; pin?: boolean; onDone: (p: ProfileSummary) => void; onCancel: () => void;
    title?: string; busyText?: string; create?: (name: string, secret: string, color: string) => Promise<Created>;
  } = $props();
  const make = (n: string, s: string, c: string) => (create ? create(n, s, c) : service.create(n, s, c));
  let step = $state<'details' | 'pin1' | 'pin2'>('details');
  let firstPin = '';
  let pinReset = $state(0);

  const COLORS = ['#3b6ea5', '#2e8b57', '#b5651d', '#8e44ad', '#c0392b', '#16a085'];
  let name = $state('');
  let secret = $state('');
  let confirm = $state('');
  let color = $state(COLORS[0]);
  let error = $state('');
  let busy = $state(false);
  let created = $state<{ profile: ProfileSummary; recoveryCode: string } | null>(null);
  let saved = $state(false);

  async function createWith(value: string) {
    busy = true;
    try {
      created = await make(name.trim(), value, color);
    } catch {
      error = 'สร้างโปรไฟล์ไม่สำเร็จ';
    } finally {
      busy = false;
    }
  }

  function next(e: Event) {
    e.preventDefault();
    error = '';
    if (!name.trim()) { error = 'กรุณาใส่ชื่อ'; return; }
    step = 'pin1';
  }

  function onPin(value: string) {
    if (step === 'pin1') { firstPin = value; step = 'pin2'; error = ''; pinReset++; return; }
    if (value !== firstPin) { error = 'PIN ไม่ตรงกัน'; firstPin = ''; step = 'pin1'; pinReset++; return; }
    void createWith(value);
  }

  async function submit(e: Event) {
    e.preventDefault();
    error = '';
    if (!name.trim()) { error = 'กรุณาใส่ชื่อ'; return; }
    if (secret.length < MIN_WEB_SECRET_LENGTH) { error = `รหัสผ่านต้องมีอย่างน้อย ${MIN_WEB_SECRET_LENGTH} ตัวอักษร`; return; }
    if (secret !== confirm) { error = 'รหัสผ่านไม่ตรงกัน'; return; }
    busy = true;
    try {
      created = await make(name.trim(), secret, color);
      secret = confirm = '';
    } catch (err) {
      error = err instanceof WeakSecretError ? `รหัสผ่านต้องมีอย่างน้อย ${MIN_WEB_SECRET_LENGTH} ตัวอักษร` : 'สร้างโปรไฟล์ไม่สำเร็จ';
    } finally {
      busy = false;
    }
  }
</script>

<main class="screen">
  {#if !created && pin && step !== 'details'}
    <h1>{title}</h1>
    <PinPad length={6} label={step === 'pin1' ? 'ตั้ง PIN 6 หลัก' : 'ยืนยัน PIN'} disabled={busy} resetKey={pinReset} onComplete={onPin} />
    {#if error}<p class="error" role="alert">{error}</p>{/if}
    {#if busy && busyText}<p role="status">{busyText}</p>{/if}
    <div class="row"><button type="button" onclick={() => { step = 'details'; error = ''; }}>กลับ</button></div>
  {:else if !created}
    <h1>{title}</h1>
    <form onsubmit={pin ? next : submit}>
      <label>ชื่อ <input bind:value={name} autocomplete="off" /></label>
      {#if !pin}
        <label>รหัสผ่าน <input type="password" bind:value={secret} autocomplete="new-password" /></label>
        <label>ยืนยันรหัสผ่าน <input type="password" bind:value={confirm} autocomplete="new-password" /></label>
      {/if}
      <fieldset class="colors">
        <legend>สี</legend>
        {#each COLORS as c}
          <button type="button" class="swatch" class:selected={c === color} style:background={c} aria-label={c} onclick={() => (color = c)}></button>
        {/each}
      </fieldset>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      {#if busy && busyText}<p role="status">{busyText}</p>{/if}
      <div class="row">
        <button type="button" onclick={onCancel}>ยกเลิก</button>
        <button class="primary" type="submit" disabled={busy}>{pin ? 'ถัดไป' : 'สร้างโปรไฟล์'}</button>
      </div>
    </form>
  {:else}
    <h1>รหัสกู้คืน</h1>
    <p class="warn">{pin ? 'ถ้าลืม PIN และรหัสกู้คืน จะไม่สามารถเปิดข้อมูลในโปรไฟล์นี้ได้อีก' : 'ถ้าลืมรหัสผ่านและรหัสกู้คืน จะไม่สามารถเปิดข้อมูลในโปรไฟล์นี้ได้อีก'}</p>
    <p class="code" data-testid="recovery-code">{created.recoveryCode}</p>
    <label class="check"><input type="checkbox" bind:checked={saved} /> ฉันจดรหัสกู้คืนเก็บไว้แล้ว</label>
    <button class="primary" disabled={!saved} onclick={() => created && onDone(created.profile)}>ดำเนินการต่อ</button>
  {/if}
</main>
