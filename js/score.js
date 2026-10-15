// 楽譜ビュー(VexFlow で五線譜を描画)
var PL = (globalThis.PL = globalThis.PL || {});

(function () {
  const T = PL.theory;

  const CLEF = {
    treble: { vf: 'treble', ann: undefined, rest: 'b/4' },
    treble8vb: { vf: 'treble', ann: '8vb', rest: 'b/4' },
    bass: { vf: 'bass', ann: undefined, rest: 'd/3' },
    alto: { vf: 'alto', ann: undefined, rest: 'c/4' },
    tenor: { vf: 'tenor', ann: undefined, rest: 'a/3' },
  };

  // 表示に使う移調量と調
  function displayParams(p, written) {
    const tr = written ? p.instrument.transpose || 0 : 0;
    const mode = p.key.mode;
    const fifths = mode === 'none' ? 0 : T.transposeFifths(p.key.fifths, tr);
    return { transpose: tr, fifths, mode };
  }

  function render(container, p, opts) {
    const VF = window.Vex && window.Vex.Flow;
    container.innerHTML = '';
    if (!VF) {
      container.textContent = '楽譜ライブラリを読み込めませんでした。';
      return;
    }
    const track = opts.track;
    const dp = displayParams(p, opts.written);
    const showSig = opts.showKeySig && p.key.mode !== 'none';
    const measures = PL.notation.build(track.notes, {
      timeSig: p.timeSig,
      from: p.view.from,
      to: p.view.to,
      transpose: dp.transpose,
      fifths: dp.fifths,
      mode: dp.mode,
      showKeySig: showSig,
    });

    const width = Math.max(320, container.clientWidth || 800);
    const perLine = Math.max(1, Math.min(6, Math.floor((width - 70) / (width < 500 ? 150 : 200))));
    const clef = CLEF[p.instrument.clef] || CLEF.treble;
    const lines = Math.ceil(measures.length / perLine);
    const lineH = 135;
    const top = 40;
    const height = top + lines * lineH + 20;

    const div = document.createElement('div');
    container.appendChild(div);
    const renderer = new VF.Renderer(div, VF.Renderer.Backends.SVG);
    renderer.resize(width, height);
    const ctx = renderer.getContext();
    ctx.setFont('Arial', 10);

    const sigName = T.VF_MAJOR[dp.fifths + 7];
    const vfNotesAll = []; // {note, unit, line}
    const drawables = [];

    for (let li = 0; li < lines; li++) {
      const ms = measures.slice(li * perLine, li * perLine + perLine);
      const extra = 45 + (showSig ? Math.abs(dp.fifths) * 10 : 0) + (li === 0 ? 30 : 0);
      const avail = width - 20;
      const w = (avail - extra) / perLine;
      let x = 10;
      const y = top + li * lineH;
      ms.forEach((m, mi) => {
        const sw = mi === 0 ? w + extra : w;
        const stave = new VF.Stave(x, y, sw);
        if (mi === 0) {
          stave.addClef(clef.vf, 'default', clef.ann);
          if (showSig) stave.addKeySignature(sigName);
          if (li === 0) stave.addTimeSignature(p.timeSig.num + '/' + p.timeSig.den);
        }
        stave.setMeasure(m.number);
        if (m.number === p.view.to) stave.setEndBarType(VF.Barline.type.END);
        stave.setContext(ctx).draw();

        const chord = p.chords && p.chords[m.number];
        if (chord) {
          ctx.save();
          ctx.setFont('Arial', 13, 'bold');
          ctx.fillText(chord, stave.getNoteStartX(), stave.getYForLine(0) - 30);
          ctx.restore();
        }

        const notes = m.units.map((u) => {
          let n;
          if (u.rest) {
            n = new VF.StaveNote({
              clef: clef.vf,
              keys: [clef.rest],
              duration: (u.measureRest ? 'w' : u.base + 'd'.repeat(u.dots)) + 'r',
              align_center: !!u.measureRest,
            });
          } else {
            n = new VF.StaveNote({
              clef: clef.vf,
              keys: u.pitches.map((pt) => pt.step.toLowerCase() + '/' + pt.octave),
              duration: u.base + 'd'.repeat(u.dots),
              auto_stem: true,
            });
            u.pitches.forEach((pt, i) => {
              if (pt.acc) n.addModifier(new VF.Accidental(pt.acc), i);
            });
            try {
              if (u.expr === 'scoop') n.addModifier(new VF.Ornament('scoop'), 0);
              if (u.expr === 'fall') n.addModifier(new VF.Ornament('fall'), 0);
              if (u.expr === 'vibrato') n.addModifier(new VF.Vibrato(), 0);
            } catch (e) {
              /* 古いVexFlowでは無視 */
            }
          }
          if (u.dots) VF.Dot.buildAndAttach([n], { all: true });
          vfNotesAll.push({ note: n, unit: u, line: li });
          return n;
        });

        const tuplets = m.tuplets.map(
          (idx) => new VF.Tuplet(idx.map((i) => notes[i]), { num_notes: 3, notes_occupied: 2, bracketed: true })
        );
        const voice = new VF.Voice({ num_beats: p.timeSig.num, beat_value: p.timeSig.den });
        voice.setMode(VF.Voice.Mode.SOFT);
        voice.addTickables(notes);
        const beams = m.beams.map((idx) => new VF.Beam(idx.map((i) => notes[i]), true));
        new VF.Formatter().joinVoices([voice]).format([voice], Math.max(40, stave.getNoteEndX() - stave.getNoteStartX() - 10));
        voice.draw(ctx, stave);
        drawables.push(...beams, ...tuplets);
        x += sw;
      });
    }
    drawables.forEach((d) => d.setContext(ctx).draw());

    // タイ(行をまたぐ場合は2つに分ける)
    for (let i = 0; i < vfNotesAll.length; i++) {
      const a = vfNotesAll[i];
      if (a.unit.rest || !a.unit.tieStart) continue;
      const b = vfNotesAll[i + 1];
      const idx = a.unit.pitches.map((_, k) => k);
      if (!b || b.unit.rest || !b.unit.tieStop) {
        new VF.StaveTie({ first_note: a.note, last_note: null, first_indices: idx, last_indices: idx }).setContext(ctx).draw();
        continue;
      }
      const bidx = b.unit.pitches.map((_, k) => k);
      if (a.line === b.line) {
        new VF.StaveTie({ first_note: a.note, last_note: b.note, first_indices: idx, last_indices: bidx }).setContext(ctx).draw();
      } else {
        new VF.StaveTie({ first_note: a.note, last_note: null, first_indices: idx, last_indices: idx }).setContext(ctx).draw();
        new VF.StaveTie({ first_note: null, last_note: b.note, first_indices: bidx, last_indices: bidx }).setContext(ctx).draw();
      }
    }
  }

  PL.score = { render, displayParams };
})();
