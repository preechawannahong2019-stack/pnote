<script lang="ts">
  let { length = 6, label, onComplete, disabled = false, resetKey = 0 }: {
    length?: number; label: string; onComplete: (pin: string) => void; disabled?: boolean; resetKey?: number;
  } = $props();
  let digits = $state('');
  $effect(() => { void resetKey; digits = ''; });

  function press(d: string) {
    if (disabled || digits.length >= length) return;
    digits += d;
    if (digits.length === length) {
      const pin = digits;
      digits = '';
      onComplete(pin);
    }
  }
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9'];
</script>

<div class="pin">
  <p class="label">{label}</p>
  <div class="dots" data-testid="pin-dots" aria-label="{digits.length} จาก {length} หลัก">
    {#each Array(length) as _, i}<span class="dot" class:filled={i < digits.length}></span>{/each}
  </div>
  <div class="pad">
    {#each keys as k}<button type="button" {disabled} onclick={() => press(k)}>{k}</button>{/each}
    <span></span>
    <button type="button" {disabled} onclick={() => press('0')}>0</button>
    <button type="button" {disabled} aria-label="ลบ" onclick={() => (digits = digits.slice(0, -1))}>⌫</button>
  </div>
</div>

<style>
  .pin { display: flex; flex-direction: column; align-items: center; gap: 14px; }
  .label { margin: 0; font-weight: 600; }
  .dots { display: flex; gap: 12px; }
  .dot { width: 14px; height: 14px; border-radius: 50%; border: 2px solid #3b6ea5; }
  .dot.filled { background: #3b6ea5; }
  .pad { display: grid; grid-template-columns: repeat(3, 72px); gap: 12px; }
  .pad button { height: 60px; font-size: 24px; border-radius: 14px; }
</style>
