// Standard MIDI File の読み込み・書き出し
var PL = (globalThis.PL = globalThis.PL || {});

(function () {
  const PPQ = PL.theory.PPQ;

  // ---- 読み込み ----
  function parse(arrayBuffer) {
    const d = new DataView(arrayBuffer);
    let o = 0;
    const str = (n) => {
      let s = '';
      for (let i = 0; i < n; i++) s += String.fromCharCode(d.getUint8(o + i));
      o += n;
      return s;
    };
    const u32 = () => {
      const v = d.getUint32(o);
      o += 4;
      return v;
    };
    const u16 = () => {
      const v = d.getUint16(o);
      o += 2;
      return v;
    };
    if (str(4) !== 'MThd') throw new Error('MIDIファイルではありません');
    const hlen = u32();
    const format = u16();
    const ntracks = u16();
    const division = u16();
    o = 8 + hlen;
    if (division & 0x8000) throw new Error('SMPTE形式のMIDIには対応していません');

    const result = { format, division, tempos: [], timeSigs: [], keySigs: [], tracks: [] };
    for (let t = 0; t < ntracks && o < d.byteLength; t++) {
      const id = str(4);
      const len = u32();
      const end = o + len;
      if (id !== 'MTrk') {
        o = end;
        continue;
      }
      const track = { name: '', notes: [], channels: new Set(), program: null };
      const open = {};
      let tick = 0;
      let status = 0;
      const vlq = () => {
        let v = 0;
        let b;
        do {
          b = d.getUint8(o++);
          v = (v << 7) | (b & 0x7f);
        } while (b & 0x80);
        return v;
      };
      while (o < end) {
        tick += vlq();
        let b = d.getUint8(o);
        if (b & 0x80) {
          status = b;
          o++;
        }
        const type = status & 0xf0;
        const ch = status & 0x0f;
        if (status === 0xff) {
          const mt = d.getUint8(o++);
          const ml = vlq();
          const ms = o;
          if (mt === 0x03) {
            let s = '';
            for (let i = 0; i < ml; i++) s += String.fromCharCode(d.getUint8(ms + i));
            try {
              s = decodeURIComponent(escape(s));
            } catch (e) {}
            track.name = s;
          } else if (mt === 0x51) {
            const us = (d.getUint8(ms) << 16) | (d.getUint8(ms + 1) << 8) | d.getUint8(ms + 2);
            result.tempos.push({ tick, bpm: 60000000 / us });
          } else if (mt === 0x58) {
            result.timeSigs.push({ tick, num: d.getUint8(ms), den: Math.pow(2, d.getUint8(ms + 1)) });
          } else if (mt === 0x59) {
            result.keySigs.push({ tick, fifths: d.getInt8(ms), minor: d.getUint8(ms + 1) === 1 });
          }
          o = ms + ml;
        } else if (status === 0xf0 || status === 0xf7) {
          o += vlq();
        } else if (type === 0x90 || type === 0x80) {
          const note = d.getUint8(o++);
          const vel = d.getUint8(o++);
          const key = ch + ':' + note;
          if (type === 0x90 && vel > 0) {
            (open[key] = open[key] || []).push({ tick, vel });
          } else if (open[key] && open[key].length) {
            const on = open[key].shift();
            track.notes.push({ pitch: note, start: on.tick, dur: tick - on.tick, vel: on.vel, ch });
            track.channels.add(ch);
          }
        } else if (type === 0xc0) {
          track.program = d.getUint8(o++);
        } else if (type === 0xd0) {
          o += 1;
        } else {
          o += 2; // 0xA0, 0xB0, 0xE0
        }
      }
      o = end;
      if (track.notes.length) result.tracks.push(track);
    }
    // tick を PPQ=480 に換算
    const scale = PPQ / division;
    result.tracks.forEach((tr) =>
      tr.notes.forEach((n) => {
        n.start = Math.round(n.start * scale);
        n.dur = Math.max(1, Math.round(n.dur * scale));
      })
    );
    result.tempos.forEach((x) => (x.tick = Math.round(x.tick * scale)));
    return result;
  }

  // ---- 書き出し(実音) ----
  function write({ name, notes, bpm, timeSig, key, program }) {
    const bytes = [];
    const push = (...b) => bytes.push(...b);
    const vlq = (v, arr) => {
      const tmp = [v & 0x7f];
      while ((v >>= 7)) tmp.unshift((v & 0x7f) | 0x80);
      arr.push(...tmp);
    };
    const strBytes = (s) => Array.from(unescape(encodeURIComponent(s))).map((c) => c.charCodeAt(0));

    const track = [];
    const meta = (delta, type, data) => {
      vlq(delta, track);
      track.push(0xff, type);
      vlq(data.length, track);
      track.push(...data);
    };
    meta(0, 0x03, strBytes(name || 'Melody'));
    const us = Math.round(60000000 / (bpm * (PL.theory.beatTicks(timeSig) / PPQ)));
    meta(0, 0x51, [(us >> 16) & 0xff, (us >> 8) & 0xff, us & 0xff]);
    meta(0, 0x58, [timeSig.num, Math.round(Math.log2(timeSig.den)), 24, 8]);
    if (key && key.mode !== 'none') meta(0, 0x59, [key.fifths & 0xff, key.mode === 'minor' ? 1 : 0]);
    vlq(0, track);
    track.push(0xc0, program || 0);

    const ev = [];
    notes.forEach((n) => {
      ev.push({ t: n.start, on: false, p: n.pitch, v: 0 });
      ev.push({ t: n.start + n.dur, on: false, p: n.pitch, v: 0, off: true });
      ev[ev.length - 2].on = true;
      ev[ev.length - 2].v = n.vel || 96;
    });
    ev.sort((a, b) => a.t - b.t || (a.off ? -1 : 1) - (b.off ? -1 : 1));
    let last = 0;
    ev.forEach((e) => {
      vlq(e.t - last, track);
      last = e.t;
      track.push(e.on ? 0x90 : 0x80, e.p & 0x7f, e.on ? e.v : 0);
    });
    meta(0, 0x2f, []);

    push(0x4d, 0x54, 0x68, 0x64, 0, 0, 0, 6, 0, 0, 0, 1, (PPQ >> 8) & 0xff, PPQ & 0xff);
    push(0x4d, 0x54, 0x72, 0x6b);
    const L = track.length;
    push((L >>> 24) & 0xff, (L >>> 16) & 0xff, (L >>> 8) & 0xff, L & 0xff);
    for (let i = 0; i < track.length; i++) bytes.push(track[i]);
    return new Uint8Array(bytes);
  }

  PL.midi = { parse, write };
})();
