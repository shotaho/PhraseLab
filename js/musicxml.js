// MusicXML の読み込み・書き出し
var PL = (globalThis.PL = globalThis.PL || {});

(function () {
  const T = PL.theory;
  const PPQ = T.PPQ;
  const DIAT = [0, 1, 1, 2, 2, 3, 3, 4, 5, 5, 6, 6];
  const ACC = { '#': 'sharp', b: 'flat', n: 'natural', '##': 'double-sharp', bb: 'flat-flat' };
  const CLEF_XML = {
    treble: '<sign>G</sign><line>2</line>',
    treble8vb: '<sign>G</sign><line>2</line><clef-octave-change>-1</clef-octave-change>',
    bass: '<sign>F</sign><line>4</line>',
    alto: '<sign>C</sign><line>3</line>',
    tenor: '<sign>C</sign><line>4</line>',
  };

  const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  function transposeXml(semis) {
    if (!semis) return '';
    const t = Math.abs(semis);
    const sign = semis > 0 ? -1 : 1; // 記譜 → 実音 の向き
    const oc = Math.floor(t / 12);
    const r = t % 12;
    return (
      '<transpose>' +
      `<diatonic>${sign * DIAT[r]}</diatonic><chromatic>${sign * r}</chromatic>` +
      (oc ? `<octave-change>${sign * oc}</octave-change>` : '') +
      '</transpose>'
    );
  }

  // opts: { keySig: true/false }
  function write(p, track, opts) {
    const dp = PL.score.displayParams(p, true);
    const showSig = opts.keySig && p.key.mode !== 'none';
    const measures = PL.notation.build(track.notes, {
      timeSig: p.timeSig,
      from: 1,
      to: p.measures,
      transpose: dp.transpose,
      fifths: dp.fifths,
      mode: dp.mode,
      showKeySig: showSig,
    });
    const compound = T.isCompound(p.timeSig);
    const qbpm = (p.bpm * T.beatTicks(p.timeSig)) / PPQ;
    const inst = p.instrument;
    const x = [];
    x.push('<?xml version="1.0" encoding="UTF-8" standalone="no"?>');
    x.push('<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">');
    x.push('<score-partwise version="4.0">');
    x.push(`<work><work-title>${esc(p.name)}</work-title></work>`);
    x.push(`<identification><encoding><software>PhraseLab</software></encoding></identification>`);
    x.push('<part-list><score-part id="P1">');
    x.push(`<part-name>${esc(inst.name)}</part-name>`);
    x.push(`<score-instrument id="P1-I1"><instrument-name>${esc(inst.name)}</instrument-name></score-instrument>`);
    x.push(`<midi-instrument id="P1-I1"><midi-channel>1</midi-channel><midi-program>${(inst.program || 0) + 1}</midi-program></midi-instrument>`);
    x.push('</score-part></part-list>');
    x.push('<part id="P1">');

    measures.forEach((m, mi) => {
      x.push(`<measure number="${m.number}">`);
      if (mi === 0) {
        x.push('<attributes>');
        x.push(`<divisions>${PPQ}</divisions>`);
        x.push(`<key><fifths>${showSig ? dp.fifths : 0}</fifths>${p.key.mode !== 'none' && showSig ? `<mode>${p.key.mode}</mode>` : ''}</key>`);
        x.push(`<time><beats>${p.timeSig.num}</beats><beat-type>${p.timeSig.den}</beat-type></time>`);
        x.push(`<clef>${CLEF_XML[inst.clef] || CLEF_XML.treble}</clef>`);
        x.push(transposeXml(inst.transpose || 0));
        x.push('</attributes>');
        x.push(
          '<direction placement="above"><direction-type><metronome>' +
            `<beat-unit>${compound ? 'quarter' : beatUnit(p.timeSig)}</beat-unit>` +
            (compound ? '<beat-unit-dot/>' : '') +
            `<per-minute>${round2(p.bpm)}</per-minute></metronome></direction-type>` +
            `<sound tempo="${round2(qbpm)}"/></direction>`
        );
      }
      const chord = p.chords && p.chords[m.number];
      if (chord) {
        x.push(`<direction placement="above"><direction-type><words font-weight="bold">${esc(chord)}</words></direction-type></direction>`);
      }
      const beamInfo = beamMap(m);
      const tupStart = new Set(m.tuplets.map((t) => t[0]));
      const tupStop = new Set(m.tuplets.map((t) => t[t.length - 1]));
      m.units.forEach((u, ui) => {
        if (u.rest) {
          x.push(
            '<note>' +
              (u.measureRest ? '<rest measure="yes"/>' : '<rest/>') +
              `<duration>${u.ticks}</duration><voice>1</voice>` +
              (u.measureRest ? '' : typeXml(u)) +
              (u.triplet ? '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>' : '') +
              notationsXml(u, ui, tupStart, tupStop) +
              '</note>'
          );
          return;
        }
        u.pitches.forEach((pt, pi) => {
          let s = '<note>';
          if (pi > 0) s += '<chord/>';
          s += `<pitch><step>${pt.step}</step>${pt.alter ? `<alter>${pt.alter}</alter>` : ''}<octave>${pt.octave}</octave></pitch>`;
          s += `<duration>${u.ticks}</duration>`;
          if (u.tieStop) s += '<tie type="stop"/>';
          if (u.tieStart) s += '<tie type="start"/>';
          s += '<voice>1</voice>' + typeXml(u);
          if (pt.acc) s += `<accidental>${ACC[pt.acc]}</accidental>`;
          if (u.triplet) s += '<time-modification><actual-notes>3</actual-notes><normal-notes>2</normal-notes></time-modification>';
          if (pi === 0 && beamInfo[ui]) s += beamInfo[ui];
          s += notationsXml(u, ui, pi === 0 ? tupStart : new Set(), pi === 0 ? tupStop : new Set());
          s += '</note>';
          x.push(s);
        });
      });
      if (m.number === p.measures) x.push('<barline location="right"><bar-style>light-heavy</bar-style></barline>');
      x.push('</measure>');
    });
    x.push('</part></score-partwise>');
    return x.join('\n');
  }

  function beatUnit(ts) {
    return { 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th' }[ts.den] || 'quarter';
  }

  const round2 = (v) => Math.round(v * 100) / 100;

  function typeXml(u) {
    return `<type>${PL.notation.XML_TYPE[u.base]}</type>` + '<dot/>'.repeat(u.dots || 0);
  }

  function notationsXml(u, ui, tupStart, tupStop) {
    let s = '';
    if (u.tieStop) s += '<tied type="stop"/>';
    if (u.tieStart) s += '<tied type="start"/>';
    if (tupStart.has(ui)) s += '<tuplet type="start" bracket="yes"/>';
    if (tupStop.has(ui)) s += '<tuplet type="stop"/>';
    if (u.expr === 'scoop') s += '<articulations><scoop/></articulations>';
    if (u.expr === 'fall') s += '<articulations><falloff/></articulations>';
    if (u.expr === 'vibrato') s += '<ornaments><wavy-line type="start"/><wavy-line type="stop"/></ornaments>';
    return s ? `<notations>${s}</notations>` : '';
  }

  function beamMap(m) {
    const out = {};
    const lvl = (b) => (b === '8' ? 1 : b === '16' ? 2 : b === '32' ? 3 : 0);
    m.beams.forEach((run) => {
      run.forEach((ui, k) => {
        let s = `<beam number="1">${k === 0 ? 'begin' : k === run.length - 1 ? 'end' : 'continue'}</beam>`;
        const u = m.units[ui];
        if (lvl(u.base) >= 2) {
          const prev = k > 0 && lvl(m.units[run[k - 1]].base) >= 2;
          const next = k < run.length - 1 && lvl(m.units[run[k + 1]].base) >= 2;
          let v;
          if (prev && next) v = 'continue';
          else if (next) v = 'begin';
          else if (prev) v = 'end';
          else v = k === 0 ? 'forward hook' : 'backward hook';
          s += `<beam number="2">${v}</beam>`;
        }
        out[ui] = s;
      });
    });
    return out;
  }

  // ---- 読み込み ----
  function parse(text) {
    const doc = new DOMParser().parseFromString(text, 'application/xml');
    if (doc.querySelector('parsererror')) throw new Error('MusicXMLとして読めませんでした');
    if (!doc.querySelector('score-partwise')) {
      throw new Error('score-partwise 形式のMusicXMLのみ対応しています(.mxl 圧縮形式は展開してから読み込んでください)');
    }
    const child = (el, name) => (el ? Array.from(el.children).find((c) => c.tagName === name) : null);
    const num = (el, name, def) => {
      const c = child(el, name);
      return c ? parseFloat(c.textContent) : def;
    };
    const result = { title: '', parts: [], bpm: null, timeSig: null, key: null, warnings: [] };
    const wt = doc.querySelector('work > work-title') || doc.querySelector('movement-title');
    if (wt) result.title = wt.textContent.trim();
    const names = {};
    doc.querySelectorAll('part-list > score-part').forEach((sp) => {
      const pn = child(sp, 'part-name');
      names[sp.getAttribute('id')] = pn ? pn.textContent.trim() : sp.getAttribute('id');
    });

    doc.querySelectorAll('score-partwise > part').forEach((part) => {
      const pid = part.getAttribute('id');
      const notes = [];
      const warnings = [];
      let divisions = 1;
      let ts = null;
      let mt = null;
      let chrom = 0;
      let voice = null;
      let otherVoice = false;
      const open = []; // タイ継続中のノート
      let mIndex = 0;
      Array.from(part.children)
        .filter((c) => c.tagName === 'measure')
        .forEach((measure) => {
          let cursor = 0;
          let maxPos = 0;
          let lastStart = 0;
          for (const el of Array.from(measure.children)) {
            if (el.tagName === 'attributes') {
              divisions = num(el, 'divisions', divisions);
              const time = child(el, 'time');
              if (time) {
                const nts = { num: num(time, 'beats', 4), den: num(time, 'beat-type', 4) };
                if (ts && (nts.num !== ts.num || nts.den !== ts.den)) warnings.push(`小節${mIndex + 1}で拍子が変わっています(途中の拍子変更には未対応)`);
                if (!ts) {
                  ts = nts;
                  mt = T.measureTicks(ts);
                }
              }
              const key = child(el, 'key');
              if (key && !result.key) {
                const mode = child(key, 'mode');
                result.key = { fifths: num(key, 'fifths', 0), mode: mode && mode.textContent.trim() === 'minor' ? 'minor' : 'major' };
              }
              const tr = child(el, 'transpose');
              if (tr) chrom = num(tr, 'chromatic', 0) + 12 * num(tr, 'octave-change', 0);
            } else if (el.tagName === 'direction' || el.tagName === 'sound') {
              const snd = el.tagName === 'sound' ? el : child(el, 'sound');
              if (snd && snd.getAttribute('tempo') && result.bpm == null) result.bpm = parseFloat(snd.getAttribute('tempo'));
            } else if (el.tagName === 'backup') {
              cursor -= (num(el, 'duration', 0) * PPQ) / divisions;
            } else if (el.tagName === 'forward') {
              cursor += (num(el, 'duration', 0) * PPQ) / divisions;
              maxPos = Math.max(maxPos, cursor);
            } else if (el.tagName === 'note') {
              if (child(el, 'grace') || child(el, 'cue')) continue;
              const v = child(el, 'voice') ? child(el, 'voice').textContent.trim() : '1';
              const dur = (num(el, 'duration', 0) * PPQ) / divisions;
              const isChord = !!child(el, 'chord');
              const start = isChord ? lastStart : cursor;
              if (!isChord) {
                lastStart = cursor;
                cursor += dur;
                maxPos = Math.max(maxPos, cursor);
              }
              if (voice == null && !child(el, 'rest')) voice = v;
              if (voice != null && v !== voice) {
                otherVoice = true;
                continue;
              }
              const pitch = child(el, 'pitch');
              if (!pitch || child(el, 'rest')) continue;
              const step = child(pitch, 'step').textContent.trim();
              const midi =
                (num(pitch, 'octave', 4) + 1) * 12 + T.LETTER_PC[step] + Math.round(num(pitch, 'alter', 0)) + chrom;
              const curMt = mt || 1920;
              if (start >= curMt) {
                warnings.push(`小節${mIndex + 1}が拍子より長いため、はみ出した音を切りました`);
                continue;
              }
              const abs = Math.round(mIndex * curMt + start);
              const d = Math.round(dur);
              const ties = Array.from(el.children).filter((c) => c.tagName === 'tie').map((c) => c.getAttribute('type'));
              if (ties.includes('stop')) {
                const k = open.findIndex((o) => o.pitch === midi && Math.abs(o.start + o.dur - abs) < 2);
                if (k >= 0) {
                  const o = open[k];
                  o.dur = abs + d - o.start;
                  if (!ties.includes('start')) open.splice(k, 1);
                  continue;
                }
              }
              const n = { pitch: midi, start: abs, dur: d, vel: 96, expr: 'none' };
              const nt = child(el, 'notations');
              if (nt) {
                if (nt.querySelector('scoop')) n.expr = 'scoop';
                else if (nt.querySelector('falloff')) n.expr = 'fall';
                else if (nt.querySelector('wavy-line')) n.expr = 'vibrato';
              }
              notes.push(n);
              if (ties.includes('start')) open.push(n);
            }
          }
          const curMt = mt || 1920;
          if (Math.round(maxPos) !== curMt && maxPos > 0) {
            const why = maxPos < curMt ? (mIndex === 0 ? '弱起(アウフタクト)のため' : '拍子より短いため') : '拍子より長いため';
            warnings.push(`小節${mIndex + 1}は${why}、拍子どおりの長さに整えました`);
          }
          mIndex++;
        });
      if (otherVoice) warnings.push('複数の声部があるため、最初の声部だけを読み込みました');
      result.parts.push({ id: pid, name: names[pid] || pid, notes, warnings, measures: mIndex, transposeChromatic: chrom });
      if (!result.timeSig && ts) result.timeSig = ts;
    });
    return result;
  }

  PL.musicxml = { write, parse };
})();
