// 楽器プリセット
// transpose: 記譜 = 実音 + transpose(半音)
// low/high: 実音での音域の目安(MIDI番号)
// tone: Web Audio 合成のパラメータ
var PL = (globalThis.PL = globalThis.PL || {});

(function () {
  const reed = (f1, f2, bright, vib) => ({
    type: 'wind',
    wave: 'sawtooth',
    formant1: f1,
    formant2: f2,
    brightness: bright,
    vibRate: vib.rate,
    vibDepth: vib.depth,
    attack: 0.03,
    release: 0.08,
  });

  const PRESETS = [
    { id: 'altoSax', name: 'アルトサックス', transpose: 9, low: 49, high: 80, clef: 'treble', program: 65,
      tone: reed(650, 1800, 3200, { rate: 5.2, depth: 18 }) },
    { id: 'tenorSax', name: 'テナーサックス', transpose: 14, low: 44, high: 75, clef: 'treble', program: 66,
      tone: reed(500, 1500, 2600, { rate: 5.0, depth: 20 }) },
    { id: 'sopranoSax', name: 'ソプラノサックス', transpose: 2, low: 56, high: 87, clef: 'treble', program: 64,
      tone: reed(850, 2300, 4200, { rate: 5.5, depth: 16 }) },
    { id: 'bariSax', name: 'バリトンサックス', transpose: 21, low: 36, high: 68, clef: 'treble', program: 67,
      tone: reed(400, 1200, 2000, { rate: 4.8, depth: 18 }) },
    { id: 'flute', name: 'フルート', transpose: 0, low: 60, high: 96, clef: 'treble', program: 73,
      tone: { type: 'wind', wave: 'triangle', formant1: 900, formant2: 2500, brightness: 5000, vibRate: 5.0, vibDepth: 14, attack: 0.05, release: 0.1 } },
    { id: 'clarinet', name: 'クラリネット(B♭)', transpose: 2, low: 50, high: 91, clef: 'treble', program: 71,
      tone: { type: 'wind', wave: 'square', formant1: 700, formant2: 2000, brightness: 3000, vibRate: 5.0, vibDepth: 0, attack: 0.03, release: 0.08 } },
    { id: 'trumpet', name: 'トランペット(B♭)', transpose: 2, low: 52, high: 84, clef: 'treble', program: 56,
      tone: reed(1100, 2600, 5000, { rate: 5.5, depth: 12 }) },
    { id: 'trombone', name: 'トロンボーン', transpose: 0, low: 40, high: 72, clef: 'bass', program: 57,
      tone: reed(550, 1400, 2600, { rate: 5.0, depth: 12 }) },
    { id: 'violin', name: 'バイオリン', transpose: 0, low: 55, high: 100, clef: 'treble', program: 40,
      tone: reed(800, 2800, 5000, { rate: 5.8, depth: 22 }) },
    { id: 'piano', name: 'ピアノ(確認用)', transpose: 0, low: 21, high: 108, clef: 'treble', program: 0,
      tone: { type: 'piano', wave: 'triangle', formant1: 0, formant2: 0, brightness: 4000, vibRate: 0, vibDepth: 0, attack: 0.005, release: 0.3 } },
    { id: 'guitar', name: 'ギター', transpose: 12, low: 40, high: 88, clef: 'treble8vb', program: 25,
      tone: { type: 'piano', wave: 'sawtooth', formant1: 0, formant2: 0, brightness: 2500, vibRate: 0, vibDepth: 0, attack: 0.003, release: 0.2 } },
    { id: 'custom', name: '自由設定', transpose: 0, low: 48, high: 84, clef: 'treble', program: 0,
      tone: reed(700, 2000, 3500, { rate: 5.0, depth: 15 }) },
  ];

  const CLEFS = [
    { id: 'treble', label: 'ト音記号' },
    { id: 'treble8vb', label: 'ト音記号(8vb)' },
    { id: 'bass', label: 'ヘ音記号' },
    { id: 'alto', label: 'ハ音記号(アルト)' },
    { id: 'tenor', label: 'ハ音記号(テナー)' },
  ];

  function preset(id) {
    return PRESETS.find((p) => p.id === id) || PRESETS[0];
  }

  // プロジェクトに保存する楽器設定(プリセットをコピーして自由に変更可能にする)
  function fromPreset(id) {
    return JSON.parse(JSON.stringify({ ...preset(id), presetId: id }));
  }

  PL.instruments = { PRESETS, CLEFS, preset, fromPreset };
})();
