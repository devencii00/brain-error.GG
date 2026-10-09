/* ==========================================================
   BrainError — sound engine
   Uses Web Audio API — no audio files needed.
   Every sound is generated on the fly.
   ========================================================== */
const Sound = (() => {
  let ctx = null;
  let masterGain = null;
  let enabled = true;

  // Load preference from localStorage
  try {
    const saved = localStorage.getItem('be_sound');
    if (saved !== null) enabled = saved === 'true';
  } catch {}

  function initCtx() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = 0.15; // overall volume (0.0–1.0) — keeps it soft
      masterGain.connect(ctx.destination);
    } catch (e) {
      console.warn('Web Audio not supported:', e);
    }
  }

  // Some browsers block AudioContext until a user gesture.
  // This is called on the first click so audio starts working.
  function unlock() {
    initCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function tone(freq, start, duration, type = 'sine', volume = 1) {
    if (!ctx || !masterGain) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
    // ADSR-ish envelope: quick attack, smooth decay
    gain.gain.setValueAtTime(0, ctx.currentTime + start);
    gain.gain.linearRampToValueAtTime(0.4 * volume, ctx.currentTime + start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + duration + 0.02);
  }

  function play(kind) {
    if (!enabled) return;
    unlock();
    if (!ctx) return;
    switch (kind) {
      case 'click':
        // soft high blip
        tone(880, 0, 0.06, 'triangle', 0.5);
        break;

      case 'success':
        // rising major third (C5 → E5)
        tone(523.25, 0,    0.10, 'sine', 0.7);
        tone(659.25, 0.08, 0.16, 'sine', 0.7);
        break;

      case 'error':
        // descending minor third (A4 → F4)
        tone(440.00, 0,    0.10, 'sine', 0.6);
        tone(349.23, 0.08, 0.16, 'sine', 0.6);
        break;

      case 'complete':
        // quick arpeggio: C–E–G–C
        tone(523.25, 0.00, 0.10, 'sine', 0.6);
        tone(659.25, 0.08, 0.10, 'sine', 0.6);
        tone(783.99, 0.16, 0.10, 'sine', 0.6);
        tone(1046.50, 0.24, 0.28, 'sine', 0.7);
        break;

      case 'tick':
        // high soft tick for timer warnings
        tone(1200, 0, 0.04, 'square', 0.25);
        break;

      case 'timeup':
        // three descending tones
        tone(660, 0.00, 0.10, 'sine', 0.6);
        tone(550, 0.10, 0.10, 'sine', 0.6);
        tone(440, 0.20, 0.20, 'sine', 0.7);
        break;

      case 'start':
        // whoosh-like rising tone
        tone(440, 0,    0.08, 'sine', 0.5);
        tone(660, 0.06, 0.12, 'sine', 0.6);
        break;

      default:
        tone(600, 0, 0.05, 'sine', 0.3);
    }
  }

  return {
    play,
    unlock,
    isEnabled: () => enabled,
    setEnabled(v) {
      enabled = !!v;
      try { localStorage.setItem('be_sound', String(enabled)); } catch {}
    },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem('be_sound', String(enabled)); } catch {}
      if (enabled) play('click'); // small confirmation when turning on
      return enabled;
    },
  };
})();