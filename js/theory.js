// 音楽理論まわりの共通処理(時間・調・綴り)
var PL = (globalThis.PL = globalThis.PL || {});

(function () {
  const PPQ = 480; // 4分音符 = 480 tick

  const GRIDS = {
    '4': { label: '4分', ticks: 480 },
    '8': { label: '8分', ticks: 240 },
    '16': { label: '16分', ticks: 120 },
    '8t': { label: '8分3連', ticks: 160 },
    '16t': { label: '16分3連', ticks: 80 },
  };

  function measureTicks(ts) {
    return Math.round((ts.num * PPQ * 4) / ts.den);
  }

  function isCompound(ts) {
    return ts.den === 8 && ts.num % 3 === 0 && ts.num > 3;
  }

  // テンポ(BPM)が数える1拍の長さ。6/8 などの複合拍子は付点4分を1拍とする
  function beatTicks(ts) {
    return isCompound(ts) ? (PPQ * 3) / 2 : (PPQ * 4) / ts.den;
  }

  function secPerTick(bpm, ts) {
    return 60 / (bpm * beatTicks(ts));
  }

  // ---- 調 ----
  const MAJOR_NAMES = ['C♭', 'G♭', 'D♭', 'A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯'];
  const MINOR_NAMES = ['A♭', 'E♭', 'B♭', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F♯', 'C♯', 'G♯', 'D♯', 'A♯'];
  const VF_MAJOR = ['Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#'];

  function keyName(key) {
    if (key.mode === 'none') return '調号なし';
    const i = key.fifths + 7;
    return key.mode === 'minor' ? MINOR_NAMES[i] + 'マイナー' : MAJOR_NAMES[i] + 'メジャー';
  }

  function keyOptions() {
    const out = [];
    for (let f = -7; f <= 7; f++) out.push({ fifths: f, mode: 'major', label: keyName({ fifths: f, mode: 'major' }) });
    for (let f = -7; f <= 7; f++) out.push({ fifths: f, mode: 'minor', label: keyName({ fifths: f, mode: 'minor' }) });
    out.push({ fifths: 0, mode: 'none', label: '調号なし(無調)' });
    return out;
  }

  const mod = (a, n) => ((a % n) + n) % n;

  function tonicPc(key) {
    const p = key.mode === 'minor' ? key.fifths + 3 : key.fifths;
    return mod(p * 7, 12);
  }

  // 調の音階に含まれるピッチクラス(長調/自然短音階)
  function scalePcs(key) {
    if (key.mode === 'none') return null;
    const t = tonicPc(key);
    const steps = key.mode === 'minor' ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
    return new Set(steps.map((s) => (t + s) % 12));
  }

  // 移調後の調号(五度圏上の位置)。±7 を超えたら異名同音で寄せる
  function transposeFifths(fifths, semis) {
    let f = fifths + mod(semis * 7, 12);
    while (f > 7) f -= 12;
    while (f < -7) f += 12;
    return f;
  }

  // 五度圏の位置 p(C=0, G=1, F=-1 …)から音名へ
  const LETTERS_BY_FIFTH = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  const LETTER_PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

  // midi 番号を、調(五度)に合わせて綴る → {step, alter, octave}
  function spell(midi, fifths, mode) {
    const pc = mod(midi, 12);
    const c = fifths + (mode === 'minor' ? 3 : 2);
    const p0 = mod(pc * 7, 12);
    let best = null;
    for (let k = -3; k <= 3; k++) {
      const p = p0 + 12 * k;
      const d = Math.abs(p - c);
      if (
        best === null ||
        d < best.d ||
        (d === best.d && (fifths < 0 ? p < best.p : p > best.p))
      ) {
        best = { p, d };
      }
    }
    const p = best.p;
    const step = LETTERS_BY_FIFTH[mod(p + 1, 7)];
    const alter = Math.floor((p + 1) / 7);
    const octave = Math.floor((midi - alter) / 12) - 1;
    return { step, alter, octave };
  }

  // 調号で各音名に付く変化(F C G D A E B の順に # が付く)
  const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'];
  function keySigAlters(fifths) {
    const out = {};
    SHARP_ORDER.forEach((l, k) => {
      out[l] = Math.floor((fifths + 6 - k) / 7);
    });
    return out;
  }

  const ACC_TEXT = { '-2': '𝄫', '-1': '♭', 0: '', 1: '♯', 2: '𝄪' };
  function pitchLabel(midi, fifths, mode) {
    const s = spell(midi, fifths == null ? 0 : fifths, mode || 'major');
    return s.step + ACC_TEXT[s.alter] + s.octave;
  }

  const SIMPLE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
  function simpleName(midi) {
    return SIMPLE_NAMES[mod(midi, 12)] + (Math.floor(midi / 12) - 1);
  }

  function isBlackKey(midi) {
    return [1, 3, 6, 8, 10].includes(mod(midi, 12));
  }

  PL.theory = {
    PPQ,
    GRIDS,
    measureTicks,
    beatTicks,
    isCompound,
    secPerTick,
    keyName,
    keyOptions,
    tonicPc,
    scalePcs,
    transposeFifths,
    spell,
    keySigAlters,
    pitchLabel,
    simpleName,
    isBlackKey,
    VF_MAJOR,
    LETTER_PC,
    mod,
  };
})();
