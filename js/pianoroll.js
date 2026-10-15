// ピアノロール(Canvas)と伴奏の波形表示
var PL = (globalThis.PL = globalThis.PL || {});

(function () {
  const T = PL.theory;
  const KEY_W = 44;
  const RULER_H = 22;
  const CHORD_H = 20;
  const HEAD_H = RULER_H + CHORD_H;
  const PMIN = 21;
  const PMAX = 108;

  const C = {
    bg: '#1b1f27',
    rowWhite: '#232833',
    rowBlack: '#1d2129',
    rowScale: '#27354a',
    rowTonic: '#2e4566',
    outRange: 'rgba(220,60,60,0.10)',
    gridSub: 'rgba(255,255,255,0.05)',
    gridBeat: 'rgba(255,255,255,0.12)',
    gridBar: 'rgba(255,255,255,0.32)',
    note: '#4fc3f7',
    noteBorder: '#0b3b52',
    noteSel: '#ffb74d',
    noteOutScale: '#ce93d8',
    noteOutRange: '#ef5350',
    ghost: 'rgba(200,200,200,0.28)',
    ruler: '#14171d',
    rulerText: '#c9d1d9',
    chordBg: '#191d24',
    chordText: '#ffe082',
    loop: 'rgba(129,199,132,0.25)',
    playhead: '#ff5252',
    keyWhite: '#e8e8e8',
    keyBlack: '#30343c',
    selRect: 'rgba(255,183,77,0.18)',
  };

  class PianoRoll {
    constructor(canvas, wave, app) {
      this.cv = canvas;
      this.wv = wave;
      this.app = app;
      this.pxPerTick = 0.12;
      this.rowH = 14;
      this.scrollX = 0;
      this.scrollY = 0;
      this.mode = 'pen';
      this.pointers = new Map();
      this.g = null; // 進行中のジェスチャ
      this.rect = null;
      this.dirty = true;
      this.bind();
    }

    get p() {
      return this.app.project;
    }
    get mt() {
      return T.measureTicks(this.p.timeSig);
    }
    get viewStart() {
      return (this.p.view.from - 1) * this.mt;
    }
    get viewEnd() {
      return this.p.view.to * this.mt;
    }
    get gridTicks() {
      return T.GRIDS[this.p.ui.grid].ticks;
    }
    get width() {
      return this.cv.clientWidth;
    }
    get height() {
      return this.cv.clientHeight;
    }

    tickToX(t) {
      return KEY_W + (t - this.viewStart) * this.pxPerTick - this.scrollX;
    }
    xToTick(x) {
      return (x - KEY_W + this.scrollX) / this.pxPerTick + this.viewStart;
    }
    pitchToY(p) {
      return HEAD_H + (PMAX - p) * this.rowH - this.scrollY;
    }
    yToPitch(y) {
      return PMAX - Math.floor((y - HEAD_H + this.scrollY) / this.rowH);
    }

    clampScroll() {
      const cw = (this.viewEnd - this.viewStart) * this.pxPerTick;
      const ch = (PMAX - PMIN + 1) * this.rowH;
      this.scrollX = Math.max(0, Math.min(this.scrollX, cw - (this.width - KEY_W) + 40));
      this.scrollY = Math.max(0, Math.min(this.scrollY, ch - (this.height - HEAD_H)));
      if (cw < this.width - KEY_W) this.scrollX = 0;
    }

    // 楽器の音域が見えるように縦位置を合わせる
    centerOnRange() {
      const inst = this.p.instrument;
      const notes = PL.model.activeTrack(this.p).notes;
      let mid = (inst.low + inst.high) / 2;
      if (notes.length) mid = notes.reduce((a, n) => a + n.pitch, 0) / notes.length;
      this.scrollY = (PMAX - mid) * this.rowH - (this.height - HEAD_H) / 2;
      this.clampScroll();
      this.request();
    }

    fitWidth() {
      const ticks = Math.min(this.viewEnd - this.viewStart, this.mt * 4);
      this.pxPerTick = Math.max(0.02, (this.width - KEY_W - 10) / ticks);
      this.scrollX = 0;
      this.request();
    }

    zoom(f, cx) {
      cx = cx == null ? KEY_W + (this.width - KEY_W) / 2 : cx;
      const t = this.xToTick(cx);
      this.pxPerTick = Math.max(0.015, Math.min(1.5, this.pxPerTick * f));
      this.scrollX = (t - this.viewStart) * this.pxPerTick - (cx - KEY_W);
      this.clampScroll();
      this.request();
    }

    zoomY(f) {
      const cy = HEAD_H + (this.height - HEAD_H) / 2;
      const pitch = PMAX - (cy - HEAD_H + this.scrollY) / this.rowH;
      this.rowH = Math.max(7, Math.min(32, this.rowH * f));
      this.scrollY = (PMAX - pitch) * this.rowH - (cy - HEAD_H);
      this.clampScroll();
      this.request();
    }

    request() {
      this.dirty = true;
    }

    // ---- 描画 ----
    fitCanvas(cv) {
      const dpr = window.devicePixelRatio || 1;
      const w = cv.clientWidth;
      const h = cv.clientHeight;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
      }
      const ctx = cv.getContext('2d');
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      return ctx;
    }

    draw() {
      const p = this.p;
      const ctx = this.fitCanvas(this.cv);
      const W = this.width;
      const H = this.height;
      this.clampScroll();
      ctx.fillStyle = C.bg;
      ctx.fillRect(0, 0, W, H);

      const inst = p.instrument;
      const scale = p.ui.scaleGuide ? T.scalePcs(p.key) : null;
      const tonic = p.key.mode !== 'none' ? T.tonicPc(p.key) : -1;
      const pTop = Math.min(PMAX, this.yToPitch(HEAD_H));
      const pBot = Math.max(PMIN, this.yToPitch(H));
      const x0 = KEY_W;
      const xEnd = Math.min(W, this.tickToX(this.viewEnd));

      // 行
      for (let pi = pBot; pi <= pTop; pi++) {
        const y = this.pitchToY(pi);
        const pc = T.mod(pi, 12);
        let col = T.isBlackKey(pi) ? C.rowBlack : C.rowWhite;
        if (scale && scale.has(pc)) col = pc === tonic ? C.rowTonic : C.rowScale;
        ctx.fillStyle = col;
        ctx.fillRect(x0, y, xEnd - x0, this.rowH);
        if (pi < inst.low || pi > inst.high) {
          ctx.fillStyle = C.outRange;
          ctx.fillRect(x0, y, xEnd - x0, this.rowH);
        }
        if (pc === 0) {
          ctx.fillStyle = 'rgba(255,255,255,0.10)';
          ctx.fillRect(x0, y + this.rowH - 1, xEnd - x0, 1);
        }
      }

      // 縦線
      const grid = this.gridTicks;
      const beat = T.beatTicks(p.timeSig);
      const mt = this.mt;
      const tA = Math.max(this.viewStart, Math.floor(this.xToTick(KEY_W) / grid) * grid);
      const tB = Math.min(this.viewEnd, this.xToTick(W));
      const showSub = grid * this.pxPerTick >= 5;
      for (let t = tA; t <= tB; t += grid) {
        let col = null;
        if (T.mod(t, mt) === 0) col = C.gridBar;
        else if (T.mod(t, beat) === 0) col = C.gridBeat;
        else if (showSub) col = C.gridSub;
        if (!col) continue;
        const x = Math.round(this.tickToX(t)) + 0.5;
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.moveTo(x, HEAD_H);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      // 拍のグリッドが3連でない場合も拍線は描く
      if (T.mod(beat, grid) !== 0) {
        for (let t = Math.ceil(tA / beat) * beat; t <= tB; t += beat) {
          const x = Math.round(this.tickToX(t)) + 0.5;
          ctx.strokeStyle = T.mod(t, mt) === 0 ? C.gridBar : C.gridBeat;
          ctx.beginPath();
          ctx.moveTo(x, HEAD_H);
          ctx.lineTo(x, H);
          ctx.stroke();
        }
      }

      // 他トラック(ゴースト)
      const active = PL.model.activeTrack(p);
      if (p.ui.ghosts) {
        ctx.strokeStyle = C.ghost;
        ctx.lineWidth = 1;
        p.tracks.forEach((tr) => {
          if (tr === active) return;
          tr.notes.forEach((n) => {
            const r = this.noteRect(n);
            if (r.x + r.w < KEY_W || r.x > W || r.y + r.h < HEAD_H || r.y > H) return;
            ctx.strokeRect(r.x + 0.5, r.y + 1.5, r.w - 1, r.h - 3);
          });
        });
      }

      // ノート
      const sel = this.app.selection;
      ctx.font = `${Math.max(8, Math.min(12, this.rowH - 3))}px sans-serif`;
      ctx.textBaseline = 'middle';
      active.notes.forEach((n) => {
        const r = this.noteRect(n);
        if (r.x + r.w < KEY_W || r.x > W || r.y + r.h < HEAD_H || r.y > H) return;
        let col = C.note;
        if (scale && !scale.has(T.mod(n.pitch, 12))) col = C.noteOutScale;
        if (n.pitch < inst.low || n.pitch > inst.high) col = C.noteOutRange;
        if (sel.has(n.id)) col = C.noteSel;
        ctx.fillStyle = col;
        roundRect(ctx, r.x + 0.5, r.y + 1, Math.max(3, r.w - 1), r.h - 2, 3);
        ctx.fill();
        ctx.strokeStyle = C.noteBorder;
        ctx.stroke();
        // 右端のつまみ
        if (sel.has(n.id) && r.w > 14) {
          ctx.fillStyle = 'rgba(0,0,0,0.35)';
          ctx.fillRect(r.x + r.w - 6, r.y + 3, 3, r.h - 6);
        }
        let label = '';
        if (n.expr === 'scoop') label = '↗';
        else if (n.expr === 'fall') label = '↘';
        else if (n.expr === 'vibrato') label = '〜';
        if (r.w > 34 && this.rowH >= 11) label = (label ? label + ' ' : '') + T.pitchLabel(n.pitch, p.key.mode === 'none' ? 0 : p.key.fifths, p.key.mode);
        if (label && r.w > 12) {
          ctx.fillStyle = '#0d1b24';
          ctx.save();
          ctx.beginPath();
          ctx.rect(r.x, r.y, r.w - 6, r.h);
          ctx.clip();
          ctx.fillText(label, r.x + 4, r.y + r.h / 2 + 0.5);
          ctx.restore();
        }
      });

      // 範囲選択の枠
      if (this.rect) {
        const { x1, y1, x2, y2 } = this.rect;
        ctx.fillStyle = C.selRect;
        ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        ctx.strokeStyle = C.noteSel;
        ctx.strokeRect(Math.min(x1, x2) + 0.5, Math.min(y1, y2) + 0.5, Math.abs(x2 - x1), Math.abs(y2 - y1));
      }

      // 範囲外(表示小節の後ろ)
      if (xEnd < W) {
        ctx.fillStyle = '#101318';
        ctx.fillRect(xEnd, HEAD_H, W - xEnd, H - HEAD_H);
      }

      // ルーラー
      ctx.fillStyle = C.ruler;
      ctx.fillRect(0, 0, W, RULER_H);
      ctx.fillStyle = C.chordBg;
      ctx.fillRect(0, RULER_H, W, CHORD_H);
      const loop = p.loop;
      if (loop.on) {
        const lx1 = this.tickToX((loop.from - 1) * mt);
        const lx2 = this.tickToX(loop.to * mt);
        ctx.fillStyle = C.loop;
        ctx.fillRect(Math.max(KEY_W, lx1), 0, Math.max(0, lx2 - Math.max(KEY_W, lx1)), RULER_H);
      }
      ctx.font = '11px sans-serif';
      ctx.textBaseline = 'middle';
      const mFrom = Math.max(p.view.from, Math.floor(this.xToTick(KEY_W) / mt) + 1);
      const mTo = Math.min(p.view.to, Math.ceil(this.xToTick(W) / mt));
      for (let m = mFrom; m <= mTo; m++) {
        const x = this.tickToX((m - 1) * mt);
        ctx.strokeStyle = C.gridBar;
        ctx.beginPath();
        ctx.moveTo(Math.round(x) + 0.5, 0);
        ctx.lineTo(Math.round(x) + 0.5, HEAD_H);
        ctx.stroke();
        ctx.fillStyle = C.rulerText;
        ctx.fillText(String(m), x + 4, RULER_H / 2);
        const ch = p.chords[m];
        if (ch) {
          ctx.fillStyle = C.chordText;
          ctx.save();
          ctx.beginPath();
          ctx.rect(x, RULER_H, mt * this.pxPerTick, CHORD_H);
          ctx.clip();
          ctx.font = 'bold 12px sans-serif';
          ctx.fillText(ch, x + 4, RULER_H + CHORD_H / 2);
          ctx.restore();
        }
      }

      // 鍵盤
      ctx.fillStyle = '#111';
      ctx.fillRect(0, HEAD_H, KEY_W, H - HEAD_H);
      for (let pi = pBot; pi <= pTop; pi++) {
        const y = this.pitchToY(pi);
        const black = T.isBlackKey(pi);
        ctx.fillStyle = black ? C.keyBlack : C.keyWhite;
        ctx.fillRect(0, y, black ? KEY_W * 0.7 : KEY_W - 1, this.rowH - 1);
        if (T.mod(pi, 12) === 0 && this.rowH >= 8) {
          ctx.fillStyle = '#333';
          ctx.font = '10px sans-serif';
          ctx.fillText('C' + (pi / 12 - 1), KEY_W - 22, y + this.rowH / 2);
        }
      }
      ctx.fillStyle = C.ruler;
      ctx.fillRect(0, 0, KEY_W, HEAD_H);
      ctx.fillStyle = '#8b949e';
      ctx.font = '10px sans-serif';
      ctx.fillText('小節', 6, RULER_H / 2);
      ctx.fillText('コード', 4, RULER_H + CHORD_H / 2);

      // 再生位置
      const ph = this.app.transport.currentTick();
      const px = this.tickToX(ph);
      if (px >= KEY_W && px <= W) {
        ctx.strokeStyle = C.playhead;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(px, 0);
        ctx.lineTo(px, H);
        ctx.stroke();
        ctx.lineWidth = 1;
      }

      this.drawWave();
      this.dirty = false;
    }

    drawWave() {
      const cv = this.wv;
      if (!cv || !cv.clientWidth) return;
      const ctx = this.fitCanvas(cv);
      const W = cv.clientWidth;
      const H = cv.clientHeight;
      ctx.fillStyle = '#12151b';
      ctx.fillRect(0, 0, W, H);
      const tr = this.app.transport;
      const pk = tr.peaks;
      ctx.fillStyle = '#8b949e';
      ctx.font = '10px sans-serif';
      ctx.textBaseline = 'middle';
      if (!pk) {
        ctx.fillText(tr.hasAudio() ? '波形を解析中…' : '伴奏: 未読み込み(設定 → 伴奏音源)', KEY_W + 8, H / 2);
      } else {
        ctx.fillStyle = '#4db6ac';
        const mid = H / 2;
        for (let x = KEY_W; x < W; x++) {
          const s1 = tr.tickToSec(this.xToTick(x));
          const s2 = tr.tickToSec(this.xToTick(x + 1));
          let i1 = Math.floor(s1 * pk.rate);
          let i2 = Math.max(i1 + 1, Math.floor(s2 * pk.rate));
          if (i2 <= 0 || i1 >= pk.min.length) continue;
          i1 = Math.max(0, i1);
          i2 = Math.min(pk.min.length, i2);
          let lo = 0;
          let hi = 0;
          for (let i = i1; i < i2; i++) {
            if (pk.min[i] < lo) lo = pk.min[i];
            if (pk.max[i] > hi) hi = pk.max[i];
          }
          ctx.fillRect(x, mid - hi * mid, 1, Math.max(1, (hi - lo) * mid));
        }
      }
      const mt = this.mt;
      ctx.strokeStyle = 'rgba(255,255,255,0.18)';
      for (let m = this.p.view.from; m <= this.p.view.to + 1; m++) {
        const x = Math.round(this.tickToX((m - 1) * mt)) + 0.5;
        if (x < KEY_W || x > W) continue;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      ctx.fillStyle = '#0d1014';
      ctx.fillRect(0, 0, KEY_W, H);
      ctx.fillStyle = '#8b949e';
      ctx.fillText('伴奏', 8, H / 2);
      const px = this.tickToX(tr.currentTick());
      if (px >= KEY_W && px <= W) {
        ctx.fillStyle = C.playhead;
        ctx.fillRect(px - 1, 0, 2, H);
      }
    }

    noteRect(n) {
      const x = this.tickToX(n.start);
      return { x, y: this.pitchToY(n.pitch), w: n.dur * this.pxPerTick, h: this.rowH };
    }

    hitNote(x, y) {
      const notes = PL.model.activeTrack(this.p).notes;
      for (let i = notes.length - 1; i >= 0; i--) {
        const r = this.noteRect(notes[i]);
        const padX = r.w < 16 ? 4 : 0;
        if (x >= r.x - padX && x <= r.x + r.w + padX && y >= r.y && y <= r.y + r.h) return notes[i];
      }
      return null;
    }

    // 再生バーを画面内に保つ
    follow(tick) {
      const x = this.tickToX(tick);
      const W = this.width;
      if (x > W - 30 || x < KEY_W) {
        this.scrollX += x - (KEY_W + (W - KEY_W) * 0.15);
        this.clampScroll();
      }
    }

    // ---- 操作 ----
    bind() {
      const cv = this.cv;
      cv.style.touchAction = 'none';
      cv.addEventListener('pointerdown', (e) => this.onDown(e));
      cv.addEventListener('pointermove', (e) => this.onMove(e));
      cv.addEventListener('pointerup', (e) => this.onUp(e));
      cv.addEventListener('pointercancel', (e) => this.onUp(e, true));
      cv.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
      cv.addEventListener('contextmenu', (e) => e.preventDefault());
      if (this.wv) {
        this.wv.style.touchAction = 'none';
        let wDown = null;
        this.wv.addEventListener('pointerdown', (e) => {
          wDown = { x: e.clientX, sx: this.scrollX, moved: false };
          this.wv.setPointerCapture(e.pointerId);
        });
        this.wv.addEventListener('pointermove', (e) => {
          if (!wDown) return;
          const dx = e.clientX - wDown.x;
          if (Math.abs(dx) > 6) wDown.moved = true;
          if (wDown.moved) {
            this.scrollX = wDown.sx - dx;
            this.clampScroll();
            this.request();
          }
        });
        this.wv.addEventListener('pointerup', (e) => {
          if (wDown && !wDown.moved) {
            const x = e.clientX - this.wv.getBoundingClientRect().left;
            if (x > KEY_W) this.app.seek(Math.max(0, this.snap(this.xToTick(x))));
          }
          wDown = null;
        });
      }
    }

    local(e) {
      const r = this.cv.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    }

    snap(t) {
      const g = this.gridTicks;
      return Math.floor(t / g) * g;
    }

    onWheel(e) {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        this.zoom(e.deltaY < 0 ? 1.15 : 1 / 1.15, this.local(e).x);
        return;
      }
      if (e.altKey) {
        this.zoomY(e.deltaY < 0 ? 1.1 : 1 / 1.1);
        return;
      }
      if (e.shiftKey) this.scrollX += e.deltaY;
      else {
        this.scrollX += e.deltaX;
        this.scrollY += e.deltaY;
      }
      this.clampScroll();
      this.request();
    }

    onDown(e) {
      this.cv.setPointerCapture(e.pointerId);
      const pt = this.local(e);
      this.pointers.set(e.pointerId, pt);
      if (this.pointers.size === 2) {
        // ピンチで横方向ズーム
        this.cancelLongPress();
        const [a, b] = Array.from(this.pointers.values());
        this.g = {
          type: 'pinch',
          d0: Math.max(20, Math.abs(a.x - b.x)),
          d0y: Math.max(20, Math.abs(a.y - b.y)),
          ppt0: this.pxPerTick,
          rowH0: this.rowH,
          cx: (a.x + b.x) / 2,
          t: this.xToTick((a.x + b.x) / 2),
        };
        this.rect = null;
        return;
      }
      if (this.pointers.size > 2) return;
      const { x, y } = pt;
      const base = { x0: x, y0: y, sx0: this.scrollX, sy0: this.scrollY, moved: false };
      if (y < RULER_H) {
        this.g = { ...base, type: 'ruler' };
        this.app.seek(Math.max(0, this.snap(this.xToTick(x))));
        return;
      }
      if (y < HEAD_H) {
        this.g = { ...base, type: 'chord' };
        return;
      }
      if (x < KEY_W) {
        const pitch = this.yToPitch(y);
        this.app.preview(pitch);
        this.g = { ...base, type: 'keys' };
        return;
      }
      const hit = this.hitNote(x, y);
      if (hit) {
        const sel = this.app.selection;
        if (this.mode === 'select' && (e.shiftKey || sel.size)) {
          if (!sel.has(hit.id)) sel.add(hit.id);
        } else if (!sel.has(hit.id)) {
          sel.clear();
          sel.add(hit.id);
        }
        this.app.onSelectionChange();
        const r = this.noteRect(hit);
        const edge = Math.min(16, Math.max(8, r.w * 0.35));
        const type = x > r.x + r.w - edge ? 'resize' : 'move';
        const track = PL.model.activeTrack(this.p);
        const orig = new Map(track.notes.filter((n) => sel.has(n.id)).map((n) => [n.id, { start: n.start, dur: n.dur, pitch: n.pitch }]));
        this.g = { ...base, type, note: hit, orig, lastDT: 0, lastDP: 0, lastDD: 0, pushed: false, wasSelected: true };
        this.app.preview(hit.pitch);
        this.request();
        return;
      }
      if (this.mode === 'select') {
        this.g = { ...base, type: 'rect' };
        this.rect = { x1: x, y1: y, x2: x, y2: y };
        return;
      }
      this.g = { ...base, type: 'empty' };
      this.longTimer = setTimeout(() => {
        if (this.g && this.g.type === 'empty' && !this.g.moved) {
          this.g.type = 'rect';
          this.rect = { x1: x, y1: y, x2: x, y2: y };
          if (navigator.vibrate) navigator.vibrate(15);
          this.request();
        }
      }, 450);
    }

    cancelLongPress() {
      clearTimeout(this.longTimer);
    }

    onMove(e) {
      if (!this.pointers.has(e.pointerId)) return;
      const pt = this.local(e);
      this.pointers.set(e.pointerId, pt);
      const g = this.g;
      if (!g) return;
      if (g.type === 'pinch') {
        const pts = Array.from(this.pointers.values());
        if (pts.length < 2) return;
        const [a, b] = pts;
        const dx = Math.max(20, Math.abs(a.x - b.x));
        const dy = Math.max(20, Math.abs(a.y - b.y));
        if (dx >= dy) {
          this.pxPerTick = Math.max(0.015, Math.min(1.5, (g.ppt0 * dx) / g.d0));
          this.scrollX = (g.t - this.viewStart) * this.pxPerTick - (g.cx - KEY_W);
        } else {
          this.rowH = Math.max(7, Math.min(32, (g.rowH0 * dy) / g.d0y));
        }
        this.clampScroll();
        this.request();
        return;
      }
      const dx = pt.x - g.x0;
      const dy = pt.y - g.y0;
      if (!g.moved && Math.hypot(dx, dy) > 7) {
        g.moved = true;
        this.cancelLongPress();
      }
      if (!g.moved) return;
      switch (g.type) {
        case 'ruler':
          this.app.seek(Math.max(0, this.snap(this.xToTick(pt.x))));
          break;
        case 'empty':
        case 'pan':
          g.type = 'pan';
          this.scrollX = g.sx0 - dx;
          this.scrollY = g.sy0 - dy;
          this.clampScroll();
          break;
        case 'rect': {
          this.rect.x2 = pt.x;
          this.rect.y2 = pt.y;
          this.selectInRect();
          break;
        }
        case 'move': {
          const grid = this.gridTicks;
          let dT = Math.round(dx / (grid * this.pxPerTick)) * grid;
          const dP = Math.round(-dy / this.rowH);
          let minStart = Infinity;
          g.orig.forEach((o) => (minStart = Math.min(minStart, o.start)));
          if (minStart + dT < 0) dT = -minStart;
          if (dT === g.lastDT && dP === g.lastDP) break;
          if (!g.pushed) {
            this.app.beginEdit();
            g.pushed = true;
          }
          const track = PL.model.activeTrack(this.p);
          track.notes.forEach((n) => {
            const o = g.orig.get(n.id);
            if (!o) return;
            n.start = o.start + dT;
            n.pitch = Math.max(PMIN, Math.min(PMAX, o.pitch + dP));
          });
          if (dP !== g.lastDP) this.app.preview(g.note.pitch);
          g.lastDT = dT;
          g.lastDP = dP;
          this.app.liveEdit();
          break;
        }
        case 'resize': {
          const grid = this.gridTicks;
          const dD = Math.round(dx / (grid * this.pxPerTick)) * grid;
          if (dD === g.lastDD) break;
          if (!g.pushed) {
            this.app.beginEdit();
            g.pushed = true;
          }
          const track = PL.model.activeTrack(this.p);
          track.notes.forEach((n) => {
            const o = g.orig.get(n.id);
            if (!o) return;
            n.dur = Math.max(Math.min(grid, o.dur), o.dur + dD);
          });
          g.lastDD = dD;
          this.app.liveEdit();
          break;
        }
      }
      this.request();
    }

    selectInRect() {
      const { x1, y1, x2, y2 } = this.rect;
      const L = Math.min(x1, x2);
      const R = Math.max(x1, x2);
      const Tp = Math.min(y1, y2);
      const B = Math.max(y1, y2);
      const sel = this.app.selection;
      if (!this.rect.base) this.rect.base = new Set(sel);
      sel.clear();
      this.rect.base.forEach((id) => sel.add(id));
      PL.model.activeTrack(this.p).notes.forEach((n) => {
        const r = this.noteRect(n);
        if (r.x < R && r.x + r.w > L && r.y < B && r.y + r.h > Tp) sel.add(n.id);
      });
      this.app.onSelectionChange();
    }

    onUp(e, cancelled) {
      this.pointers.delete(e.pointerId);
      this.cancelLongPress();
      const g = this.g;
      if (!g) return;
      if (g.type === 'pinch') {
        if (this.pointers.size === 0) this.g = null;
        return;
      }
      this.g = null;
      if (cancelled) {
        this.rect = null;
        this.request();
        return;
      }
      const sel = this.app.selection;
      if (g.type === 'chord' && !g.moved) {
        const m = Math.floor(this.xToTick(g.x0) / this.mt) + 1;
        if (m >= this.p.view.from && m <= this.p.view.to) this.app.editChord(m);
      } else if (g.type === 'empty' && !g.moved) {
        if (sel.size) {
          sel.clear();
          this.app.onSelectionChange();
        } else {
          const tick = this.snap(this.xToTick(g.x0));
          const pitch = this.yToPitch(g.y0);
          if (tick >= this.viewStart && tick < this.viewEnd && pitch >= PMIN && pitch <= PMAX) this.app.addNote(tick, pitch);
        }
      } else if (g.type === 'rect') {
        if (!g.moved && !this.rect.base) {
          sel.clear();
          this.app.onSelectionChange();
        }
        this.rect = null;
      } else if ((g.type === 'move' || g.type === 'resize') && g.pushed) {
        this.app.commitEdit();
      }
      this.request();
    }
  }

  function roundRect(ctx, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  PL.PianoRoll = PianoRoll;
  PL.PianoRoll.KEY_W = KEY_W;
})();
