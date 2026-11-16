<script lang="ts">
  import { MIN_WEB_SECRET_LENGTH, WeakSecretError, type ProfileService, type ProfileSummary } from '@pnote/storage/profiles';
  let { service, onDone, onCancel }: { service: ProfileService; onDone: (p: ProfileSummary) => void; onCancel: () => void } = $props();

  const COLORS = ['#3b6ea5', '#2e8b57', '#b5651d', '#8e44ad', '#c0392b', '#16a085'];
  let name = $state('');
  let secret = $state('');
  let confirm = $state('');
  let color = $state(COLORS[0]);
  let error = $state('');
  let busy = $state(false);
  let created = $state<{ profile: ProfileSummary; recoveryCode: string } | null>(null);
  let saved = $state(false);

  async function submit(e: Event) {
    e.preventDefault();
    error = '';
    if (!name.trim()) { error = 'กรุณาใส่ชื่อ'; return; }
    if (secret.length < MIN_WEB_SECRET_LENGTH) { error = `รหัสผ่านต้องมีอย่างน้อย ${MIN_WEB_SECRET_LENGTH} ตัวอักษร`; return; }
    if (secret !== confirm) { error = 'รหัสผ่านไม่ตรงกัน'; return; }
    busy = true;
    try {
      created = await service.create(name.trim(), secret, color);
      secret = confirm = '';
    } catch (err) {
      error = err instanceof WeakSecretError ? `รหัสผ่านต้องมีอย่างน้อย ${MIN_WEB_SECRET_LENGTH} ตัวอักษร` : 'สร้างโปรไฟล์ไม่สำเร็จ';
    } finally {
      busy = false;
    }
  }
</script>

<main class="screen">
  {#if !created}
    <h1>สร้างโปรไฟล์ใหม่</h1>
    <form onsubmit={submit}>
      <label>ชื่อ <input bind:value={name} autocomplete="off" /></label>
      <label>รหัสผ่าน <input type="password" bind:value={secret} autocomplete="new-password" /></label>
      <label>ยืนยันรหัสผ่าน <input type="password" bind:value={confirm} autocomplete="new-password" /></label>
      <fieldset class="colors">
        <legend>สี</legend>
        {#each COLORS as c}
          <button type="button" class="swatch" class:selected={c === color} style:background={c} aria-label={c} onclick={() => (color = c)}></button>
        {/each}
      </fieldset>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="row">
        <button type="button" onclick={onCancel}>ยกเลิก</button>
        <button class="primary" type="submit" disabled={busy}>สร้างโปรไฟล์</button>
      </div>
    </form>
  {:else}
    <h1>รหัสกู้คืน</h1>
    <p class="warn">ถ้าลืมรหัสผ่านและรหัสกู้คืน จะไม่สามารถเปิดข้อมูลในโปรไฟล์นี้ได้อีก</p>
    <p class="code" data-testid="recovery-code">{created.recoveryCode}</p>
    <label class="check"><input type="checkbox" bind:checked={saved} /> ฉันจดรหัสกู้คืนเก็บไว้แล้ว</label>
    <button class="primary" disabled={!saved} onclick={() => created && onDone(created.profile)}>ดำเนินการต่อ</button>
  {/if}
</main>
