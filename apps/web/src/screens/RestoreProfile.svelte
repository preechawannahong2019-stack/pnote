<script lang="ts">
  import { BackupReader } from '@pnote/storage/backup';
  import type { ProfileService, ProfileSummary } from '@pnote/storage/profiles';
  import CreateProfile from './CreateProfile.svelte';
  import { backupErrorText, fileSource, restoreProfile } from '../lib/backup-flow';
  let { service, pin = false, onDone, onCancel }: { service: ProfileService; pin?: boolean; onDone: (p: ProfileSummary) => void; onCancel: () => void } = $props();
  let file = $state<File | null>(null);
  let password = $state('');
  let checked = $state(false);
  let error = $state('');
  let busy = $state(false);

  async function check(e: Event) {
    e.preventDefault();
    error = '';
    if (!file) { error = 'กรุณาเลือกไฟล์สำรอง (.pnote)'; return; }
    busy = true;
    try {
      await BackupReader.open(fileSource(file), password);
      checked = true;
    } catch (err) {
      error = backupErrorText(err);
    } finally {
      busy = false;
    }
  }

  async function create(name: string, secret: string, color: string) {
    try {
      return await restoreProfile(service, file!, password, name, secret, color);
    } catch (err) {
      error = backupErrorText(err);
      throw err;
    }
  }
</script>

{#if !checked}
  <main class="screen">
    <h1>กู้คืนโปรไฟล์จากไฟล์สำรอง</h1>
    <form onsubmit={check}>
      <label>ไฟล์สำรอง (.pnote)
        <input type="file" accept=".pnote,application/x-pnote-backup,application/octet-stream"
          onchange={(e) => (file = (e.currentTarget as HTMLInputElement).files?.[0] ?? null)} />
      </label>
      <label>รหัสผ่านไฟล์สำรอง <input type="password" bind:value={password} autocomplete="off" /></label>
      {#if error}<p class="error" role="alert">{error}</p>{/if}
      <div class="row">
        <button type="button" onclick={onCancel}>ยกเลิก</button>
        <button class="primary" type="submit" disabled={busy}>ถัดไป</button>
      </div>
    </form>
  </main>
{:else}
  <CreateProfile {service} {pin} {onDone} {onCancel} {create} title="ตั้งโปรไฟล์ใหม่สำหรับข้อมูลที่กู้คืน" busyText="กำลังกู้คืนเอกสาร…" />
  {#if error}<p class="error" role="alert">{error}</p>{/if}
{/if}
