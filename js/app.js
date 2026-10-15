// 画面の組み立てと操作
var PL = (globalThis.PL = globalThis.PL || {});

(function () {
  const T = PL.theory;
  const M = PL.model;
  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  const app = {
    project: null,
    history: new M.History(),
    selection: new Set(),
    clipboard: null,
    tab: 'roll',
    scoreDirty: true,
  };
  PL.app = app;

  // ---------- 共通 ----------
  let toastTimer = null;
  function toast(msg, warn) {
    const el = $('toast');
    el.textContent = msg;
    el.className = 'toast' + (warn ? ' warn' : '');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.add('hidden'), warn ? 6000 : 2500);
  }
  app.toast = toast;

  function download(data, filename, type) {
    const blob = data instanceof Blob ? data : new Blob([data], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  const safeName = (s) => (s || 'phraselab').replace(/[\\/:*?"<>|]/g, '_');

  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }
  function saveNow() {
    clearTimeout(saveTimer);
    if (!app.project) return Promise.resolve();
    app.project.updatedAt = Date.now();
    return PL.store.putProject(JSON.parse(JSON.stringify(app.project))).catch((e) => {
      console.error(e);
      toast('保存に失敗しました: ' + e.message, true);
    });
  }
  window.addEventListener('pagehide', saveNow);
  document.addEventListener('visibilitychange', () => document.hidden && saveNow());

  const track = () => M.activeTrack(app.project);
  const mt = () => T.measureTicks(app.project.timeSig);
  const gridTicks = () => T.GRIDS[app.project.ui.grid].ticks;

  function markScoreDirty() {
    app.scoreDirty = true;
    if (app.tab === 'score') scheduleScore();
  }

  // ---------- 編集(ピアノロールから呼ばれる) ----------
  app.beginEdit = function () {
    app.history.push(app.project);
    updateUndo();
  };
  app.liveEdit = function () {
    app.roll.request();
  };
  app.commitEdit = function () {
    track().notes.sort((a, b) => a.start - b.start || a.pitch - b.pitch);
    const added = M.fitMeasures(app.project);
    if (added) {
      toast(`音が最後の小節を超えたため、小節数を ${app.project.measures} に増やしました`, true);
      renderSettings();
    }
    app.transport.invalidate();
    markScoreDirty();
    renderEditBar();
    app.roll.request();
    updateUndo();
    save();
  };

  app.addNote = function (tick, pitch) {
    app.beginEdit();
    const p = app.project;
    const len = p.ui.noteLen === 'grid' ? gridTicks() : parseInt(p.ui.noteLen, 10);
    const n = { id: M.uid(), pitch, start: tick, dur: len, vel: 96, expr: 'none' };
    track().notes.push(n);
    app.selection.clear();
    app.selection.add(n.id);
    app.preview(pitch);
    app.commitEdit();
  };

  app.preview = function (pitch) {
    const tr = app.transport;
    tr.ensureCtx();
    if (!tr.playing) tr.synth.preview(pitch, app.project.instrument.tone);
  };

  app.seek = function (tick) {
    app.transport.setPos(tick);
    app.roll.request();
    updatePos();
  };

  app.onSelectionChange = function () {
    renderEditBar();
    app.roll.request();
  };

  app.editChord = function (m) {
    const cur = app.project.chords[m] || '';
    const v = prompt(`小節${m} のコード(空欄で削除)`, cur);
    if (v === null) return;
    if (v.trim()) app.project.chords[m] = v.trim();
    else delete app.project.chords[m];
    renderChordsText();
    markScoreDirty();
    app.roll.request();
    save();
  };

  function selectedNotes() {
    return track().notes.filter((n) => app.selection.has(n.id));
  }

  function op(name) {
    const g = gridTicks();
    const sel = selectedNotes();
    const clampP = (v) => Math.max(21, Math.min(108, v));
    if (name === 'all') {
      app.selection = new Set(track().notes.map((n) => n.id));
      app.onSelectionChange();
      return;
    }
    if (name === 'copy') {
      if (!sel.length) return;
      const s0 = Math.min(...sel.map((n) => n.start));
      app.clipboard = sel.map((n) => ({ ...n, start: n.start - s0 }));
      toast(`${sel.length} 音をコピーしました`);
      return;
    }
    if (name === 'paste') {
      if (!app.clipboard || !app.clipboard.length) return toast('コピーした音がありません');
      const at = Math.max(0, Math.round(app.transport.currentTick() / g) * g);
      app.beginEdit();
      const added = app.clipboard.map((n) => ({ ...n, id: M.uid(), start: n.start + at }));
      track().notes.push(...added);
      app.selection = new Set(added.map((n) => n.id));
      app.commitEdit();
      return;
    }
    if (!sel.length) return;
    app.beginEdit();
    switch (name) {
      case 'up':
        sel.forEach((n) => (n.pitch = clampP(n.pitch + 1)));
        break;
      case 'down':
        sel.forEach((n) => (n.pitch = clampP(n.pitch - 1)));
        break;
      case 'octUp':
        sel.forEach((n) => (n.pitch = clampP(n.pitch + 12)));
        break;
      case 'octDown':
        sel.forEach((n) => (n.pitch = clampP(n.pitch - 12)));
        break;
      case 'left': {
        const s0 = Math.min(...sel.map((n) => n.start));
        const d = Math.min(g, s0);
        sel.forEach((n) => (n.start -= d));
        break;
      }
      case 'right':
        sel.forEach((n) => (n.start += g));
        break;
      case 'shorter':
        sel.forEach((n) => (n.dur = Math.max(Math.min(g, n.dur), n.dur - g)));
        break;
      case 'longer':
        sel.forEach((n) => (n.dur += g));
        break;
      case 'delete': {
        const ids = new Set(sel.map((n) => n.id));
        track().notes = track().notes.filter((n) => !ids.has(n.id));
        app.selection.clear();
        break;
      }
      case 'repeat': {
        const s0 = Math.min(...sel.map((n) => n.start));
        const e0 = Math.max(...sel.map((n) => n.start + n.dur));
        const span = Math.ceil((e0 - s0) / g) * g;
        const added = sel.map((n) => ({ ...n, id: M.uid(), start: n.start + span }));
        track().notes.push(...added);
        app.selection = new Set(added.map((n) => n.id));
        break;
      }
    }
    if (sel.length === 1 && ['up', 'down', 'octUp', 'octDown'].includes(name)) app.preview(sel[0].pitch);
    app.commitEdit();
  }

  function setExpr(v) {
    const sel = selectedNotes();
    if (!sel.length || !v) return;
    app.beginEdit();
    sel.forEach((n) => (n.expr = v));
    app.commitEdit();
  }

  function undo() {
    if (app.history.undo(app.project)) afterHistory();
  }
  function redo() {
    if (app.history.redo(app.project)) afterHistory();
  }
  function afterHistory() {
    const ids = new Set(track().notes.map((n) => n.id));
    app.selection = new Set([...app.selection].filter((id) => ids.has(id)));
    renderTracks();
    app.commitEdit();
  }
  function updateUndo() {
    $('btnUndo').disabled = !app.history.undoStack.length;
    $('btnRedo').disabled = !app.history.redoStack.length;
  }

  // ---------- トラック ----------
  function renderTracks() {
    const p = app.project;
    const sel = $('trackSelect');
    sel.innerHTML = '';
    p.tracks.forEach((t) => {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = `${t.name}(${t.notes.length}音)`;
      sel.appendChild(o);
    });
    sel.value = p.activeTrackId;
    const ex = $('exportTrack');
    ex.innerHTML = sel.innerHTML;
    ex.value = p.activeTrackId;
  }

  function switchTrack(id) {
    app.project.activeTrackId = id;
    app.selection.clear();
    renderTracks();
    renderEditBar();
    app.transport.invalidate();
    markScoreDirty();
    app.roll.request();
    save();
  }

  function trackMenu(anchor) {
    showMenu(anchor, [
      ['新しい案(空)', () => addTrack(false)],
      ['この案を複製', () => addTrack(true)],
      ['名前を変更', renameTrack],
      ['この案を削除', deleteTrack],
    ]);
  }

  function nextTrackName() {
    const names = new Set(app.project.tracks.map((t) => t.name));
    for (let i = 0; i < 26; i++) {
      const n = '案' + String.fromCharCode(65 + i);
      if (!names.has(n)) return n;
    }
    return '案' + (app.project.tracks.length + 1);
  }

  function addTrack(copy) {
    app.beginEdit();
    const notes = copy ? track().notes.map((n) => ({ ...n, id: M.uid() })) : [];
    const t = M.newTrack(nextTrackName(), notes);
    app.project.tracks.push(t);
    app.project.activeTrackId = t.id;
    app.selection.clear();
    renderTracks();
    app.commitEdit();
    toast(`「${t.name}」を作りました`);
  }

  function renameTrack() {
    const t = track();
    const v = prompt('案の名前', t.name);
    if (!v || !v.trim()) return;
    app.beginEdit();
    t.name = v.trim();
    renderTracks();
    app.commitEdit();
  }

  function deleteTrack() {
    const p = app.project;
    if (p.tracks.length <= 1) return toast('最後の1つは削除できません');
    if (!confirm(`「${track().name}」を削除しますか?(元に戻すで復活できます)`)) return;
    app.beginEdit();
    p.tracks = p.tracks.filter((t) => t.id !== p.activeTrackId);
    p.activeTrackId = p.tracks[0].id;
    app.selection.clear();
    renderTracks();
    app.commitEdit();
  }

  function showMenu(anchor, items) {
    const old = document.querySelector('.popmenu');
    if (old) old.remove();
    const m = document.createElement('div');
    m.className = 'popmenu';
    Object.assign(m.style, {
      position: 'fixed',
      zIndex: 40,
      background: '#232833',
      border: '1px solid #30363d',
      borderRadius: '8px',
      padding: '4px',
      display: 'flex',
      flexDirection: 'column',
      gap: '2px',
      boxShadow: '0 6px 20px rgba(0,0,0,.5)',
    });
    items.forEach(([label, fn]) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.style.textAlign = 'left';
      b.style.border = 'none';
      b.onclick = () => {
        m.remove();
        fn();
      };
      m.appendChild(b);
    });
    document.body.appendChild(m);
    const r = anchor.getBoundingClientRect();
    m.style.top = r.bottom + 4 + 'px';
    m.style.left = Math.max(4, Math.min(window.innerWidth - m.offsetWidth - 4, r.right - m.offsetWidth)) + 'px';
    setTimeout(() => {
      const close = (e) => {
        if (!m.contains(e.target)) {
          m.remove();
          document.removeEventListener('pointerdown', close, true);
        }
      };
      document.addEventListener('pointerdown', close, true);
    });
  }

  // ---------- 表示更新 ----------
  function renderHeader() {
    $('projTitle').textContent = app.project.name;
    document.title = app.project.name + ' - PhraseLab';
  }

  function renderEditBar() {
    const sel = selectedNotes();
    const bar = $('editBar');
    bar.classList.toggle('disabled', !sel.length);
    const p = app.project;
    if (!sel.length) {
      $('selInfo').textContent = '音を選ぶと編集できます';
    } else if (sel.length === 1) {
      const n = sel[0];
      const m = Math.floor(n.start / mt()) + 1;
      $('selInfo').textContent = `${T.pitchLabel(n.pitch, p.key.mode === 'none' ? 0 : p.key.fifths, p.key.mode)}(実音) 小節${m}`;
    } else {
      $('selInfo').textContent = `${sel.length} 音を選択中`;
    }
    const ex = new Set(sel.map((n) => n.expr || 'none'));
    $('exprSelect').value = ex.size === 1 ? [...ex][0] : '';
  }

  function updatePos() {
    const tr = app.transport;
    const tick = tr.currentTick();
    const el = $('posDisplay');
    if (tick < 0) {
      el.textContent = '前奏 ' + (tick * tr.spt).toFixed(1) + 's';
      return;
    }
    const m = Math.floor(tick / mt()) + 1;
    const beat = Math.floor((tick % mt()) / T.beatTicks(app.project.timeSig)) + 1;
    el.textContent = `${m}:${beat}`;
  }

  function renderTransport() {
    const p = app.project;
    $('loopOn').checked = p.loop.on;
    $('loopFrom').value = p.loop.from;
    $('loopTo').value = p.loop.to;
    $('rateSelect').value = String(p.mix.rate);
    $('accVol').value = p.mix.accVol;
    $('melVol').value = p.mix.melVol;
    $('metronome').checked = p.mix.metronome;
    updatePlayBtn();
    updatePos();
  }

  function updatePlayBtn() {
    const b = $('btnPlay');
    const on = app.transport.playing;
    b.textContent = on ? '■' : '▶';
    b.classList.toggle('playing', on);
  }

  function renderRollToolbar() {
    const p = app.project;
    $('gridSelect').value = p.ui.grid;
    $('lenSelect').value = p.ui.noteLen;
    $('scaleGuide').checked = p.ui.scaleGuide;
    $('ghosts').checked = p.ui.ghosts;
    $$('#modeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === app.roll.mode));
  }

  function renderSettings() {
    const p = app.project;
    $('sName').value = p.name;
    $('sBpm').value = p.bpm;
    $('sTime').value = p.timeSig.num + '/' + p.timeSig.den;
    if (!$('sTime').value) {
      const o = document.createElement('option');
      o.textContent = p.timeSig.num + '/' + p.timeSig.den;
      $('sTime').appendChild(o);
      $('sTime').value = o.textContent;
    }
    $('sKey').value = p.key.mode === 'none' ? 'none' : p.key.fifths + ':' + p.key.mode;
    $('sMeasures').value = p.measures;
    $('sFrom').value = p.view.from;
    $('sTo').value = p.view.to;
    const inst = p.instrument;
    $('sPreset').value = inst.presetId;
    $('sTranspose').value = inst.transpose;
    $('sClef').value = inst.clef;
    $('sLow').value = inst.low;
    $('sHigh').value = inst.high;
    $('sLowName').textContent = T.simpleName(inst.low);
    $('sHighName').textContent = T.simpleName(inst.high);
    const tone = inst.tone;
    $('tWave').value = tone.wave;
    $('tType').value = tone.type;
    [['tF1', 'formant1'], ['tF2', 'formant2'], ['tBright', 'brightness'], ['tVibRate', 'vibRate'], ['tVibDepth', 'vibDepth']].forEach(([id, k]) => {
      $(id).value = tone[k];
      $(id).nextElementSibling.textContent = tone[k];
    });
    $('sOffset').value = p.audio.offsetSec;
    $('sFine').value = p.audio.fineMs;
    $('audioName').textContent = p.audio.name ? '読み込み済み: ' + p.audio.name : '未読み込み(伴奏は端末内のファイルから選びます)';
    renderChordsText();
  }

  function renderChordsText() {
    const p = app.project;
    let last = 0;
    Object.keys(p.chords).forEach((k) => (last = Math.max(last, +k)));
    const lines = [];
    for (let m = 1; m <= last; m += 4) {
      const cells = [];
      for (let k = m; k < m + 4 && k <= last; k++) cells.push(' ' + (p.chords[k] || '') + ' ');
      lines.push('|' + cells.join('|') + '|');
    }
    $('sChords').value = lines.join('\n');
  }

  function parseChords(text) {
    const out = {};
    let m = 1;
    text.split('\n').forEach((line) => {
      line = line.trim();
      if (!line) return;
      line = line.replace(/^\|/, '').replace(/\|$/, '');
      line.split('|').forEach((cell) => {
        const c = cell.trim();
        if (c && c !== '-' && c !== '%') out[m] = c;
        m++;
      });
    });
    return out;
  }

  function refreshAll() {
    renderHeader();
    renderTracks();
    renderRollToolbar();
    renderSettings();
    renderTransport();
    renderEditBar();
    updateUndo();
    markScoreDirty();
    app.roll.request();
  }

  // ---------- 楽譜 ----------
  let scoreTimer = null;
  function scheduleScore() {
    clearTimeout(scoreTimer);
    scoreTimer = setTimeout(renderScore, 120);
  }

  function inName(tr) {
    if (!tr) return '実音';
    if (tr % 12 === 0) return tr > 0 ? 'オクターブ上で記譜' : 'オクターブ下で記譜';
    const names = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
    return 'in ' + names[T.mod(-tr, 12)];
  }

  function renderScore(width) {
    const p = app.project;
    const written = p.ui.showWritten;
    $$('#pitchSeg button').forEach((b) => b.classList.toggle('active', (b.dataset.written === '1') === written));
    $$('#sigSeg button').forEach((b) => b.classList.toggle('active', (b.dataset.sig === '1') === p.ui.showKeySig));
    const dp = PL.score.displayParams(p, written);
    const beatSym = T.isCompound(p.timeSig) ? '♩.' : { 2: '𝅗𝅥', 4: '♩', 8: '♪' }[p.timeSig.den] || '♩';
    const keyLabel = p.key.mode === 'none' ? '調号なし' : T.keyName({ fifths: dp.fifths, mode: p.key.mode });
    $('scoreHeader').innerHTML = '';
    const h1 = document.createElement('h1');
    h1.textContent = p.name;
    const sub = document.createElement('div');
    sub.className = 'sub';
    const left = document.createElement('span');
    left.textContent = `${beatSym} = ${p.bpm}`;
    const right = document.createElement('span');
    right.textContent = `${p.instrument.name}(${written ? inName(p.instrument.transpose) + '・記譜' : '実音'}) ${keyLabel} / ${track().name}`;
    sub.append(left, right);
    $('scoreHeader').append(h1, sub);
    const el = $('score');
    if (width) el.style.width = width + 'px';
    else el.style.width = '';
    try {
      PL.score.render(el, p, { track: track(), written, showKeySig: p.ui.showKeySig });
    } catch (e) {
      console.error(e);
      el.textContent = '楽譜の描画でエラーが発生しました: ' + e.message;
    }
    app.scoreDirty = false;
  }

  window.addEventListener('beforeprint', () => {
    if (app.tab !== 'score') switchTab('score');
    renderScore(700);
  });
  window.addEventListener('afterprint', () => renderScore());

  // ---------- タブ ----------
  function switchTab(tab) {
    app.tab = tab;
    $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-' + tab));
    if (tab === 'score' && app.scoreDirty) renderScore();
    if (tab === 'roll') app.roll.request();
  }

  // ---------- プロジェクト ----------
  async function openProject(p, isNew) {
    const tr = app.transport;
    tr.stop();
    tr.unloadAudio();
    app.project = M.normalize(p);
    app.history.clear();
    app.selection.clear();
    if (isNew) await saveNow();
    PL.store.setMeta('last', app.project.id);
    tr.posTick = (app.project.view.from - 1) * mt();
    refreshAll();
    requestAnimationFrame(() => {
      app.roll.fitWidth();
      app.roll.centerOnRange();
    });
    try {
      const rec = await PL.store.getAudio(app.project.id);
      if (rec && rec.blob) {
        await tr.loadAudio(rec.blob);
        app.roll.request();
      }
    } catch (e) {
      console.warn(e);
    }
  }

  async function renderProjectList() {
    const list = (await PL.store.listProjects()).sort((a, b) => b.updatedAt - a.updatedAt);
    const ul = $('projectList');
    ul.innerHTML = '';
    list.forEach((it) => {
      const li = document.createElement('li');
      li.className = it.id === app.project.id ? 'current' : '';
      const name = document.createElement('div');
      name.textContent = it.name;
      const small = document.createElement('small');
      small.textContent = new Date(it.updatedAt).toLocaleString();
      li.append(name, small);
      li.onclick = async () => {
        await saveNow();
        const p = await PL.store.getProject(it.id);
        closeDrawer();
        if (p) openProject(p);
      };
      ul.appendChild(li);
    });
  }

  function openDrawer() {
    saveNow().then(renderProjectList);
    $('drawer').classList.remove('hidden');
  }
  function closeDrawer() {
    $('drawer').classList.add('hidden');
  }

  // ---------- 読み込み ----------
  function quantize(notes, q) {
    return notes.map((n) => {
      const s = Math.round(n.start / q) * q;
      const e = Math.max(s + q, Math.round((n.start + n.dur) / q) * q);
      return { id: M.uid(), pitch: n.pitch, start: s, dur: e - s, vel: n.vel || 96, expr: n.expr || 'none' };
    });
  }

  function choose(title, options) {
    if (options.length <= 1) return 0;
    const msg = title + '\n' + options.map((o, i) => `${i + 1}: ${o}`).join('\n');
    const v = prompt(msg, '1');
    if (v === null) return -1;
    const i = parseInt(v, 10) - 1;
    return i >= 0 && i < options.length ? i : 0;
  }

  async function importMelody(file) {
    const p = app.project;
    const name = file.name.replace(/\.[^.]+$/, '');
    const isMidi = /\.midi?$/i.test(file.name);
    let notes;
    let warnings = [];
    let meta = {};
    if (isMidi) {
      const r = PL.midi.parse(await file.arrayBuffer());
      if (!r.tracks.length) throw new Error('音の入ったトラックがありません');
      const i = choose('どのトラックを読み込みますか?', r.tracks.map((t, k) => `${t.name || 'トラック' + (k + 1)}(${t.notes.length}音)`));
      if (i < 0) return;
      notes = r.tracks[i].notes;
      if (r.timeSigs.length) meta.timeSig = { num: r.timeSigs[0].num, den: r.timeSigs[0].den };
      if (r.tempos.length) meta.qbpm = r.tempos[0].bpm;
      if (r.keySigs.length) meta.key = { fifths: r.keySigs[0].fifths, mode: r.keySigs[0].minor ? 'minor' : 'major' };
      if (r.tempos.length > 1 && new Set(r.tempos.map((t) => Math.round(t.bpm))).size > 1) warnings.push('途中でテンポが変わっていますが、最初のテンポだけを使います');
      if (r.timeSigs.length > 1) warnings.push('途中で拍子が変わっていますが、最初の拍子だけを使います');
    } else {
      const r = PL.musicxml.parse(await file.text());
      const parts = r.parts.filter((x) => x.notes.length);
      if (!parts.length) throw new Error('音の入ったパートがありません');
      const i = choose('どのパートを読み込みますか?', parts.map((x) => `${x.name}(${x.notes.length}音)`));
      if (i < 0) return;
      notes = parts[i].notes;
      warnings = warnings.concat(parts[i].warnings);
      if (r.timeSig) meta.timeSig = r.timeSig;
      if (r.bpm) meta.qbpm = r.bpm;
      if (r.key) meta.key = r.key;
    }
    app.beginEdit();
    if ($('importSettings').checked) {
      if (meta.timeSig && meta.timeSig.num > 0 && [1, 2, 4, 8, 16].includes(meta.timeSig.den)) p.timeSig = meta.timeSig;
      if (meta.qbpm) p.bpm = Math.round(((meta.qbpm * T.PPQ) / T.beatTicks(p.timeSig)) * 10) / 10;
      if (meta.key) p.key = meta.key;
    }
    const q = quantize(notes, 40);
    if ($('importNewTrack').checked) {
      const t = M.newTrack(name.slice(0, 20) || nextTrackName(), q);
      p.tracks.push(t);
      p.activeTrackId = t.id;
    } else {
      track().notes = q;
    }
    app.selection.clear();
    const before = p.measures;
    M.fitMeasures(p);
    if (p.measures !== before) {
      warnings.push(`読み込んだ旋律は ${p.measures} 小節あり、小節数(${before})と合わないため増やしました`);
      p.view.to = p.measures;
    }
    renderTracks();
    renderSettings();
    app.commitEdit();
    app.roll.centerOnRange();
    toast([`「${file.name}」を読み込みました(${q.length}音)`].concat(warnings).join('\n'), warnings.length > 0);
  }

  async function importProjectJson(file) {
    const data = JSON.parse(await file.text());
    if (!data || !Array.isArray(data.tracks)) throw new Error('PhraseLab のプロジェクトファイルではありません');
    data.id = M.uid();
    data.audio = { ...(data.audio || {}), name: null };
    await saveNow();
    await openProject(data, true);
    toast(`「${app.project.name}」を読み込みました。伴奏音源は設定から読み込んでください。`);
  }

  // ---------- 入力の結び付け ----------
  function bind() {
    // 上部
    $('btnMenu').onclick = openDrawer;
    $$('.drawer-bg')[0].onclick = closeDrawer;
    $('trackSelect').onchange = (e) => switchTrack(e.target.value);
    $('btnTrackMenu').onclick = (e) => trackMenu(e.currentTarget);
    $('btnUndo').onclick = undo;
    $('btnRedo').onclick = redo;
    $$('#tabs button').forEach((b) => (b.onclick = () => switchTab(b.dataset.tab)));

    // ピアノロールのツール
    $$('#modeSeg button').forEach(
      (b) =>
        (b.onclick = () => {
          app.roll.mode = b.dataset.mode;
          renderRollToolbar();
        })
    );
    const gs = $('gridSelect');
    Object.entries(T.GRIDS).forEach(([k, v]) => {
      const o = document.createElement('option');
      o.value = k;
      o.textContent = v.label;
      gs.appendChild(o);
    });
    gs.onchange = () => {
      app.project.ui.grid = gs.value;
      app.roll.request();
      save();
    };
    $('lenSelect').onchange = (e) => {
      app.project.ui.noteLen = e.target.value;
      save();
    };
    $('zoomIn').onclick = () => app.roll.zoom(1.4);
    $('zoomOut').onclick = () => app.roll.zoom(1 / 1.4);
    $('zoomFit').onclick = () => app.roll.fitWidth();
    $('zoomYIn').onclick = () => app.roll.zoomY(1.2);
    $('zoomYOut').onclick = () => app.roll.zoomY(1 / 1.2);
    $('scaleGuide').onchange = (e) => {
      app.project.ui.scaleGuide = e.target.checked;
      app.roll.request();
      save();
    };
    $('ghosts').onchange = (e) => {
      app.project.ui.ghosts = e.target.checked;
      app.roll.request();
      save();
    };
    $$('#editBar [data-op]').forEach((b) => (b.onclick = () => op(b.dataset.op)));
    $('exprSelect').onchange = (e) => setExpr(e.target.value);

    // 楽譜
    $$('#pitchSeg button').forEach(
      (b) =>
        (b.onclick = () => {
          app.project.ui.showWritten = b.dataset.written === '1';
          renderScore();
          save();
        })
    );
    $$('#sigSeg button').forEach(
      (b) =>
        (b.onclick = () => {
          app.project.ui.showKeySig = b.dataset.sig === '1';
          renderScore();
          save();
        })
    );
    $('btnPrint').onclick = () => window.print();
    let lastW = 0;
    window.addEventListener('resize', () => {
      app.roll.request();
      const w = $('score').clientWidth;
      if (app.tab === 'score' && Math.abs(w - lastW) > 40) {
        lastW = w;
        scheduleScore();
      } else app.scoreDirty = true;
    });

    bindSettings();
    bindTransport();
    bindFiles();
    bindDrawer();
    bindKeys();
  }

  function bindSettings() {
    const p = () => app.project;
    const changed = (opts = {}) => {
      if (opts.roll !== false) app.roll.request();
      markScoreDirty();
      app.transport.invalidate();
      save();
    };
    $('sName').oninput = (e) => {
      p().name = e.target.value || '無題';
      renderHeader();
      markScoreDirty();
      save();
    };
    $('sBpm').onchange = (e) => {
      const v = parseFloat(e.target.value);
      if (v >= 20 && v <= 400) p().bpm = v;
      $('sBpm').value = p().bpm;
      changed();
    };
    let taps = [];
    $('btnTap').onpointerdown = () => {
      const now = performance.now();
      if (taps.length && now - taps[taps.length - 1] > 2000) taps = [];
      taps.push(now);
      if (taps.length > 8) taps.shift();
      if (taps.length >= 2) {
        const iv = (taps[taps.length - 1] - taps[0]) / (taps.length - 1);
        p().bpm = Math.round((60000 / iv) * 10) / 10;
        $('sBpm').value = p().bpm;
        changed();
      }
      $('btnTap').textContent = taps.length < 2 ? 'タップ…' : `タップ(${taps.length})`;
    };
    $('sTime').onchange = (e) => {
      const [num, den] = e.target.value.split('/').map(Number);
      const oldMt = mt();
      const total = p().measures * oldMt;
      p().timeSig = { num, den };
      const nmt = mt();
      p().measures = Math.max(1, Math.ceil(total / nmt));
      p().view.from = Math.max(1, Math.floor(((p().view.from - 1) * oldMt) / nmt) + 1);
      p().view.to = Math.min(p().measures, Math.max(p().view.from, Math.ceil((p().view.to * oldMt) / nmt)));
      p().loop.from = 1;
      p().loop.to = Math.min(4, p().measures);
      M.fitMeasures(p());
      renderSettings();
      renderTransport();
      changed();
    };
    const ks = $('sKey');
    T.keyOptions().forEach((k) => {
      const o = document.createElement('option');
      o.value = k.mode === 'none' ? 'none' : k.fifths + ':' + k.mode;
      o.textContent = k.label;
      ks.appendChild(o);
    });
    ks.onchange = () => {
      if (ks.value === 'none') p().key = { fifths: 0, mode: 'none' };
      else {
        const [f, mode] = ks.value.split(':');
        p().key = { fifths: +f, mode };
      }
      renderEditBar();
      changed();
    };
    $('sMeasures').onchange = (e) => {
      const v = Math.max(1, Math.min(999, parseInt(e.target.value, 10) || 1));
      const wasFull = p().view.to === p().measures;
      p().measures = v;
      if (M.fitMeasures(p())) toast(`音が入っているため、小節数は ${p().measures} より減らせません`, true);
      if (wasFull || p().view.to > p().measures) p().view.to = p().measures;
      p().view.from = Math.min(p().view.from, p().view.to);
      renderSettings();
      changed();
    };
    const viewChange = () => {
      const a = parseInt($('sFrom').value, 10) || 1;
      const b = parseInt($('sTo').value, 10) || p().measures;
      p().view.from = M.clamp(a, 1, p().measures);
      p().view.to = M.clamp(b, p().view.from, p().measures);
      renderSettings();
      app.transport.posTick = (p().view.from - 1) * mt();
      app.roll.scrollX = 0;
      app.roll.fitWidth();
      changed();
    };
    $('sFrom').onchange = viewChange;
    $('sTo').onchange = viewChange;

    const ps = $('sPreset');
    PL.instruments.PRESETS.forEach((pr) => {
      const o = document.createElement('option');
      o.value = pr.id;
      o.textContent = pr.name;
      ps.appendChild(o);
    });
    ps.onchange = () => {
      p().instrument = PL.instruments.fromPreset(ps.value);
      renderSettings();
      changed();
    };
    const cs = $('sClef');
    PL.instruments.CLEFS.forEach((c) => {
      const o = document.createElement('option');
      o.value = c.id;
      o.textContent = c.label;
      cs.appendChild(o);
    });
    cs.onchange = () => {
      p().instrument.clef = cs.value;
      changed({ roll: false });
    };
    $('sTranspose').onchange = (e) => {
      p().instrument.transpose = parseInt(e.target.value, 10) || 0;
      changed({ roll: false });
    };
    const rangeCh = () => {
      p().instrument.low = M.clamp(parseInt($('sLow').value, 10) || 0, 0, 127);
      p().instrument.high = M.clamp(parseInt($('sHigh').value, 10) || 127, p().instrument.low, 127);
      renderSettings();
      changed();
    };
    $('sLow').onchange = rangeCh;
    $('sHigh').onchange = rangeCh;
    $('tWave').onchange = (e) => {
      p().instrument.tone.wave = e.target.value;
      save();
    };
    $('tType').onchange = (e) => {
      p().instrument.tone.type = e.target.value;
      save();
    };
    [['tF1', 'formant1'], ['tF2', 'formant2'], ['tBright', 'brightness'], ['tVibRate', 'vibRate'], ['tVibDepth', 'vibDepth']].forEach(([id, k]) => {
      $(id).oninput = (e) => {
        p().instrument.tone[k] = parseFloat(e.target.value);
        e.target.nextElementSibling.textContent = e.target.value;
        save();
      };
    });
    $('btnToneTest').onclick = () => {
      const tr = app.transport;
      tr.ensureCtx();
      const inst = p().instrument;
      const base = Math.round((inst.low + inst.high) / 2);
      const t0 = tr.ctx.currentTime + 0.05;
      [[0, 0, 0.4, 'none'], [2, 0.45, 0.4, 'scoop'], [4, 0.9, 1.2, 'vibrato'], [7, 2.2, 0.8, 'fall']].forEach(([iv, at, dur, expr]) =>
        tr.synth.play({ when: t0 + at, dur, pitch: base + iv, tone: inst.tone, expr })
      );
    };

    // 伴奏
    $('audioFile').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        app.transport.ensureCtx();
        await PL.store.putAudio(p().id, { blob: f, name: f.name });
        p().audio.name = f.name;
        await app.transport.loadAudio(f);
        renderSettings();
        app.roll.request();
        save();
        toast('伴奏を読み込みました。「伴奏を頭から再生」→「ここが小節1」で頭を合わせます。');
      } catch (err) {
        toast('伴奏を読み込めませんでした: ' + err.message, true);
      }
    };
    $('btnAudioClear').onclick = async () => {
      if (!p().audio.name && !app.transport.hasAudio()) return;
      if (!confirm('伴奏を外しますか?')) return;
      await PL.store.deleteAudio(p().id);
      app.transport.unloadAudio();
      p().audio.name = null;
      renderSettings();
      app.roll.request();
      save();
    };
    const offCh = () => {
      p().audio.offsetSec = parseFloat($('sOffset').value) || 0;
      p().audio.fineMs = parseInt($('sFine').value, 10) || 0;
      app.transport.invalidate();
      app.roll.request();
      save();
    };
    $('sOffset').onchange = offCh;
    $('sFine').onchange = offCh;
    $$('[data-fine]').forEach(
      (b) =>
        (b.onclick = () => {
          p().audio.fineMs = (p().audio.fineMs || 0) + parseInt(b.dataset.fine, 10);
          $('sFine').value = p().audio.fineMs;
          offCh();
        })
    );
    $('btnPlayFromTop').onclick = async () => {
      if (!app.transport.hasAudio()) return toast('先に伴奏音源を読み込んでください', true);
      await app.transport.playFromAudioStart();
      renderTransport();
    };
    $('btnMark1').onclick = () => {
      if (!app.transport.markMeasure1()) return toast('先に伴奏音源を読み込んでください', true);
      renderSettings();
      app.roll.request();
      save();
      toast(`小節1 = ${p().audio.offsetSec.toFixed(3)} 秒 に設定しました`);
    };
    $('btnChordsApply').onclick = () => {
      p().chords = parseChords($('sChords').value);
      renderChordsText();
      app.roll.request();
      markScoreDirty();
      save();
      toast('コードを反映しました');
    };
  }

  function bindTransport() {
    const tr = app.transport;
    const p = () => app.project;
    tr.onChange = () => {
      updatePlayBtn();
      updatePos();
      app.roll.request();
    };
    tr.onStop = () => updatePlayBtn();
    $('btnPlay').onclick = () => tr.toggle();
    $('btnHome').onclick = () => {
      tr.stop();
      tr.posTick = (p().view.from - 1) * mt();
      app.roll.scrollX = 0;
      app.roll.request();
      updatePos();
    };
    const loopCh = () => {
      const a = M.clamp(parseInt($('loopFrom').value, 10) || 1, 1, p().measures);
      const b = M.clamp(parseInt($('loopTo').value, 10) || a, a, p().measures);
      p().loop = { on: $('loopOn').checked, from: a, to: b };
      renderTransport();
      app.roll.request();
      save();
    };
    $('loopOn').onchange = loopCh;
    $('loopFrom').onchange = loopCh;
    $('loopTo').onchange = loopCh;
    $('btnLoopSel').onclick = () => {
      const sel = selectedNotes();
      if (!sel.length) return toast('ループしたい音を選んでください');
      const a = Math.floor(Math.min(...sel.map((n) => n.start)) / mt()) + 1;
      const b = Math.ceil(Math.max(...sel.map((n) => n.start + n.dur)) / mt());
      p().loop = { on: true, from: a, to: Math.max(a, b) };
      renderTransport();
      app.roll.request();
      save();
    };
    $('rateSelect').onchange = (e) => {
      tr.setRate(parseFloat(e.target.value));
      save();
    };
    $('accVol').oninput = (e) => {
      p().mix.accVol = parseFloat(e.target.value);
      tr.applyMix();
      save();
    };
    $('melVol').oninput = (e) => {
      p().mix.melVol = parseFloat(e.target.value);
      tr.applyMix();
      save();
    };
    $('metronome').onchange = (e) => {
      p().mix.metronome = e.target.checked;
      save();
    };
  }

  function bindFiles() {
    $('melodyFile').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        await importMelody(f);
      } catch (err) {
        console.error(err);
        toast('読み込めませんでした: ' + err.message, true);
      }
    };
    $('projectFile').onchange = async (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (!f) return;
      try {
        await importProjectJson(f);
      } catch (err) {
        toast('読み込めませんでした: ' + err.message, true);
      }
    };
    const exTrack = () => app.project.tracks.find((t) => t.id === $('exportTrack').value) || track();
    $('btnExportMidi').onclick = () => {
      const p = app.project;
      const t = exTrack();
      const data = PL.midi.write({ name: t.name, notes: t.notes, bpm: p.bpm, timeSig: p.timeSig, key: p.key, program: p.instrument.program });
      download(new Blob([data], { type: 'audio/midi' }), `${safeName(p.name)}_${safeName(t.name)}.mid`);
    };
    $('btnExportXml').onclick = () => {
      const p = app.project;
      const t = exTrack();
      const xml = PL.musicxml.write(p, t, { keySig: $('xmlKeySig').checked });
      download(xml, `${safeName(p.name)}_${safeName(t.name)}.musicxml`, 'application/vnd.recordare.musicxml+xml');
    };
    $('btnExportJson').onclick = () => {
      const p = app.project;
      download(JSON.stringify(p, null, 1), `${safeName(p.name)}.phraselab.json`, 'application/json');
    };
  }

  function bindDrawer() {
    $('btnNewProject').onclick = async () => {
      const name = prompt('曲名', '新しい曲');
      if (name === null) return;
      await saveNow();
      closeDrawer();
      await openProject(M.newProject(name.trim() || '新しい曲'), true);
      switchTab('settings');
      toast('テンポ・拍子・調・楽器を設定してください');
    };
    $('btnDupProject').onclick = async () => {
      await saveNow();
      const src = app.project;
      const copy = JSON.parse(JSON.stringify(src));
      copy.id = M.uid();
      copy.name = src.name + '(コピー)';
      copy.createdAt = Date.now();
      const rec = await PL.store.getAudio(src.id);
      if (rec) await PL.store.putAudio(copy.id, rec);
      closeDrawer();
      await openProject(copy, true);
    };
    $('btnSampleProject').onclick = async () => {
      await saveNow();
      closeDrawer();
      await openProject(M.sampleProject(), true);
    };
    $('btnDeleteProject').onclick = async () => {
      if (!confirm(`「${app.project.name}」を削除しますか?元に戻せません。`)) return;
      await PL.store.deleteProject(app.project.id);
      app.project = null;
      const list = (await PL.store.listProjects()).sort((a, b) => b.updatedAt - a.updatedAt);
      closeDrawer();
      if (list.length) await openProject(await PL.store.getProject(list[0].id));
      else await openProject(M.newProject(), true);
    };
  }

  function bindKeys() {
    document.addEventListener('keydown', (e) => {
      const tag = (e.target.tagName || '').toLowerCase();
      if (['input', 'textarea', 'select'].includes(tag)) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;
      let handled = true;
      if (k === ' ') app.transport.toggle();
      else if (mod && k.toLowerCase() === 'z' && !e.shiftKey) undo();
      else if (mod && (k.toLowerCase() === 'y' || (k.toLowerCase() === 'z' && e.shiftKey))) redo();
      else if (mod && k.toLowerCase() === 'c') op('copy');
      else if (mod && k.toLowerCase() === 'v') op('paste');
      else if (mod && k.toLowerCase() === 'd') op('repeat');
      else if (mod && k.toLowerCase() === 'a') op('all');
      else if (k === 'Delete' || k === 'Backspace') op('delete');
      else if (k === 'ArrowUp') op(e.shiftKey ? 'octUp' : 'up');
      else if (k === 'ArrowDown') op(e.shiftKey ? 'octDown' : 'down');
      else if (k === 'ArrowLeft') op(e.shiftKey ? 'shorter' : 'left');
      else if (k === 'ArrowRight') op(e.shiftKey ? 'longer' : 'right');
      else if (k === 'Escape') {
        app.selection.clear();
        app.onSelectionChange();
      } else handled = false;
      if (handled) e.preventDefault();
    });
  }

  // ---------- 描画ループ ----------
  function loop() {
    const tr = app.transport;
    if (app.project) {
      if (tr.playing) {
        const tick = tr.currentTick();
        if (app.tab === 'roll') {
          app.roll.follow(tick);
          app.roll.request();
        }
        updatePos();
      }
      if (app.tab === 'roll' && app.roll.dirty) app.roll.draw();
    }
    requestAnimationFrame(loop);
  }

  // ---------- 起動 ----------
  async function init() {
    app.transport = new PL.Transport(() => app.project);
    app.roll = new PL.PianoRoll($('roll'), $('wave'), app);
    bind();
    let p = null;
    try {
      const list = await PL.store.listProjects();
      if (!list.length) {
        await openProject(M.sampleProject(), true);
        toast('サンプル曲を用意しました。伴奏音源は「設定」から読み込んでください。');
      } else {
        const last = await PL.store.getMeta('last');
        const id = list.some((x) => x.id === last) ? last : list.sort((a, b) => b.updatedAt - a.updatedAt)[0].id;
        p = await PL.store.getProject(id);
        await openProject(p);
      }
    } catch (e) {
      console.error(e);
      toast('保存領域(IndexedDB)が使えません。保存はされません: ' + e.message, true);
      if (!app.project) {
        app.project = M.sampleProject();
        refreshAll();
      }
    }
    requestAnimationFrame(loop);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
