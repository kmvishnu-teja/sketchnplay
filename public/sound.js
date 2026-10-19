/* Sketch Sprint sound effects — synthesized with Web Audio, no audio files needed.
   Sfx.play(name) plays a named effect. Mute state persists in localStorage. */
const Sfx = (() => {
  let ctx = null;
  let enabled = localStorage.getItem('sketchSfx') !== 'off';

  function ac() {
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      catch (e) { return null; }
    }
    if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  // Browsers block audio until the first user gesture; unlock on first tap/key.
  window.addEventListener('pointerdown', ac, { once: true });
  window.addEventListener('keydown', ac, { once: true });

  function tone(freq, opts) {
    const o = opts || {};
    const at = o.at || 0, dur = o.dur || 0.15;
    const type = o.type || 'sine', vol = o.vol == null ? 0.16 : o.vol;
    const slide = o.slide || 0;
    const c = ac();
    if (!c || !enabled) return;
    const t0 = c.currentTime + at;
    const osc = c.createOscillator(), g = c.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t0);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(vol, t0 + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(c.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
  }
  // [freq, delaySecs, durSecs, type?, vol?]
  const seq = (notes) => notes.forEach(n => tone(n[0], { at: n[1], dur: n[2], type: n[3], vol: n[4] }));

  const sounds = {
    click:       () => tone(660, { dur: 0.06, type: 'triangle', vol: 0.10 }),
    gameStart:   () => seq([[523, 0, .12], [659, .10, .12], [784, .20, .12], [1047, .30, .28, 'triangle', .20]]),
    roundStart:  () => seq([[392, 0, .10, 'triangle'], [523, .09, .16, 'triangle']]),
    yourTurn:    () => seq([[784, 0, .12, 'triangle'], [988, .11, .12, 'triangle'], [1175, .22, .22, 'triangle', .20]]),
    correct:     () => tone(880, { dur: 0.18, vol: 0.14 }),
    correctSelf: () => seq([[880, 0, .12], [1175, .10, .22, 'sine', .20]]),
    tick:        () => tone(1250, { dur: 0.05, type: 'square', vol: 0.05 }),
    timeUp:      () => seq([[330, 0, .18, 'sawtooth', .10], [262, .16, .18, 'sawtooth', .10], [196, .32, .34, 'sawtooth', .10]]),
    roundEnd:    () => seq([[523, 0, .12, 'triangle'], [659, .10, .12, 'triangle'], [784, .20, .24, 'triangle', .18]]),
    fanfare:     () => seq([[523, 0, .14], [523, .16, .14], [523, .32, .14], [659, .48, .30, 'triangle', .20], [784, .80, .55, 'triangle', .20]]),
  };

  return {
    play(name) { try { if (enabled && sounds[name]) sounds[name](); } catch (e) { /* audio unavailable */ } },
    get enabled() { return enabled; },
    toggle() {
      enabled = !enabled;
      try { localStorage.setItem('sketchSfx', enabled ? 'on' : 'off'); } catch (e) {}
      return enabled;
    },
  };
})();
