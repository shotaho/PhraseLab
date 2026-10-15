// 簡易 Web Audio 合成(フォルマント + ビブラート)
var PL = (globalThis.PL = globalThis.PL || {});

(function () {
  const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

  class Synth {
    constructor(ctx) {
      this.ctx = ctx;
      this.out = ctx.createGain();
      this.out.gain.value = 0.8;
      this.comp = ctx.createDynamicsCompressor();
      this.out.connect(this.comp).connect(ctx.destination);
      this.voices = new Set();
    }

    setVolume(v) {
      this.out.gain.setTargetAtTime(v, this.ctx.currentTime, 0.02);
    }

    // when: AudioContext 時刻, dur: 秒
    play({ when, dur, pitch, tone, expr = 'none', vel = 96 }) {
      const ctx = this.ctx;
      when = Math.max(when, ctx.currentTime);
      dur = Math.max(0.04, dur);
      const amp = 0.22 * (vel / 127);
      const nodes = [];
      const env = ctx.createGain();
      env.gain.value = 0;
      env.connect(this.out);
      nodes.push(env);

      const freq = mtof(pitch);
      const oscs = [];
      const mkOsc = (type, mult, detune) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq * mult;
        o.detune.value = detune || 0;
        oscs.push(o);
        nodes.push(o);
        return o;
      };

      let end = when + dur;
      const release = tone.release || 0.08;

      if (tone.type === 'piano') {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = tone.brightness || 4000;
        lp.connect(env);
        nodes.push(lp);
        const o1 = mkOsc(tone.wave || 'triangle', 1);
        const o2 = mkOsc('sine', 2);
        const g2 = ctx.createGain();
        g2.gain.value = 0.3;
        o1.connect(lp);
        o2.connect(g2).connect(lp);
        nodes.push(g2);
        env.gain.setValueAtTime(0, when);
        env.gain.linearRampToValueAtTime(amp * 1.3, when + (tone.attack || 0.005));
        env.gain.setTargetAtTime(amp * 0.25, when + 0.01, 0.35);
        env.gain.cancelScheduledValues(end);
        env.gain.setTargetAtTime(0, end, release / 3);
      } else {
        // 管楽器風: 鋸波などを並列のバンドパス(フォルマント) + ローパスに通す
        const mix = ctx.createGain();
        mix.gain.value = 1;
        mix.connect(env);
        nodes.push(mix);
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = tone.brightness || 3000;
        lp.Q.value = 0.7;
        lp.connect(mix);
        nodes.push(lp);
        const src = ctx.createGain();
        src.gain.value = 0.5;
        src.connect(lp);
        nodes.push(src);
        [[tone.formant1, 4, 1.4], [tone.formant2, 6, 0.9]].forEach(([f, q, g]) => {
          if (!f) return;
          const bp = ctx.createBiquadFilter();
          bp.type = 'bandpass';
          bp.frequency.value = f;
          bp.Q.value = q;
          const bg = ctx.createGain();
          bg.gain.value = g;
          src.connect(bp).connect(bg).connect(mix);
          nodes.push(bp, bg);
        });
        mkOsc(tone.wave || 'sawtooth', 1, -3).connect(src);
        mkOsc(tone.wave || 'sawtooth', 1, 4).connect(src);

        const atk = tone.attack || 0.03;
        env.gain.setValueAtTime(0, when);
        env.gain.linearRampToValueAtTime(amp, when + atk);
        env.gain.setTargetAtTime(amp * 0.8, when + atk, 0.1);

        // ビブラート
        let depth = tone.vibDepth || 0;
        let vDelay = 0.3;
        if (expr === 'vibrato') {
          depth = Math.max(35, depth * 2.5);
          vDelay = 0.08;
        }
        if (depth > 0 && dur > vDelay + 0.1) {
          const lfo = ctx.createOscillator();
          lfo.frequency.value = tone.vibRate || 5;
          const lg = ctx.createGain();
          lg.gain.setValueAtTime(0, when);
          lg.gain.setValueAtTime(0, when + vDelay);
          lg.gain.linearRampToValueAtTime(depth, when + vDelay + 0.25);
          lfo.connect(lg);
          oscs.forEach((o) => lg.connect(o.detune));
          oscs.push(lfo);
          nodes.push(lfo, lg);
        }

        // スクープ(下からしゃくり上げる)
        if (expr === 'scoop') {
          const len = Math.min(0.14, dur * 0.4);
          oscs.forEach((o) => {
            if (o.type === 'sine' && o.frequency.value < 30) return;
            o.detune.setValueAtTime(o.detune.value - 250, when);
            o.detune.linearRampToValueAtTime(o.detune.value, when + len);
          });
        }

        // フォール(音の終わりで下がる)
        if (expr === 'fall') {
          const len = Math.min(0.35, Math.max(0.15, dur * 0.4));
          const fs = Math.max(when + 0.02, end - len * 0.3);
          end = end + len * 0.7;
          oscs.slice(0, 2).forEach((o) => {
            const base = o.detune.value;
            o.detune.setValueAtTime(base, fs);
            o.detune.linearRampToValueAtTime(base - 900, end);
          });
          env.gain.setValueAtTime(amp * 0.8, fs);
          env.gain.linearRampToValueAtTime(0.0001, end);
        } else {
          env.gain.cancelScheduledValues(end);
          env.gain.setTargetAtTime(0, end, release / 3);
        }
      }

      const stopAt = end + release * 2 + 0.05;
      oscs.forEach((o) => {
        o.start(when);
        o.stop(stopAt);
      });
      const voice = {
        nodes,
        oscs,
        env,
        stopAt,
        stop: () => {
          const t = ctx.currentTime;
          try {
            env.gain.cancelScheduledValues(t);
            env.gain.setTargetAtTime(0, t, 0.015);
            oscs.forEach((o) => o.stop(t + 0.08));
          } catch (e) {
            /* 既に停止済み */
          }
        },
      };
      this.voices.add(voice);
      oscs[0].onended = () => {
        this.voices.delete(voice);
        nodes.forEach((n) => {
          try {
            n.disconnect();
          } catch (e) {}
        });
      };
      return voice;
    }

    preview(pitch, tone) {
      this.play({ when: this.ctx.currentTime + 0.01, dur: 0.35, pitch, tone, expr: 'none' });
    }

    click(when, accent, volume) {
      const ctx = this.ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = accent ? 1600 : 1100;
      g.gain.setValueAtTime(0, when);
      g.gain.linearRampToValueAtTime(0.35 * (volume == null ? 1 : volume), when + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, when + 0.05);
      o.connect(g).connect(ctx.destination);
      o.start(when);
      o.stop(when + 0.06);
    }

    stopAll() {
      this.voices.forEach((v) => v.stop());
      this.voices.clear();
    }
  }

  PL.Synth = Synth;
})();
