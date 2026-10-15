// 楽譜化: ノート列を小節ごとの「音符・休符の単位」に分解する
// 楽譜ビュー(VexFlow)と MusicXML 書き出しの両方で使う
//  - 1小節は拍子どおりの長さにそろえ、小節や拍をまたぐ音はタイでつなぐ
//  - 3連符の入った拍は 3連(3:2)として扱う
var PL = (globalThis.PL = globalThis.PL || {});

(function () {
  const T = PL.theory;

  const NORMAL = [
    [1920, 'w', 0], [1440, 'h', 1], [960, 'h', 0], [720, 'q', 1], [480, 'q', 0],
    [360, '8', 1], [240, '8', 0], [180, '16', 1], [120, '16', 0], [60, '32', 0],
  ];
  const TRIP = [[320, 'q'], [160, '8'], [80, '16']];
  const XML_TYPE = { w: 'whole', h: 'half', q: 'quarter', 8: 'eighth', 16: '16th', 32: '32nd' };

  // 同時に鳴る音は和音としてまとめ、重なりは次の音の頭で切る(旋律として表示)
  function monophonic(notes) {
    const sorted = notes.slice().sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    const groups = [];
    for (const n of sorted) {
      const g = groups[groups.length - 1];
      if (g && g.start === n.start) {
        g.notes.push(n);
        g.end = Math.max(g.end, n.start + n.dur);
      } else groups.push({ start: n.start, end: n.start + n.dur, notes: [n] });
    }
    for (let i = 0; i < groups.length - 1; i++) groups[i].end = Math.min(groups[i].end, groups[i + 1].start);
    return groups.filter((g) => g.end > g.start);
  }

  function exprOf(notes) {
    const e = notes.map((n) => n.expr).find((x) => x && x !== 'none');
    return e || 'none';
  }

  /**
   * opts: { timeSig, from, to (小節番号, 1始まり), transpose (表示用の半音数),
   *         fifths (表示する調の五度), mode, showKeySig }
   */
  function build(notes, opts) {
    const ts = opts.timeSig;
    const mt = T.measureTicks(ts);
    const compound = T.isCompound(ts);
    const beat = T.beatTicks(ts);
    const beamGroup = compound ? beat : Math.min(beat, 480);
    const halfBar = !compound && ts.num % 2 === 0 ? mt / 2 : null;
    const cellsEnabled = !compound && mt % 480 === 0;
    const groups = monophonic(notes);
    const sigAlters = opts.showKeySig ? T.keySigAlters(opts.fifths) : T.keySigAlters(0);
    const measures = [];

    for (let m = opts.from; m <= opts.to; m++) {
      const ms = (m - 1) * mt;
      const me = ms + mt;
      // 小節内の区間
      let segs = [];
      for (const g of groups) {
        if (g.end <= ms || g.start >= me) continue;
        const s = Math.max(g.start, ms) - ms;
        const e = Math.min(g.end, me) - ms;
        segs.push({
          s,
          e,
          pitches: g.notes.map((n) => n.pitch),
          ids: g.notes.map((n) => n.id),
          tieIn: g.start < ms,
          tieOut: g.end > me,
          headStart: g.start >= ms,
          tailEnd: g.end <= me,
          expr: exprOf(g.notes),
        });
      }
      // 3連セル(4分音符ぶん)の判定
      const nCells = cellsEnabled ? mt / 480 : 0;
      const trip = new Array(nCells).fill(false);
      if (cellsEnabled) {
        for (const sg of segs)
          for (const b of [sg.s, sg.e]) {
            const c = Math.floor(b / 480);
            if (c < nCells && b % 480 !== 0 && b % 120 !== 0) trip[c] = true;
          }
      }
      const isTripAt = (pos) => cellsEnabled && trip[Math.floor(pos / 480)] === true;
      const snap = (b) => {
        if (b <= 0) return 0;
        if (b >= mt) return mt;
        if (cellsEnabled) {
          const c = Math.floor(b / 480);
          if (trip[c]) return c * 480 + Math.round((b - c * 480) / 80) * 80;
        }
        return Math.min(mt, Math.round(b / 60) * 60);
      };
      segs.forEach((sg) => {
        sg.s = snap(sg.s);
        sg.e = snap(sg.e);
      });
      segs = segs.filter((sg) => sg.e > sg.s);
      for (let i = 1; i < segs.length; i++) if (segs[i].s < segs[i - 1].e) segs[i - 1].e = segs[i].s;
      segs = segs.filter((sg) => sg.e > sg.s);

      // 休符で隙間を埋める
      const full = [];
      let pos = 0;
      for (const sg of segs) {
        if (sg.s > pos) full.push({ s: pos, e: sg.s, rest: true });
        full.push(sg);
        pos = sg.e;
      }
      if (pos < mt) full.push({ s: pos, e: mt, rest: true });

      const units = [];
      if (full.length === 1 && full[0].rest) {
        units.push({ rest: true, measureRest: true, start: 0, ticks: mt, base: 'w', dots: 0, triplet: false });
      } else {
        for (const sg of full) {
          const parts = decompose(sg.s, sg.e, { mt, beat, compound, halfBar, isTripAt });
          parts.forEach((pt, i) => {
            const u = {
              rest: !!sg.rest,
              start: pt.start,
              ticks: pt.ticks,
              base: pt.base,
              dots: pt.dots,
              triplet: pt.triplet,
              cell: pt.triplet ? Math.floor(pt.start / 480) : null,
            };
            if (!sg.rest) {
              u.midis = sg.pitches;
              u.ids = sg.ids;
              u.tieStop = i > 0 || sg.tieIn;
              u.tieStart = i < parts.length - 1 || sg.tieOut;
              u.expr = 'none';
              if ((sg.expr === 'scoop' || sg.expr === 'vibrato') && i === 0 && sg.headStart) u.expr = sg.expr;
              if (sg.expr === 'fall' && i === parts.length - 1 && sg.tailEnd) u.expr = 'fall';
            }
            units.push(u);
          });
        }
      }

      // 音名と臨時記号
      const state = {};
      for (const u of units) {
        if (u.rest) continue;
        u.pitches = u.midis.map((midi) => {
          const w = midi + (opts.transpose || 0);
          const sp = T.spell(w, opts.fifths, opts.mode);
          const k = sp.step + sp.octave;
          const cur = k in state ? state[k] : sigAlters[sp.step];
          let acc = null;
          if (!u.tieStop && cur !== sp.alter) {
            acc = { '-2': 'bb', '-1': 'b', 0: 'n', 1: '#', 2: '##' }[sp.alter];
            state[k] = sp.alter;
          }
          return { midi: w, step: sp.step, alter: sp.alter, octave: sp.octave, acc };
        });
      }

      // 連桁(拍ごと)
      const beams = [];
      let run = [];
      let runGroup = null;
      const flush = () => {
        if (run.length >= 2) beams.push(run);
        run = [];
      };
      units.forEach((u, i) => {
        const beamable = !u.rest && (u.base === '8' || u.base === '16' || u.base === '32');
        const grp = Math.floor(u.start / beamGroup);
        if (!beamable || grp !== runGroup) flush();
        runGroup = grp;
        if (beamable) run.push(i);
      });
      flush();

      // 3連のまとまり
      const tuplets = [];
      let cur = null;
      units.forEach((u, i) => {
        if (u.triplet) {
          if (!cur || cur.cell !== u.cell) {
            cur = { cell: u.cell, idx: [] };
            tuplets.push(cur);
          }
          cur.idx.push(i);
        } else cur = null;
      });

      measures.push({ number: m, units, beams, tuplets: tuplets.map((t) => t.idx) });
    }
    return measures;
  }

  function decompose(s, e, c) {
    const out = [];
    let pos = s;
    let guard = 0;
    while (pos < e && guard++ < 200) {
      if (c.isTripAt(pos)) {
        const cellStart = Math.floor(pos / 480) * 480;
        const lim = Math.min(e, cellStart + 480);
        const rel = pos - cellStart;
        let picked = null;
        for (const [L, base] of TRIP) {
          if (pos + L > lim) continue;
          if (rel % (L === 320 ? 160 : 80) !== 0) continue;
          picked = { start: pos, ticks: L, base, dots: 0, triplet: true };
          break;
        }
        if (!picked) picked = { start: pos, ticks: Math.min(80, lim - pos), base: '16', dots: 0, triplet: true };
        out.push(picked);
        pos += picked.ticks;
        continue;
      }
      // 次の3連セルの手前まで
      let lim = e;
      for (let q = Math.floor(pos / 480) + 1; q * 480 < e; q++) {
        if (c.isTripAt(q * 480)) {
          lim = q * 480;
          break;
        }
      }
      let picked = null;
      for (const [L, base, dots] of NORMAL) {
        if (pos + L > lim || L > c.mt) continue;
        if (L >= c.beat) {
          if (pos % c.beat !== 0) continue;
          if ((L === 1920 || (L === 1440 && !c.compound)) && pos !== 0) continue;
          if (c.compound && L === 960) continue;
          if (c.halfBar && pos !== 0 && pos < c.halfBar && pos + L > c.halfBar) continue;
        } else {
          if (Math.floor(pos / c.beat) !== Math.floor((pos + L - 1) / c.beat)) continue;
          const align = dots ? (L / 3) * 2 : L;
          if (c.compound && L === 480) {
            if (pos % 240 !== 0) continue;
          } else if (pos % align !== 0) continue;
        }
        picked = { start: pos, ticks: L, base, dots, triplet: false };
        break;
      }
      if (!picked) {
        const L = Math.min(60, lim - pos);
        picked = { start: pos, ticks: L, base: '32', dots: 0, triplet: false };
      }
      out.push(picked);
      pos += picked.ticks;
    }
    return out;
  }

  PL.notation = { build, monophonic, XML_TYPE };
})();
