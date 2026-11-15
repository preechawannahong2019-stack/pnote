<script lang="ts">
  import type { StorageAdapter } from '@pnote/storage/adapter';
  import type { DeviceKeyProvider } from '@pnote/storage/device-key';
  import { ProfileService, type ProfileSummary, type UnlockResult } from '@pnote/storage/profiles';
  import SecurityBanner from './components/SecurityBanner.svelte';
  import ProfilePicker from './screens/ProfilePicker.svelte';
  import CreateProfile from './screens/CreateProfile.svelte';
  import Unlock from './screens/Unlock.svelte';
  import Recover from './screens/Recover.svelte';
  import RestoreProfile from './screens/RestoreProfile.svelte';
  import Library from './screens/Library.svelte';
  import { createIdleLock, DEFAULT_IDLE_MS } from './lib/idle-lock';
  import { bindIdleLock, getLifecycle } from './platform/lifecycle';

  type Ok = Extract<UnlockResult, { ok: true }>;
  let { adapter, device, idleMs = DEFAULT_IDLE_MS, onFirstUnlock }: {
    adapter: StorageAdapter; device: DeviceKeyProvider; idleMs?: number; onFirstUnlock?: () => void;
  } = $props();

  const service = new ProfileService(adapter, device);
  let view = $state<'picker' | 'create' | 'restore' | 'unlock' | 'recover' | 'library'>('picker');
  let selected = $state<ProfileSummary | null>(null);
  let session = $state<Ok | null>(null);
  let pickerKey = $state(0);

  function lock() {
    session = null; // drop key and store references
    view = selected ? 'unlock' : 'picker';
  }

  function unlocked(r: Ok) {
    session = r;
    selected = r.profile;
    view = 'library';
    onFirstUnlock?.();
  }

  $effect(() => {
    if (view !== 'library') return;
    const l = createIdleLock(idleMs, lock);
    const off = bindIdleLock(getLifecycle(), l);
    return () => { off(); l.dispose(); };
  });
</script>

<SecurityBanner {device} />
{#if view === 'picker'}
  {#key pickerKey}
    <ProfilePicker {service} onPick={(p) => { selected = p; view = 'unlock'; }} onCreate={() => (view = 'create')} onRestore={() => (view = 'restore')} />
  {/key}
{:else if view === 'create'}
  <CreateProfile {service} pin={device.available} onDone={(p) => { selected = p; view = 'unlock'; }} onCancel={() => { pickerKey++; view = 'picker'; }} />
{:else if view === 'restore'}
  <RestoreProfile {service} pin={device.available} onDone={(p) => { selected = p; view = 'unlock'; }} onCancel={() => { pickerKey++; view = 'picker'; }} />
{:else if view === 'unlock' && selected}
  <Unlock {service} profile={selected} pin={device.available} onUnlocked={unlocked} onRecover={() => (view = 'recover')} onBack={() => { pickerKey++; view = 'picker'; }} />
{:else if view === 'recover' && selected}
  <Recover {service} profile={selected} pin={device.available} onUnlocked={unlocked} onBack={() => (view = 'unlock')} />
{:else if view === 'library' && session}
  <Library store={session.store} author={{ profileId: session.profile.id, name: session.profile.name }} onLock={lock} />
{/if}
