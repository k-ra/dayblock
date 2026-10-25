/* Paper sounds, made on the spot with Web Audio: no files to load.
   Kept short and quiet so they sit under typing, not over it. */
(function (root) {
  'use strict';
  let ctx = null, noiseBuf = null;
  function audio() {
    const Ctx = root.AudioContext || root.webkitAudioContext;
    if (!Ctx) return null;
    if (!ctx) {
      ctx = new Ctx();
      noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }
  // A gain that swells to peak in `attack` seconds and fades out by `len`.
  function envelope(c, t, peak, attack, len) {
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + len);
    g.connect(c.destination);
    return g;
  }
  // Filtered noise: paper, rustles, peeling.
  function hiss(c, t, { len, peak, type = 'bandpass', from, to, q = 1, attack = .01, offset = Math.random() * .5 }) {
    const src = c.createBufferSource();
    src.buffer = noiseBuf;
    const f = c.createBiquadFilter();
    f.type = type; f.Q.value = q;
    f.frequency.setValueAtTime(from, t);
    f.frequency.exponentialRampToValueAtTime(to, t + len);
    src.connect(f).connect(envelope(c, t, peak, attack, len));
    src.start(t, offset, len + .05);
  }
  // A pitched blip: ticks, pops, thumps.
  function tone(c, t, { len, peak, from, to = from, type = 'sine', attack = .004 }) {
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + len);
    o.connect(envelope(c, t, peak, attack, len));
    o.start(t); o.stop(t + len + .05);
  }
  const SOUNDS = {
    // a leaf turning over
    page(c, t) {
      hiss(c, t, { len: .22, peak: .09, from: 900, to: 3800, q: .8, attack: .05 });
      hiss(c, t + .12, { len: .1, peak: .05, from: 2500, to: 1200, q: 1.2 });
    },
    // a book coming off the pile and opening
    open(c, t) {
      tone(c, t, { len: .16, peak: .16, from: 120, to: 70 });
      hiss(c, t + .03, { len: .28, peak: .06, from: 600, to: 2600, q: .7, attack: .06 });
    },
    close(c, t) {
      hiss(c, t, { len: .16, peak: .05, from: 2400, to: 700, q: .7, attack: .03 });
      tone(c, t + .12, { len: .14, peak: .18, from: 95, to: 60 });
    },
    // pencil tick on a checkbox, and the softer untick
    tick(c, t) {
      tone(c, t, { len: .05, peak: .07, from: 1900, to: 1400, type: 'triangle' });
      hiss(c, t, { len: .04, peak: .05, type: 'highpass', from: 3000, to: 3000 });
      tone(c, t + .05, { len: .09, peak: .05, from: 1300, to: 1700, type: 'triangle' });
    },
    untick(c, t) {
      tone(c, t, { len: .06, peak: .05, from: 1200, to: 900, type: 'triangle' });
    },
    // something new on the page
    pop(c, t) {
      tone(c, t, { len: .1, peak: .09, from: 480, to: 900 });
      tone(c, t + .03, { len: .08, peak: .04, from: 1400, to: 1800, type: 'triangle' });
    },
    // rubbing something out
    erase(c, t) {
      for (let i = 0; i < 3; i++) hiss(c, t + i * .06, { len: .06, peak: .06, from: 1800, to: 900, q: 1.5, attack: .015 });
    },
    // a sheet sliding out or settling
    rustle(c, t) {
      hiss(c, t, { len: .18, peak: .05, from: 1500, to: 4000, q: .6, attack: .04 });
    },
    whoosh(c, t) {
      hiss(c, t, { len: .32, peak: .08, from: 3200, to: 500, q: .9, attack: .08 });
      tone(c, t + .26, { len: .1, peak: .07, from: 140, to: 90 });
    },
    // a sticker lifting off the backing: a crackly rising peel
    peel(c, t) {
      hiss(c, t, { len: .3, peak: .07, from: 1200, to: 5200, q: 2.5, attack: .03 });
      for (let i = 0; i < 9; i++) {
        const at = t + .02 + i * .028 + Math.random() * .012;
        hiss(c, at, { len: .012, peak: .05 + Math.random() * .04, type: 'highpass', from: 2500 + i * 300, to: 2500 + i * 300, attack: .002 });
      }
    },
    // pressed down onto paper
    stick(c, t) {
      tone(c, t, { len: .09, peak: .2, from: 210, to: 95 });
      hiss(c, t, { len: .07, peak: .06, type: 'lowpass', from: 1800, to: 500, attack: .004 });
      tone(c, t + .06, { len: .07, peak: .05, from: 660, to: 990, type: 'triangle' });
    },
  };
  let last = {};
  function play(name) {
    const sound = SOUNDS[name];
    if (!sound) return;
    // The same sound twice in a blink would just be louder.
    const now = performance.now();
    if (now - (last[name] || 0) < 45) return;
    last[name] = now;
    try {
      const c = audio();
      if (c) sound(c, c.currentTime + .01);
    } catch (_) { /* no sound is fine */ }
  }
  root.DayblockSounds = { play };
})(typeof window !== 'undefined' ? window : globalThis);
