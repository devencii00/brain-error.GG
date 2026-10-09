/* ==========================================================
   BrainError — sound engine
   Uses Web Audio API — no audio files needed.
   Every sound is generated on the fly.
   ========================================================== */
const Sound = (() => {
  let ctx = null;
  let masterGain = null;
  let lastVolume = 0.15;   // remembers last non-zero volume (for unmute)
  let volume = 0.15;       // current volume 0.0–1.0
  let muted = false;       // user has explicitly muted

  // Load preferences from localStorage
  try {
    const savedVol = localStorage.getItem('be_volume');
    if (savedVol !== null) {
      const v = parseFloat(savedVol);
      if (!isNaN(v) && v >= 0 && v <= 1) {
        volume = v;
        if (v > 0) lastVolume = v;
      }
    }
    const savedMuted = localStorage.getItem('be_muted');
    if (savedMuted !== null) muted = savedMuted === 'true';
  } catch {}

  function initCtx() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : volume;
      masterGain.connect(ctx.destination);
    } catch (e) {
      console.warn('Web Audio not supported:', e);
    }
  }

  // Some browsers block AudioContext until a user gesture.
  function unlock() {
    initCtx();
    if (ctx && ctx.state === 'suspended') ctx.resume();
  }

  function tone(freq, start, duration, type = 'sine', vol = 1) {
    if (!ctx || !masterGain) return;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime + start);
    // ADSR-ish envelope: quick attack, smooth decay
    gain.gain.setValueAtTime(0, ctx.currentTime + start);
    gain.gain.linearRampToValueAtTime(0.4 * vol, ctx.currentTime + start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + start + duration);
    osc.connect(gain);
    gain.connect(masterGain);
    osc.start(ctx.currentTime + start);
    osc.stop(ctx.currentTime + start + duration + 0.02);
  }

  function play(kind) {
    if (muted || volume <= 0) return;
    unlock();
    if (!ctx) return;
    switch (kind) {
      case 'click':
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

  function applyVolume() {
    if (masterGain) masterGain.gain.value = muted ? 0 : volume;
  }

  return {
    play,
    unlock,

    /** Is sound effectively producing output right now? */
    isEnabled: () => !muted && volume > 0,

    /** Is the user explicitly muted? (used by UI) */
    isMuted: () => muted,

    /** Set muted state directly. Unmuting restores lastVolume. */
    setEnabled(v) {
      const on = !!v;
      if (on) {
        muted = false;
        if (volume <= 0) volume = lastVolume > 0 ? lastVolume : 0.15;
      } else {
        muted = true;
      }
      try {
        localStorage.setItem('be_muted', String(muted));
        localStorage.setItem('be_volume', String(volume));
      } catch {}
      applyVolume();
    },

    /** Toggle mute on/off. Returns the new enabled state. */
    toggle() {
      if (muted || volume <= 0) {
        // currently muted → unmute
        muted = false;
        if (volume <= 0) volume = lastVolume > 0 ? lastVolume : 0.15;
      } else {
        // currently on → mute
        muted = true;
      }
      try {
        localStorage.setItem('be_muted', String(muted));
        localStorage.setItem('be_volume', String(volume));
      } catch {}
      applyVolume();
      if (!muted) play('click');
      return !muted;
    },

    /** Current displayed volume (0..1). Returns 0 if muted. */
    getVolume: () => (muted ? 0 : volume),

    /** Set volume. 0 mutes; >0 unmutes. */
    setVolume(v) {
      const newVol = Math.max(0, Math.min(1, Number(v) || 0));
      if (newVol > 0) {
        volume = newVol;
        lastVolume = newVol;
        muted = false;
      } else {
        // slider at 0 → mute (keep lastVolume for restore)
        muted = true;
      }
      try {
        localStorage.setItem('be_volume', String(volume));
        localStorage.setItem('be_muted', String(muted));
      } catch {}
      applyVolume();
    },
  };
})();