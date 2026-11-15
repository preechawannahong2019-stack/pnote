<script lang="ts">
  import type { DeviceKeyProvider } from '@pnote/storage/device-key';
  let { device }: { device: DeviceKeyProvider } = $props();
</script>

{#if !device.available}
  <div class="banner" role="note">เวอร์ชันเว็บ ความปลอดภัยต่ำกว่าแอปติดตั้ง</div>
{/if}

<style>
  .banner { background: #fff4d6; color: #6b4e00; padding: 6px 12px; font-size: 13px; text-align: center; border-bottom: 1px solid #f0dca0; }
</style>
