// node tests/core.test.js で実行する簡易テスト
const assert = require('assert');
for (const f of ['theory', 'instruments', 'model', 'notation', 'midi', 'score', 'musicxml']) require('../js/' + f + '.js');
const PL = globalThis.PL;
const T = PL.theory;

// 綴り
const name = (m, f, mode) => { const s = T.spell(m, f, mode); return s.step + s.alter + '/' + s.octave; };
assert.strictEqual(name(68, -7, 'minor'), 'A-1/4');   // A♭4
assert.strictEqual(name(64, -7, 'minor'), 'F-1/4');   // F♭4
assert.strictEqual(name(59, -7, 'minor'), 'C-1/4');   // C♭4(オクターブ表記に注意)
assert.strictEqual(name(67, -7, 'minor'), 'G0/4');    // 導音 G
assert.strictEqual(name(68, 0, 'minor'), 'G1/4');     // Aマイナーの G♯
assert.strictEqual(name(70, 0, 'major'), 'B-1/4');
assert.strictEqual(T.transposeFifths(-7, 9), -4);     // A♭m 実音 → アルト記譜 Fm
assert.strictEqual(T.transposeFifths(-7, 14), -5);    // テナー
assert.deepStrictEqual(T.keySigAlters(-4), { F: 0, C: 0, G: 0, D: -1, A: -1, E: -1, B: -1 });

// 拍
assert.strictEqual(T.measureTicks({ num: 6, den: 8 }), 1440);
assert.strictEqual(T.beatTicks({ num: 6, den: 8 }), 720);

// 楽譜化: 各小節が拍子どおりの長さ
const p = PL.model.sampleProject();
const tr = p.tracks[0];
const dp = PL.score.displayParams(p, true);
const ms = PL.notation.build(tr.notes, { timeSig: p.timeSig, from: 1, to: p.measures, transpose: dp.transpose, fifths: dp.fifths, mode: dp.mode, showKeySig: true });
for (const m of ms) {
  const sum = m.units.reduce((a, u) => a + u.ticks, 0);
  assert.strictEqual(sum, 1920, 'measure ' + m.number + ' length ' + sum);
}
// 小節4→5 のタイ
const m4last = ms[3].units[ms[3].units.length - 1];
assert.ok(m4last.tieStart, 'tie across barline');
assert.ok(ms[4].units[0].tieStop);
// 3連
assert.strictEqual(ms[6].tuplets.length, 1);
assert.strictEqual(ms[6].tuplets[0].length, 3);
console.log('m7 units', ms[6].units.map(u => (u.rest ? 'r' : '') + u.base + (u.dots ? '.' : '') + (u.triplet ? 't' : '')).join(' '));
console.log('m1 units', ms[0].units.map(u => (u.rest ? 'r' : u.pitches.map(x => x.step + (x.acc || '')).join('')) + u.base + (u.dots ? '.' : '')).join(' '));

// 6/8 と 3/4
for (const ts of [{ num: 6, den: 8 }, { num: 3, den: 4 }, { num: 5, den: 4 }, { num: 2, den: 2 }]) {
  const mt = T.measureTicks(ts);
  const notes = [{ id: 'a', pitch: 60, start: 120, dur: mt + 300, expr: 'none' }, { id: 'b', pitch: 62, start: mt + 600, dur: 240, expr: 'none' }];
  const r = PL.notation.build(notes, { timeSig: ts, from: 1, to: 3, transpose: 0, fifths: 0, mode: 'major', showKeySig: true });
  r.forEach((m) => assert.strictEqual(m.units.reduce((a, u) => a + u.ticks, 0), mt, JSON.stringify(ts)));
}

// MIDI 往復
const bytes = PL.midi.write({ name: 'テスト', notes: tr.notes, bpm: 90, timeSig: p.timeSig, key: p.key, program: 65 });
const back = PL.midi.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
assert.strictEqual(back.tracks.length, 1);
assert.strictEqual(back.tracks[0].notes.length, tr.notes.length);
assert.strictEqual(back.tracks[0].name, 'テスト');
assert.ok(Math.abs(back.tempos[0].bpm - 90) < 0.01);
const sortN = (a) => a.map(n => [n.start, n.dur, n.pitch]).sort((x, y) => x[0] - y[0] || x[2] - y[2]);
assert.deepStrictEqual(sortN(back.tracks[0].notes), sortN(tr.notes));

// MusicXML 書き出し(文字列として妥当そうか)
const xml = PL.musicxml.write(p, tr, { keySig: true });
assert.ok(xml.includes('<fifths>-4</fifths>'));
assert.ok(xml.includes('<chromatic>-9</chromatic>'));
assert.ok(xml.includes('<actual-notes>3</actual-notes>'));
const xml2 = PL.musicxml.write(p, tr, { keySig: false });
assert.ok(xml2.includes('<fifths>0</fifths>'));
console.log('all ok');
