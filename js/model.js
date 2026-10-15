// プロジェクトのデータ構造・サンプル・Undo
// ノートは常に「実音」の MIDI 番号と tick(4分=480)で持つ
var PL = (globalThis.PL = globalThis.PL || {});

(function () {
  const T = PL.theory;

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  function newTrack(name, notes) {
    return { id: uid(), name: name || '案A', notes: notes || [] };
  }

  function newProject(name) {
    const track = newTrack('案A');
    return normalize({
      id: uid(),
      name: name || '新しい曲',
      tracks: [track],
      activeTrackId: track.id,
    });
  }

  // 足りない項目を補い、古いデータや読み込んだJSONでも動くようにする
  function normalize(p) {
    const d = {
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      bpm: 120,
      timeSig: { num: 4, den: 4 },
      key: { fifths: 0, mode: 'major' },
      instrument: PL.instruments.fromPreset('altoSax'),
      measures: 16,
      view: { from: 1, to: 16 },
      audio: { name: null, offsetSec: 0, fineMs: 0 },
      chords: {},
      mix: { accVol: 0.8, melVol: 0.8, rate: 1, metronome: false },
      loop: { on: false, from: 1, to: 4 },
      ui: { grid: '8', noteLen: 'grid', showWritten: true, showKeySig: true, scaleGuide: true, ghosts: true },
    };
    const out = { ...d, ...p };
    for (const k of ['timeSig', 'key', 'view', 'audio', 'mix', 'loop', 'ui']) out[k] = { ...d[k], ...(p[k] || {}) };
    out.instrument = { ...PL.instruments.fromPreset(out.instrument.presetId || 'custom'), ...out.instrument };
    out.instrument.tone = { ...PL.instruments.preset(out.instrument.presetId).tone, ...(out.instrument.tone || {}) };
    if (!out.id) out.id = uid();
    if (!Array.isArray(out.tracks) || !out.tracks.length) out.tracks = [newTrack('案A')];
    out.tracks.forEach((t) => {
      if (!t.id) t.id = uid();
      t.notes = (t.notes || []).filter((n) => n && n.dur > 0).map((n) => ({
        id: n.id || uid(),
        pitch: Math.round(n.pitch),
        start: Math.max(0, Math.round(n.start)),
        dur: Math.max(10, Math.round(n.dur)),
        vel: n.vel || 96,
        expr: n.expr || 'none',
      }));
    });
    if (!out.tracks.some((t) => t.id === out.activeTrackId)) out.activeTrackId = out.tracks[0].id;
    out.measures = Math.max(1, Math.round(out.measures));
    fitMeasures(out);
    out.view.from = clamp(Math.round(out.view.from), 1, out.measures);
    out.view.to = clamp(Math.round(out.view.to), out.view.from, out.measures);
    return out;
  }

  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  // 小節数がノートより少ない場合は増やす。増やした小節数を返す(警告用)
  function fitMeasures(p) {
    const mt = T.measureTicks(p.timeSig);
    let end = 0;
    p.tracks.forEach((t) => t.notes.forEach((n) => (end = Math.max(end, n.start + n.dur))));
    const need = Math.ceil(end / mt);
    if (need > p.measures) {
      const added = need - p.measures;
      const wasFull = p.view && p.view.to === p.measures;
      p.measures = need;
      if (wasFull) p.view.to = need;
      return added;
    }
    return 0;
  }

  function activeTrack(p) {
    return p.tracks.find((t) => t.id === p.activeTrackId) || p.tracks[0];
  }

  // ---- サンプル曲(アルトサックス、90 BPM、4/4、実音 A♭マイナー)----
  function sampleProject() {
    const q = 480;
    // [小節(0始まり), 拍位置(4分単位), 長さ(4分単位), 実音MIDI, 表情]
    const A = [
      [0, 1, 0.5, 63], [0, 1.5, 0.5, 66], [0, 2, 1, 68, 'scoop'], [0, 3, 0.5, 70], [0, 3.5, 0.5, 71],
      [1, 0, 1.5, 70], [1, 1.5, 0.5, 68], [1, 2, 2, 63, 'vibrato'],
      [2, 0.5, 0.5, 66], [2, 1, 0.5, 68], [2, 1.5, 0.5, 71], [2, 2, 1, 73], [2, 3, 1, 71],
      [3, 0, 3, 70, 'vibrato'], [3, 3.5, 1, 66],
      [4, 0.5, 0.5, 68], [4, 1, 1, 75, 'scoop'], [4, 2, 0.5, 73], [4, 2.5, 0.5, 71], [4, 3, 1, 70],
      [5, 0, 1, 68], [5, 1, 0.5, 64], [5, 1.5, 0.5, 66], [5, 2, 2, 68, 'vibrato'],
      [6, 0, 1 / 3, 66], [6, 1 / 3, 1 / 3, 68], [6, 2 / 3, 1 / 3, 71], [6, 1, 1, 73], [6, 2, 1.5, 71], [6, 3.5, 0.5, 70],
      [7, 0, 1, 70], [7, 1, 1, 67], [7, 2, 2, 63, 'fall'],
    ];
    const toNotes = (arr) =>
      arr.map(([m, b, d, p, e]) => ({
        id: uid(),
        pitch: p,
        start: Math.round(m * 4 * q + b * q),
        dur: Math.round(d * q),
        vel: 96,
        expr: e || 'none',
      }));
    const B = A.slice(0, 30).concat([[7, 0, 0.5, 71], [7, 0.5, 0.5, 70], [7, 1, 1, 67], [7, 2, 2, 68, 'vibrato']]);
    const tA = newTrack('案A', toNotes(A));
    const tB = newTrack('案B', toNotes(B));
    return normalize({
      id: uid(),
      name: 'サンプル曲(A♭マイナー)',
      bpm: 90,
      timeSig: { num: 4, den: 4 },
      key: { fifths: -7, mode: 'minor' },
      instrument: PL.instruments.fromPreset('altoSax'),
      measures: 8,
      view: { from: 1, to: 8 },
      chords: { 1: 'A♭m', 2: 'F♭maj7', 3: 'C♭', 4: 'G♭', 5: 'A♭m', 6: 'F♭maj7', 7: 'D♭m7', 8: 'E♭7' },
      tracks: [tA, tB],
      activeTrackId: tA.id,
      loop: { on: false, from: 1, to: 4 },
    });
  }

  // ---- Undo / Redo(トラック状態のスナップショット)----
  class History {
    constructor(limit = 200) {
      this.limit = limit;
      this.undoStack = [];
      this.redoStack = [];
    }
    clear() {
      this.undoStack = [];
      this.redoStack = [];
    }
    snapshot(p) {
      return JSON.stringify({ tracks: p.tracks, activeTrackId: p.activeTrackId });
    }
    push(p) {
      this.undoStack.push(this.snapshot(p));
      if (this.undoStack.length > this.limit) this.undoStack.shift();
      this.redoStack = [];
    }
    apply(p, snap) {
      const s = JSON.parse(snap);
      p.tracks = s.tracks;
      p.activeTrackId = s.activeTrackId;
    }
    undo(p) {
      if (!this.undoStack.length) return false;
      this.redoStack.push(this.snapshot(p));
      this.apply(p, this.undoStack.pop());
      return true;
    }
    redo(p) {
      if (!this.redoStack.length) return false;
      this.undoStack.push(this.snapshot(p));
      this.apply(p, this.redoStack.pop());
      return true;
    }
  }

  PL.model = { uid, newTrack, newProject, normalize, fitMeasures, activeTrack, sampleProject, History, clamp };
})();
