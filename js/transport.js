// 再生管理: 伴奏(audio要素, ピッチ保持で速度変更)とメロディ合成の同期
// 時刻はすべて「伴奏ファイル上の秒」で表し、小節1 = offsetSec + fineMs/1000 秒
var PL = (globalThis.PL = globalThis.PL || {});

(function () {
  const T = PL.theory;
  const LOOKAHEAD = 0.2; // 秒(伴奏時間)
  const RESYNC = 0.06;

  class Transport {
    constructor(getProject) {
      this.getProject = getProject;
      this.ctx = null;
      this.synth = null;
      this.audio = null;
      this.audioUrl = null;
      this.peaks = null; // {rate, min: Float32Array, max: Float32Array, duration}
      this.playing = false;
      this.posTick = 0;
      this.timer = null;
      this.onStop = null;
      this.onChange = null;
    }

    get p() {
      return this.getProject();
    }

    ensureCtx() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        this.ctx = new AC();
        this.synth = new PL.Synth(this.ctx);
        this.synth.setVolume(this.p.mix.melVol);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    // ---- 伴奏 ----
    async loadAudio(blob) {
      this.unloadAudio();
      this.audioUrl = URL.createObjectURL(blob);
      const a = new Audio();
      a.preload = 'auto';
      a.src = this.audioUrl;
      a.preservesPitch = true;
      a.mozPreservesPitch = true;
      a.webkitPreservesPitch = true;
      this.audio = a;
      this.applyMix();
      try {
        const buf = await blob.arrayBuffer();
        const AC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const decodeCtx = this.ctx || new AC(1, 1, 44100);
        const ab = await new Promise((res, rej) => decodeCtx.decodeAudioData(buf, res, rej));
        this.peaks = computePeaks(ab);
      } catch (e) {
        console.warn('波形の解析に失敗しました', e);
        this.peaks = null;
      }
    }

    unloadAudio() {
      if (this.playing) this.stop();
      if (this.audio) {
        this.audio.pause();
        this.audio.removeAttribute('src');
        this.audio = null;
      }
      if (this.audioUrl) URL.revokeObjectURL(this.audioUrl);
      this.audioUrl = null;
      this.peaks = null;
    }

    applyMix() {
      const m = this.p.mix;
      if (this.audio) {
        this.audio.volume = Math.max(0, Math.min(1, m.accVol));
        this.audio.playbackRate = m.rate;
      }
      if (this.synth) this.synth.setVolume(m.melVol);
    }

    // ---- 時間変換 ----
    get offset() {
      const a = this.p.audio;
      return (a.offsetSec || 0) + (a.fineMs || 0) / 1000;
    }
    get spt() {
      return T.secPerTick(this.p.bpm, this.p.timeSig);
    }
    tickToSec(t) {
      return this.offset + t * this.spt;
    }
    secToTick(s) {
      return (s - this.offset) / this.spt;
    }
    currentSec() {
      if (!this.playing) return this.tickToSec(this.posTick);
      return this.anchorSec + (this.ctx.currentTime - this.anchorCtx) * this.rate;
    }
    currentTick() {
      return this.playing ? this.secToTick(this.currentSec()) : this.posTick;
    }

    loopRange() {
      const p = this.p;
      if (!p.loop.on) return null;
      const mt = T.measureTicks(p.timeSig);
      const from = Math.max(1, Math.min(p.loop.from, p.measures));
      const to = Math.max(from, Math.min(p.loop.to, p.measures));
      return { start: (from - 1) * mt, end: to * mt };
    }

    endTick() {
      const p = this.p;
      return p.view.to * T.measureTicks(p.timeSig);
    }

    hasAudio() {
      return !!this.audio;
    }

    // ---- 再生 ----
    async play() {
      if (this.playing) return;
      this.ensureCtx();
      const p = this.p;
      this.rate = p.mix.rate;
      const loop = this.loopRange();
      let start = this.posTick;
      if (loop && (start < loop.start || start >= loop.end)) start = loop.start;
      if (start >= this.endTick()) start = (p.view.from - 1) * T.measureTicks(p.timeSig);
      let startSec = this.tickToSec(start);
      if (this.audio) {
        this.applyMix();
        startSec = Math.max(0, startSec);
        this.audio.currentTime = startSec;
        try {
          await this.audio.play();
        } catch (e) {
          console.warn(e);
        }
        this.anchorSec = this.audio.currentTime;
      } else {
        this.anchorSec = startSec;
      }
      this.anchorCtx = this.ctx.currentTime + (this.audio ? 0 : 0.05);
      this.scheduledUntil = this.anchorSec - 0.001;
      this.playing = true;
      this.timer = setInterval(() => this.tick(), 25);
      this.tick();
      this.onChange && this.onChange();
    }

    stop(resetTo) {
      if (!this.playing) {
        if (resetTo != null) this.posTick = resetTo;
        return;
      }
      const t = this.currentTick();
      clearInterval(this.timer);
      this.timer = null;
      this.playing = false;
      if (this.audio) this.audio.pause();
      if (this.synth) this.synth.stopAll();
      this.posTick = resetTo != null ? resetTo : Math.max(this.secToTick(0), t);
      this.onChange && this.onChange();
    }

    toggle() {
      return this.playing ? this.stop() : this.play();
    }

    setPos(tick) {
      if (!this.playing) {
        this.posTick = tick;
        return;
      }
      this.reanchor(this.tickToSec(tick), true);
    }

    // 伴奏の先頭(小節1より前)から再生
    playFromAudioStart() {
      this.stop();
      this.posTick = this.secToTick(0);
      const p = this.p;
      if (p.loop.on) p.loop.on = false;
      return this.play();
    }

    reanchor(sec, seek) {
      if (this.synth) this.synth.stopAll();
      if (seek && this.audio) this.audio.currentTime = Math.max(0, sec);
      this.anchorSec = sec;
      this.anchorCtx = this.ctx.currentTime;
      this.scheduledUntil = sec - 0.001;
    }

    setRate(r) {
      this.p.mix.rate = r;
      if (this.audio) this.audio.playbackRate = r;
      if (this.playing) {
        const s = this.currentSec();
        this.rate = r;
        this.reanchor(s, false);
      }
    }

    // 再生中の位置を「小節1」とする
    markMeasure1() {
      if (!this.audio) return false;
      const cur = this.playing ? this.currentSec() : this.audio.currentTime;
      this.p.audio.offsetSec = Math.round(cur * 1000) / 1000;
      this.p.audio.fineMs = 0;
      if (this.playing) this.reanchor(this.currentSec(), false);
      return true;
    }

    // 編集でノートが変わったとき、先読み済みの音を作り直す
    invalidate() {
      if (!this.playing) return;
      this.reanchor(this.currentSec(), false);
    }

    tick() {
      if (!this.playing) return;
      const p = this.p;
      let now = this.currentSec();
      if (this.audio) {
        if (this.audio.ended) {
          this.stop((p.view.from - 1) * T.measureTicks(p.timeSig));
          this.onStop && this.onStop();
          return;
        }
        const drift = this.audio.currentTime - now;
        if (!this.audio.paused && !this.audio.seeking && Math.abs(drift) > RESYNC) {
          this.reanchor(this.audio.currentTime, false);
          now = this.anchorSec;
        }
      }
      const loop = this.loopRange();
      if (loop) {
        const endSec = this.tickToSec(loop.end);
        if (now >= endSec - 0.005) {
          this.reanchor(this.tickToSec(loop.start), true);
          now = this.anchorSec;
        }
      } else if (now >= this.tickToSec(this.endTick())) {
        this.stop((p.view.from - 1) * T.measureTicks(p.timeSig));
        this.onStop && this.onStop();
        return;
      }

      let limit = now + LOOKAHEAD * this.rate;
      if (loop) limit = Math.min(limit, this.tickToSec(loop.end));
      const from = this.scheduledUntil;
      if (limit <= from) return;
      const spt = this.spt;
      const track = PL.model.activeTrack(p);
      const tone = p.instrument.tone;
      for (const n of track.notes) {
        const s = this.tickToSec(n.start);
        if (s > from && s <= limit) {
          this.synth.play({
            when: this.anchorCtx + (s - this.anchorSec) / this.rate,
            dur: (n.dur * spt) / this.rate,
            pitch: n.pitch,
            tone,
            expr: n.expr,
            vel: n.vel,
          });
        }
      }
      if (p.mix.metronome) {
        const bt = T.beatTicks(p.timeSig);
        const mt = T.measureTicks(p.timeSig);
        const t0 = Math.ceil(this.secToTick(from) / bt);
        for (let b = t0; ; b++) {
          const tk = b * bt;
          const s = this.tickToSec(tk);
          if (s > limit) break;
          if (s <= from || s < 0) continue;
          this.synth.click(this.anchorCtx + (s - this.anchorSec) / this.rate, T.mod(tk, mt) === 0, p.mix.melVol);
        }
      }
      this.scheduledUntil = limit;
    }
  }

  function computePeaks(ab) {
    const rate = 200; // 1秒あたりの区間数
    const step = Math.max(1, Math.floor(ab.sampleRate / rate));
    const n = Math.ceil(ab.length / step);
    const min = new Float32Array(n);
    const max = new Float32Array(n);
    const chans = [];
    for (let c = 0; c < ab.numberOfChannels; c++) chans.push(ab.getChannelData(c));
    for (let i = 0; i < n; i++) {
      let lo = 0;
      let hi = 0;
      const end = Math.min(ab.length, (i + 1) * step);
      for (let j = i * step; j < end; j += 4) {
        let v = 0;
        for (const ch of chans) v += ch[j];
        v /= chans.length;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
      }
      min[i] = lo;
      max[i] = hi;
    }
    return { rate: ab.sampleRate / step, min, max, duration: ab.duration };
  }

  PL.Transport = Transport;
})();
