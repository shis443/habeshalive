// Zero-asset Web Audio + haptic feedback for the one true "Peak Moment"
// in the product: a successful Gursha send (see GurshaModal.tsx's
// handleSend). Not for reuse as general UI feedback — see the
// --ease-spring-bounce note in app/globals.css for why bounce/sound stay
// scoped to this single moment instead of spreading into navigation.

let audioCtx: AudioContext | null = null;

function getAudioContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  if (!audioCtx) audioCtx = new Ctor();
  return audioCtx;
}

function playTone(ctx: AudioContext, freq: number, startTime: number, duration: number) {
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  gain.gain.setValueAtTime(0, startTime);
  gain.gain.linearRampToValueAtTime(0.18, startTime + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
  osc.connect(gain);
  gain.connect(ctx.destination);
  osc.start(startTime);
  osc.stop(startTime + duration);
}

// Ascending two-tone chime (D5 -> A5, a perfect fifth) — soft sine tones
// with a quick attack and exponential decay so it reads as a gentle bell
// pop rather than a harsh beep. Errors here (blocked AudioContext,
// browsers requiring a fresh user gesture, etc.) must never surface —
// this runs after the gift already succeeded, so a failure to chime is
// not a failure to report.
export function playGurshaSuccessSound(): void {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;
    if (ctx.state === "suspended") void ctx.resume();
    const now = ctx.currentTime;
    playTone(ctx, 587.33, now, 0.35); // D5
    playTone(ctx, 880, now + 0.09, 0.4); // A5
  } catch {
    // Silent by design — see function comment.
  }
}

// Satisfying double-tap. Feature-detected so it's a silent no-op on
// platforms without vibration support (notably iOS Safari).
export function triggerGurshaHaptic(): void {
  try {
    if (typeof navigator === "undefined" || !("vibrate" in navigator)) return;
    navigator.vibrate([15, 30, 15]);
  } catch {
    // Silent by design — see function comment.
  }
}
