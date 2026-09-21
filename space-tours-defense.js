/*!
 * Space Tours Defense v1.0.0
 * An embeddable, dependency-free arcade widget: escort the tour liner to Neptune.
 *
 * https://github.com/kat-bal/space-tours-defense
 * MIT License, (c) 2026 Calvera Solutions
 *
 * Usage:
 *   <div data-space-tours-game></div>
 *   <script src="space-tours-defense.js"></script>
 *
 * Everything lives in a shadow root, so the host page's CSS cannot reach in and
 * the widget's CSS cannot leak out. Colors are inherited from the host page's
 * custom properties (--gold, --ember, --pulse, --bg ...) when they exist, and
 * fall back to the Calvera palette when they do not.
 */
(function (global) {
  'use strict';

  var VERSION = '1.0.0';
  var STORAGE_KEY = 'space-tours-defense:highscore';

  /* ----------------------------------------------------------------------
     Sprites. One character per pixel, 'X' is solid, '.' is empty. They are
     rasterised once per size/color into an offscreen canvas (see spriteCache).
     ---------------------------------------------------------------------- */

  var SPRITES = {
    escort: [
      '.....X.....',
      '....XXX....',
      '....XXX....',
      '..XXXXXXX..',
      '.XXXXXXXXX.',
      'XXXXXXXXXXX',
      'XX.XXXXX.XX',
      'X...X.X...X'
    ],
    // Light raider, bottom rows, cheapest.
    raiderC: [
      ['..X..X..',
       '..XXXX..',
       '.XXXXXX.',
       'XX.XX.XX',
       'XXXXXXXX',
       '.X.XX.X.',
       'X......X',
       '.X....X.'],
      ['..X..X..',
       '..XXXX..',
       '.XXXXXX.',
       'XX.XX.XX',
       'XXXXXXXX',
       '..X..X..',
       '.X.XX.X.',
       'X.X..X.X']
    ],
    // Mid raider.
    raiderB: [
      ['.X.......X.',
       '..X.....X..',
       '..XXXXXXX..',
       '.XX.XXX.XX.',
       'XXXXXXXXXXX',
       'X.XXXXXXX.X',
       'X.X.....X.X',
       '...XX.XX...'],
      ['.X.......X.',
       '..XXXXXXX..',
       '.XX.XXX.XX.',
       'XXXXXXXXXXX',
       'X.XXXXXXX.X',
       'X.X.....X.X',
       '..X.....X..',
       '.X.......X.']
    ],
    // Heavy raider, top row, worth the most.
    raiderA: [
      ['....XXXX....',
       '.XXXXXXXXXX.',
       'XXXXXXXXXXXX',
       'XXX.XXXX.XXX',
       'XXXXXXXXXXXX',
       '..XX.XX.XX..',
       '.XX......XX.',
       '..X......X..'],
      ['....XXXX....',
       '.XXXXXXXXXX.',
       'XXXXXXXXXXXX',
       'XXX.XXXX.XXX',
       'XXXXXXXXXXXX',
       '..XX.XX.XX..',
       '.X........X.',
       'XX........XX']
    ],
    // Salvage barge: crosses the top for bonus points.
    barge: [
      '.....XXXXXX.....',
      '..XXXXXXXXXXXX..',
      '.XXXXXXXXXXXXXX.',
      'XX.XX.XX.XX.XXXX',
      'XXXXXXXXXXXXXXXX',
      '..XXX..XX..XXX..',
      '...X........X...'
    ],
    // The tour liner you are escorting. Parked along the bottom edge.
    liner: [
      '.......XXXXXXXXXXXXXX.......',
      '....XXXXXXXXXXXXXXXXXXXX....',
      '..XXXXXXXXXXXXXXXXXXXXXXXX..',
      'XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      'XXXXXXXXXXXXXXXXXXXXXXXXXXXX',
      '.XXXX..XXXXXXXXXXXXXX..XXXX.',
      '..XX....XX........XX....XX..'
    ],
    // Destructible cargo pod, used as cover.
    pod: [
      '....XXXXXXXXXXXXXX....',
      '..XXXXXXXXXXXXXXXXXX..',
      '.XXXXXXXXXXXXXXXXXXXX.',
      'XXXXXXXXXXXXXXXXXXXXXX',
      'XXXXXXXXXXXXXXXXXXXXXX',
      'XXXXXXXXXXXXXXXXXXXXXX',
      'XXXXXXXXXXXXXXXXXXXXXX',
      'XXXXXXXXXXXXXXXXXXXXXX',
      'XXXXXXXXXXXXXXXXXXXXXX',
      'XXXXXXXXXXXXXXXXXXXXXX',
      'XXXXXXXXX....XXXXXXXXX',
      'XXXXXXX........XXXXXXX',
      'XXXXXX..........XXXXXX',
      'XXXXX............XXXXX'
    ]
  };

  // The liner leaves Earth orbit and works outwards, so the waves are the
  // Space Tours destination list in order of distance from the sun, with the
  // departure in front of it. After Neptune the run loops with meaner numbers.
  var DESTINATIONS = ['Earth orbit', 'Mercury', 'Venus', 'Mars', 'Jupiter',
                      'Saturn', 'Uranus', 'Neptune'];

  /* ----------------------------------------------------------------------
     Small helpers
     ---------------------------------------------------------------------- */

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
  function rand(lo, hi) { return lo + Math.random() * (hi - lo); }
  function randInt(lo, hi) { return Math.floor(rand(lo, hi + 1)); }
  function pick(arr) { return arr[randInt(0, arr.length - 1)]; }

  function overlaps(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  }

  function readStore(key) {
    try { return global.localStorage.getItem(key); } catch (e) { return null; }
  }
  function writeStore(key, value) {
    try { global.localStorage.setItem(key, value); } catch (e) { /* private mode */ }
  }

  function prefersReducedMotion() {
    try { return global.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }

  /* ----------------------------------------------------------------------
     Sprite rasteriser. Sprites are drawn as whole pixels so they stay crisp at
     every widget size; the cache is keyed by sprite + color + pixel size and
     thrown away whenever the widget is resized.
     ---------------------------------------------------------------------- */

  function SpriteCache() { this.map = {}; }

  SpriteCache.prototype.get = function (key, rows, color, px) {
    var cached = this.map[key + '|' + color + '|' + px];
    if (cached) return cached;

    var cols = rows[0].length;
    var cv = document.createElement('canvas');
    cv.width = cols * px;
    cv.height = rows.length * px;
    var ctx = cv.getContext('2d');
    ctx.fillStyle = color;
    for (var y = 0; y < rows.length; y++) {
      var row = rows[y];
      for (var x = 0; x < cols; x++) {
        if (row.charAt(x) === 'X') ctx.fillRect(x * px, y * px, px, px);
      }
    }
    this.map[key + '|' + color + '|' + px] = cv;
    return cv;
  };

  SpriteCache.prototype.clear = function () { this.map = {}; };

  /* ----------------------------------------------------------------------
     Cargo pod: a bunker that erodes pixel by pixel. The canvas is what gets
     drawn; the parallel mask array is what collisions are tested against, so
     no getImageData readback is needed during play.
     ---------------------------------------------------------------------- */

  function Pod(x, y, px, color) {
    var rows = SPRITES.pod;
    this.w = rows[0].length * px;
    this.h = rows.length * px;
    this.x = x;
    this.y = y;
    this.canvas = document.createElement('canvas');
    this.canvas.width = this.w;
    this.canvas.height = this.h;
    this.mask = new Uint8Array(this.w * this.h);

    var ctx = this.canvas.getContext('2d');
    ctx.fillStyle = color;
    for (var ry = 0; ry < rows.length; ry++) {
      for (var rx = 0; rx < rows[ry].length; rx++) {
        if (rows[ry].charAt(rx) !== 'X') continue;
        ctx.fillRect(rx * px, ry * px, px, px);
        for (var dy = 0; dy < px; dy++) {
          for (var dx = 0; dx < px; dx++) {
            this.mask[(ry * px + dy) * this.w + (rx * px + dx)] = 1;
          }
        }
      }
    }
    this.ctx = ctx;
  }

  // Is there still material at this point of the playfield?
  Pod.prototype.solidAt = function (wx, wy) {
    var lx = Math.floor(wx - this.x);
    var ly = Math.floor(wy - this.y);
    if (lx < 0 || ly < 0 || lx >= this.w || ly >= this.h) return false;
    return this.mask[ly * this.w + lx] === 1;
  };

  // Blow a ragged hole around the impact point.
  Pod.prototype.damage = function (wx, wy, radius) {
    var cx = Math.floor(wx - this.x);
    var cy = Math.floor(wy - this.y);
    var r2 = radius * radius;
    for (var y = cy - radius; y <= cy + radius; y++) {
      if (y < 0 || y >= this.h) continue;
      for (var x = cx - radius; x <= cx + radius; x++) {
        if (x < 0 || x >= this.w) continue;
        var d2 = (x - cx) * (x - cx) + (y - cy) * (y - cy);
        // The jitter keeps the edges chewed rather than perfectly circular.
        if (d2 > r2 * rand(0.55, 1)) continue;
        this.mask[y * this.w + x] = 0;
      }
    }
    this.ctx.save();
    this.ctx.globalCompositeOperation = 'destination-out';
    this.ctx.beginPath();
    this.ctx.arc(cx, cy, radius * 0.85, 0, Math.PI * 2);
    this.ctx.fill();
    this.ctx.restore();
  };

  /* ----------------------------------------------------------------------
     Sound: a few synthesised blips. No audio files, and no AudioContext is
     created until the player actually interacts with the widget.
     ---------------------------------------------------------------------- */

  function Sound() {
    this.enabled = false;
    this.ctx = null;
  }

  Sound.prototype.ensure = function () {
    if (this.ctx || !this.enabled) return;
    var Ctx = global.AudioContext || global.webkitAudioContext;
    if (!Ctx) return;
    try { this.ctx = new Ctx(); } catch (e) { this.ctx = null; }
  };

  Sound.prototype.blip = function (freq, duration, type, volume) {
    if (!this.enabled) return;
    this.ensure();
    if (!this.ctx) return;
    if (this.ctx.state === 'suspended') this.ctx.resume();
    var now = this.ctx.currentTime;
    var osc = this.ctx.createOscillator();
    var gain = this.ctx.createGain();
    osc.type = type || 'square';
    osc.frequency.setValueAtTime(freq, now);
    gain.gain.setValueAtTime(volume == null ? 0.05 : volume, now);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    osc.connect(gain);
    gain.connect(this.ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  };

  Sound.prototype.shoot = function () { this.blip(660, 0.08, 'square', 0.04); };
  Sound.prototype.hit = function () { this.blip(180, 0.14, 'sawtooth', 0.05); };
  Sound.prototype.bonus = function () { this.blip(880, 0.22, 'triangle', 0.06); };
  Sound.prototype.step = function (n) { this.blip(90 + n * 18, 0.06, 'square', 0.025); };
  Sound.prototype.death = function () { this.blip(70, 0.5, 'sawtooth', 0.07); };

  /* ----------------------------------------------------------------------
     Widget shell: markup and styles for the shadow root.
     ---------------------------------------------------------------------- */

  var STYLE = [
    ':host{display:block;contain:content;}',
    '.root{',
    '  --c-bg:var(--bg,#0a0f1c);',
    '  --c-line:var(--line,#263252);',
    '  --c-text:var(--text,#eef1f7);',
    '  --c-muted:var(--text-muted-solid,#96a3c2);',
    '  --c-gold:var(--gold,#f7b955);',
    '  --c-ember:var(--ember,#f0812e);',
    '  --c-pulse:var(--pulse,#7ec8ff);',
    '  --c-pulse-dim:var(--pulse-dim,#5a86ad);',
    '  --c-danger:var(--danger,#ff6b6b);',
    '  --c-ok:var(--ok,#5fd68a);',
    '  position:relative;display:block;width:100%;height:100%;container-type:inline-size;',
    '  background:var(--c-bg);color:var(--c-text);',
    '  border:1px solid var(--c-line);border-radius:14px;overflow:hidden;',
    '  font-family:inherit;line-height:1.45;',
    '  -webkit-tap-highlight-color:transparent;touch-action:none;',
    '}',
    '.root:focus-visible{outline:2px solid var(--c-gold);outline-offset:2px;}',
    'canvas{display:block;width:100%;height:100%;image-rendering:pixelated;}',
    '.overlay{position:absolute;inset:0;z-index:1;display:flex;align-items:center;justify-content:center;',
    '  padding:20px;text-align:center;background:rgba(10,15,28,.82);',
    '  background:color-mix(in srgb,var(--c-bg) 82%,transparent);backdrop-filter:blur(2px);}',
    '.overlay[data-mode="attract"]{background:rgba(10,15,28,.42);',
    '  background:color-mix(in srgb,var(--c-bg) 42%,transparent);backdrop-filter:none;}',
    '.overlay[data-mode="attract"] .panel{background:rgba(10,15,28,.72);',
    '  background:color-mix(in srgb,var(--c-bg) 78%,transparent);',
    '  border:1px solid var(--c-line);border-radius:12px;padding:18px 20px;}',
    '.overlay[hidden]{display:none;}',
    '.panel{max-width:34ch;}',
    '.eyebrow{margin:0 0 6px;font-size:11px;letter-spacing:.16em;text-transform:uppercase;',
    '  color:var(--c-gold);font-weight:700;}',
    '.title{margin:0 0 8px;font-size:clamp(20px,4.4cqw,30px);line-height:1.1;font-weight:800;',
    '  letter-spacing:-.01em;}',
    '.lede{margin:0 0 16px;font-size:14px;color:var(--c-muted);}',
    '.btn{appearance:none;border:0;cursor:pointer;font:inherit;font-weight:700;font-size:14px;',
    '  padding:11px 20px;border-radius:999px;background:var(--c-gold);color:#14110a;',
    '  transition:transform .12s ease,filter .12s ease;}',
    '.btn:hover{filter:brightness(1.08);transform:translateY(-1px);}',
    '.btn:focus-visible{outline:2px solid var(--c-text);outline-offset:3px;}',
    '.hint{margin:14px 0 0;font-size:12px;color:var(--c-muted);}',
    '.hint kbd{font:inherit;font-size:11px;background:var(--c-line);border-radius:4px;',
    '  padding:1px 6px;}',
    '.credit{margin:12px 0 0;font-size:11px;color:var(--c-muted);}',
    '.credit a{color:var(--c-muted);}',
    '.tools{position:absolute;z-index:3;top:10px;right:10px;display:flex;gap:6px;}',
    '.tool{appearance:none;cursor:pointer;font:inherit;font-size:10px;letter-spacing:.1em;',
    '  text-transform:uppercase;padding:5px 9px;border-radius:999px;color:var(--c-muted);',
    '  background:rgba(10,15,28,.7);',
    '  background:color-mix(in srgb,var(--c-bg) 70%,transparent);border:1px solid var(--c-line);}',
    '.tool:hover{color:var(--c-text);border-color:var(--c-pulse-dim);}',
    '.tool:focus-visible{outline:2px solid var(--c-gold);outline-offset:2px;}',
    '.touch{position:absolute;z-index:2;left:0;right:0;bottom:0;display:none;gap:10px;padding:10px;',
    '  justify-content:space-between;align-items:flex-end;}',
    '.root[data-touch="1"] .touch{display:flex;height:86px;align-items:center;}',
    '.root[data-touch="1"] canvas{height:calc(100% - 86px);}',
    '.touch button{appearance:none;font:inherit;font-weight:700;font-size:15px;cursor:pointer;',
    '  min-width:62px;padding:14px 10px;border-radius:12px;color:var(--c-text);',
    '  background:rgba(10,15,28,.55);',
    '  background:color-mix(in srgb,var(--c-bg) 55%,transparent);border:1px solid var(--c-line);}',
    '.touch .fire{color:var(--c-gold);border-color:var(--c-gold);flex:1;max-width:180px;}',
    '.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);',
    '  clip-path:inset(50%);white-space:nowrap;}',
    '@media (prefers-reduced-motion:reduce){.btn{transition:none;}}'
  ].join('\n');

  var MARKUP = [
    '<div class="root" tabindex="0" role="application" aria-label="Space Tours Defense, an arcade game" data-testid="game-root">',
    '  <canvas data-testid="game-canvas"></canvas>',
    '  <div class="tools">',
    '    <button class="tool" type="button" data-testid="game-btn-sound" aria-pressed="false">Sound off</button>',
    '    <button class="tool" type="button" data-testid="game-btn-pause" hidden>Pause</button>',
    '  </div>',
    '  <div class="overlay" data-testid="game-overlay">',
    '    <div class="panel">',
    '      <p class="eyebrow" data-testid="game-eyebrow"></p>',
    '      <h2 class="title" data-testid="game-title"></h2>',
    '      <p class="lede" data-testid="game-lede"></p>',
    '      <button class="btn" type="button" data-testid="game-btn-start"></button>',
    '      <p class="hint" data-testid="game-hint"></p>',
    '      <p class="credit" data-testid="game-credit" hidden></p>',
    '    </div>',
    '  </div>',
    '  <div class="touch" data-testid="game-touch">',
    '    <button type="button" class="left" data-testid="game-btn-left" aria-label="Move left">&#9664;</button>',
    '    <button type="button" class="fire" data-testid="game-btn-fire" aria-label="Fire">FIRE</button>',
    '    <button type="button" class="right" data-testid="game-btn-right" aria-label="Move right">&#9654;</button>',
    '  </div>',
    '  <p class="sr" aria-live="polite" data-testid="game-status"></p>',
    '</div>'
  ].join('\n');

  /* ----------------------------------------------------------------------
     Game
     ---------------------------------------------------------------------- */

  var DEFAULTS = {
    attract: true,      // play itself until someone takes over
    sound: false,       // never make noise uninvited
    lives: 3,
    aspect: '4 / 3',    // only used when the host element has no height of its own
    title: 'Space Tours Defense',
    creditLabel: null,
    creditHref: null
  };

  function Game(host, options) {
    var opts = {};
    for (var k in DEFAULTS) { if (DEFAULTS.hasOwnProperty(k)) opts[k] = DEFAULTS[k]; }
    for (var o in options) { if (options.hasOwnProperty(o) && options[o] != null) opts[o] = options[o]; }
    this.opts = opts;

    this.host = host;
    this.shadow = host.attachShadow ? host.attachShadow({ mode: 'open' }) : host;

    var style = document.createElement('style');
    style.textContent = STYLE;
    var holder = document.createElement('div');
    holder.innerHTML = MARKUP;
    this.shadow.appendChild(style);
    this.shadow.appendChild(holder.firstChild);

    var $ = this.$ = function (sel) { return this.shadow.querySelector(sel); }.bind(this);
    this.root = $('.root');
    this.canvas = $('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.overlay = $('.overlay');
    this.elEyebrow = $('.eyebrow');
    this.elTitle = $('.title');
    this.elLede = $('.lede');
    this.elStart = $('.btn');
    this.elHint = $('.hint');
    this.elCredit = $('.credit');
    this.elSound = $('[data-testid="game-btn-sound"]');
    this.elPause = $('[data-testid="game-btn-pause"]');
    this.elStatus = $('.sr');

    this.ownsAspect = !host.style.height && !host.getAttribute('data-no-aspect');
    this.autoAspect = !(options && options.aspect);
    if (this.ownsAspect) host.style.aspectRatio = opts.aspect;
    if (opts.creditLabel) {
      this.elCredit.hidden = false;
      this.elCredit.innerHTML = opts.creditHref
        ? 'Built by <a href="' + opts.creditHref + '" target="_blank" rel="noopener">' + opts.creditLabel + '</a>'
        : 'Built by ' + opts.creditLabel;
    }

    this.sprites = new SpriteCache();
    this.sound = new Sound();
    this.sound.enabled = !!opts.sound && !opts.attract;
    this.reducedMotion = prefersReducedMotion();
    this.highScore = parseInt(readStore(STORAGE_KEY), 10) || 0;

    this.keys = {};
    this.touch = { left: false, right: false, fire: false, aimX: null };
    this.state = 'idle';
    this.visible = true;
    this.hasFocusPause = false;
    this.lastFrame = 0;
    this.w = 0;
    this.h = 0;

    this.readPalette();
    this.bindEvents();
    this.resize();
    this.reset(this.opts.attract ? 'attract' : 'title');
    this.loop = this.loop.bind(this);
    this.raf = requestAnimationFrame(this.loop);
  }

  Game.prototype.readPalette = function () {
    var cs = getComputedStyle(this.root);
    function v(name, fallback) {
      var out = cs.getPropertyValue(name);
      return (out && out.trim()) || fallback;
    }
    this.palette = {
      bg: v('--c-bg', '#0a0f1c'),
      line: v('--c-line', '#263252'),
      text: v('--c-text', '#eef1f7'),
      muted: v('--c-muted', '#96a3c2'),
      gold: v('--c-gold', '#f7b955'),
      ember: v('--c-ember', '#f0812e'),
      pulse: v('--c-pulse', '#7ec8ff'),
      pulseDim: v('--c-pulse-dim', '#5a86ad'),
      danger: v('--c-danger', '#ff6b6b'),
      ok: v('--c-ok', '#5fd68a')
    };
  };

  /* ---------------- layout ---------------- */

  Game.prototype.resize = function () {
    if (this.ownsAspect && this.autoAspect) {
      // Width does not depend on the aspect we set, so this settles in one pass.
      var want = this.root.getBoundingClientRect().width < 480 ? '3 / 4' : '4 / 3';
      if (this.host.style.aspectRatio !== want) this.host.style.aspectRatio = want;
    }
    var rect = this.canvas.getBoundingClientRect();
    var w = Math.max(240, Math.round(rect.width));
    var h = Math.max(200, Math.round(rect.height));
    if (w === this.w && h === this.h) return;

    this.w = w;
    this.h = h;
    var dpr = Math.min(global.devicePixelRatio || 1, 2);
    this.canvas.width = Math.round(w * dpr);
    this.canvas.height = Math.round(h * dpr);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;

    // One sprite pixel, in CSS pixels. Everything else is a multiple of it, so
    // the art stays on a whole-pixel grid at any widget size.
    this.px = clamp(Math.round(Math.min(w / 260, h / 200)), 2, 6);
    var px = this.px;

    this.margin = 6 * px;
    this.hudSize = Math.max(11, Math.round(3.4 * px));
    this.hudIconPx = Math.max(2, Math.round(px * 0.7));
    this.hudH = this.margin + this.hudSize * 1.5 +
      SPRITES.escort.length * this.hudIconPx + 8 +
      (w < 560 ? this.hudSize + 5 : 0);
    this.cellW = 16 * px;
    this.cellH = 13 * px;
    this.cols = clamp(Math.floor((w - 2 * this.margin) / this.cellW) - 1, 5, 11);
    this.rowCount = 5;
    // The liner is drawn much larger than the rest of the art and sits half
    // off the bottom edge, so only its upper decks are on screen.
    this.linerPx = clamp(Math.round(w / 40), px, px * 8);
    this.linerH = 4 * this.linerPx;
    this.linerY = h - this.linerH;
    this.playerY = this.linerY - 4 * px;   // baseline the escort flies along
    this.podY = this.playerY - 24 * px;
    this.sprites.clear();
    this.makeStars();
    this.layoutWave(true);
  };

  Game.prototype.makeStars = function () {
    var count = this.reducedMotion ? 22 : Math.round(this.w * this.h / 9000);
    this.stars = [];
    for (var i = 0; i < count; i++) {
      this.stars.push({
        x: rand(0, this.w),
        y: rand(0, this.h),
        z: rand(0.25, 1),
        tw: rand(0, Math.PI * 2)
      });
    }
  };

  /* ---------------- wave setup ---------------- */

  Game.prototype.reset = function (mode) {
    this.score = 0;
    this.lives = this.opts.lives;
    this.nextExtraLife = 3000;
    this.startWave(1);
    this.setState(mode || 'title');
  };

  Game.prototype.startWave = function (n) {
    this.wave = n;
    this.bullets = [];
    this.bolts = [];
    this.particles = [];
    this.barge = null;
    this.bargeTimer = rand(9, 18);
    this.fireTimer = rand(0.8, 1.8);
    this.stepTimer = 0;
    this.stepPhase = 0;
    this.dir = 1;
    this.respawn = 0;
    this.waveBanner = 2.2;
    this.layoutWave(true);
  };

  // rebuild=true starts the wave over; on a resize it is called again so the
  // formation and the cargo pods land on the new pixel grid.
  Game.prototype.layoutWave = function (rebuild) {
    if (this.wave == null) return;
    var px = this.px;

    if (rebuild || !this.raiders) {
      this.raiders = [];
      for (var row = 0; row < this.rowCount; row++) {
        var type = row === 0 ? 'raiderA' : (row < 3 ? 'raiderB' : 'raiderC');
        var value = row === 0 ? 30 : (row < 3 ? 20 : 10);
        for (var col = 0; col < this.cols; col++) {
          this.raiders.push({ row: row, col: col, type: type, value: value, alive: true });
        }
      }
    } else {
      // Keep the kills, drop any raider whose column no longer exists.
      this.raiders = this.raiders.filter(function (r) { return r.col < this.cols; }, this);
    }

    var formationW = this.cols * this.cellW;
    this.fx = Math.round((this.w - formationW) / 2);
    this.fy = Math.round(Math.max(this.hudH, this.h * 0.09) +
      Math.min(this.wave - 1, 5) * this.cellH * 0.35);
    this.dropDist = Math.round(this.cellH * 0.34);

    this.player = {
      x: this.player ? clamp(this.player.x, this.margin, this.w - this.margin) : this.w / 2,
      w: SPRITES.escort[0].length * px,
      h: SPRITES.escort.length * px,
      speed: 105 * px,
      cooldown: 0,
      dead: 0
    };

    this.pods = [];
    var podW = SPRITES.pod[0].length * px;
    var podCount = this.w < 420 ? 3 : 4;
    var gap = (this.w - 2 * this.margin - podCount * podW) / (podCount - 1);
    for (var i = 0; i < podCount; i++) {
      this.pods.push(new Pod(
        Math.round(this.margin + i * (podW + gap)),
        this.podY,
        px,
        this.palette.pulseDim
      ));
    }
  };

  Game.prototype.raiderRect = function (r) {
    var rows = SPRITES[r.type][0];
    var w = rows[0].length * this.px;
    var h = rows.length * this.px;
    return {
      x: this.fx + r.col * this.cellW + (this.cellW - w) / 2,
      y: this.fy + r.row * this.cellH,
      w: w,
      h: h
    };
  };

  Game.prototype.aliveRaiders = function () {
    return this.raiders.filter(function (r) { return r.alive; });
  };

  /* ---------------- state ---------------- */

  Game.prototype.setState = function (state) {
    this.state = state;
    var playing = state === 'playing';
    this.overlay.hidden = playing;
    this.overlay.dataset.mode = state;
    this.elPause.hidden = !playing;
    this.elPause.textContent = 'Pause';
    if (state === 'attract') this.sound.enabled = false;
    this.updateOverlay();
  };

  Game.prototype.updateOverlay = function () {
    var s = this.state;
    var hi = this.highScore ? ' \u00b7 best ' + this.highScore : '';
    if (s === 'attract') {
      this.elEyebrow.textContent = 'Demo running';
      this.elTitle.textContent = this.opts.title;
      this.elLede.textContent = 'Escort the tour liner. Nothing gets past you.';
      this.elStart.textContent = 'Take the controls';
      this.elHint.innerHTML = '<kbd>&larr;</kbd> <kbd>&rarr;</kbd> to move, <kbd>Space</kbd> to fire' + hi;
    } else if (s === 'title') {
      this.elEyebrow.textContent = 'Escort duty';
      this.elTitle.textContent = this.opts.title;
      this.elLede.textContent = 'Eight stops out to Neptune. The liner behind you has passengers on it.';
      this.elStart.textContent = 'Start escort';
      this.elHint.innerHTML = '<kbd>&larr;</kbd> <kbd>&rarr;</kbd> to move, <kbd>Space</kbd> to fire' + hi;
    } else if (s === 'paused') {
      this.elEyebrow.textContent = 'Holding position';
      this.elTitle.textContent = 'Paused';
      this.elLede.textContent = 'Wave ' + this.wave + ' \u00b7 ' + this.score + ' points';
      this.elStart.textContent = 'Resume';
      this.elHint.innerHTML = '<kbd>P</kbd> also resumes';
    } else if (s === 'over') {
      var reached = DESTINATIONS[(this.wave - 1) % DESTINATIONS.length];
      this.elEyebrow.textContent = 'Escort lost';
      this.elTitle.textContent = this.score + ' points';
      this.elLede.innerHTML = 'You made it to ' + reached + ' on wave ' + this.wave +
        '.<br>Best run so far: ' + this.highScore + '.';
      this.elStart.textContent = 'Fly again';
      this.elHint.innerHTML = '<kbd>Space</kbd> also restarts';
    }
  };

  Game.prototype.say = function (text) { this.elStatus.textContent = text; };

  Game.prototype.startPlaying = function () {
    if (this.state === 'paused') {
      this.setState('playing');
      this.root.focus({ preventScroll: true });
      return;
    }
    this.reset('playing');
    this.sound.enabled = !!this.opts.sound;
    this.elSound.setAttribute('aria-pressed', String(this.sound.enabled));
    this.elSound.textContent = this.sound.enabled ? 'Sound on' : 'Sound off';
    this.root.focus({ preventScroll: true });
    this.say('Escort started. Wave 1, ' + DESTINATIONS[0] + '.');
  };

  Game.prototype.togglePause = function () {
    if (this.state === 'playing') { this.setState('paused'); }
    else if (this.state === 'paused') { this.setState('playing'); }
  };

  Game.prototype.gameOver = function () {
    if (this.score > this.highScore) {
      this.highScore = this.score;
      writeStore(STORAGE_KEY, String(this.score));
    }
    if (this.state === 'attract') {
      // The demo just restarts itself.
      this.attractRestart = 1.6;
      return;
    }
    this.sound.death();
    this.setState('over');
    this.say('Escort lost on wave ' + this.wave + ' with ' + this.score + ' points.');
  };

  /* ---------------- input ---------------- */

  Game.prototype.bindEvents = function () {
    var self = this;

    if (global.ResizeObserver) {
      this.ro = new ResizeObserver(function () { self.resize(); });
      this.ro.observe(this.root);
    } else {
      this.onWinResize = function () { self.resize(); };
      global.addEventListener('resize', this.onWinResize);
    }

    // A widget that keeps animating out of view is a widget that drains a
    // laptop battery for nothing.
    if (global.IntersectionObserver) {
      this.io = new IntersectionObserver(function (entries) {
        self.visible = entries[0].isIntersecting;
      }, { threshold: 0.05 });
      this.io.observe(this.root);
    }

    try {
      if (global.matchMedia('(pointer: coarse)').matches) this.root.setAttribute('data-touch', '1');
    } catch (e) { /* ignore */ }

    this.onBlur = function () { if (self.state === 'playing') self.setState('paused'); };
    global.addEventListener('blur', this.onBlur);

    this.root.addEventListener('keydown', function (e) {
      var k = e.key;
      if (k === ' ' || k === 'Spacebar' || k === 'ArrowLeft' || k === 'ArrowRight' ||
          k === 'ArrowUp' || k === 'ArrowDown') {
        e.preventDefault();
      }
      if (k === 'p' || k === 'P') { self.togglePause(); return; }
      if (k === 'm' || k === 'M') { self.toggleSound(); return; }
      if (k === 'Escape' && self.state === 'playing') { self.setState('paused'); return; }
      if ((k === ' ' || k === 'Enter') && self.state !== 'playing') { self.startPlaying(); return; }
      // Latch the shot: a tap shorter than a frame would otherwise be dropped.
      if (k === ' ' || k === 'Spacebar' || k === 'Enter') self.firePressed = true;
      self.keys[k] = true;
    });

    this.root.addEventListener('keyup', function (e) { self.keys[e.key] = false; });

    this.elStart.addEventListener('click', function () { self.startPlaying(); });
    this.overlay.addEventListener('click', function (e) {
      // Only the backdrop; the start button has its own handler.
      if (e.target === self.overlay && self.state !== 'playing') self.startPlaying();
    });
    this.elPause.addEventListener('click', function () { self.togglePause(); });
    this.elSound.addEventListener('click', function () { self.toggleSound(); });

    // Pointer: drag anywhere on the playfield to steer, hold to fire.
    var dragging = false;
    this.canvas.addEventListener('pointerdown', function (e) {
      if (self.state !== 'playing') { self.startPlaying(); return; }
      dragging = true;
      self.canvas.setPointerCapture(e.pointerId);
      self.touch.aimX = e.offsetX;
      self.touch.fire = true;
      self.firePressed = true;
    });
    this.canvas.addEventListener('pointermove', function (e) {
      if (dragging) self.touch.aimX = e.offsetX;
    });
    var release = function () { dragging = false; self.touch.fire = false; self.touch.aimX = null; };
    this.canvas.addEventListener('pointerup', release);
    this.canvas.addEventListener('pointercancel', release);

    function holdButton(sel, prop) {
      var el = self.shadow.querySelector(sel);
      el.addEventListener('pointerdown', function (e) {
        e.preventDefault();
        if (self.state !== 'playing') { self.startPlaying(); return; }
        self.touch[prop] = true;
        // Same latch as the keyboard: a tap can be shorter than a frame.
        if (prop === 'fire') self.firePressed = true;
      });
      ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (evt) {
        el.addEventListener(evt, function () { self.touch[prop] = false; });
      });
    }
    holdButton('[data-testid="game-btn-left"]', 'left');
    holdButton('[data-testid="game-btn-right"]', 'right');
    holdButton('[data-testid="game-btn-fire"]', 'fire');
  };

  Game.prototype.toggleSound = function () {
    this.sound.enabled = !this.sound.enabled;
    this.elSound.textContent = this.sound.enabled ? 'Sound on' : 'Sound off';
    this.elSound.setAttribute('aria-pressed', String(this.sound.enabled));
    if (this.sound.enabled) this.sound.blip(520, 0.08, 'triangle', 0.04);
  };

  Game.prototype.destroy = function () {
    cancelAnimationFrame(this.raf);
    if (this.ro) this.ro.disconnect();
    if (this.io) this.io.disconnect();
    if (this.onWinResize) global.removeEventListener('resize', this.onWinResize);
    global.removeEventListener('blur', this.onBlur);
  };

  /* ---------------- simulation ---------------- */

  Game.prototype.loop = function (ts) {
    this.raf = requestAnimationFrame(this.loop);
    var dt = this.lastFrame ? Math.min((ts - this.lastFrame) / 1000, 0.05) : 0;
    this.lastFrame = ts;
    if (!this.visible) return;
    this.update(dt);
    this.draw();
  };

  Game.prototype.update = function (dt) {
    this.updateStars(dt);
    this.updateParticles(dt);
    this.updatePopups(dt);
    if (this.shake > 0) this.shake = Math.max(0, this.shake - dt * 40);
    if (this.state === 'playing' || this.state === 'attract') this.simulate(dt);
  };

  Game.prototype.updateStars = function (dt) {
    var speed = this.reducedMotion ? 4 : 14;
    for (var i = 0; i < this.stars.length; i++) {
      var s = this.stars[i];
      s.y += speed * s.z * dt * this.px;
      s.tw += dt * 2 * s.z;
      if (s.y > this.h) { s.y = -2; s.x = rand(0, this.w); }
    }
  };

  Game.prototype.updateParticles = function (dt) {
    for (var i = this.particles.length - 1; i >= 0; i--) {
      var p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 140 * dt;
    }
  };

  Game.prototype.burst = function (x, y, color, count, power) {
    if (this.reducedMotion) count = Math.ceil(count / 3);
    for (var i = 0; i < count; i++) {
      this.particles.push({
        x: x, y: y,
        vx: rand(-1, 1) * power, vy: rand(-1, 0.6) * power,
        life: rand(0.25, 0.7), color: color, size: this.px
      });
    }
  };

  Game.prototype.simulate = function (dt) {
    if (this.attractRestart > 0) {
      this.attractRestart -= dt;
      if (this.attractRestart <= 0) { this.attractRestart = 0; this.reset('attract'); }
      return;
    }
    if (this.waveBanner > 0) this.waveBanner -= dt;

    var input = this.state === 'attract' ? this.aiInput(dt) : this.humanInput();

    if (this.player.dead > 0) {
      this.player.dead -= dt;
      if (this.player.dead <= 0) {
        this.player.dead = 0;
        this.player.x = this.w / 2;
        this.bolts = [];
      }
    } else {
      this.updatePlayer(dt, input);
    }

    this.updateFormation(dt);
    this.updateShots(dt);
    this.updateBarge(dt);
    this.checkWaveCleared();
  };

  Game.prototype.humanInput = function () {
    var k = this.keys;
    var move = 0;
    if (k.ArrowLeft || k.a || k.A) move -= 1;
    if (k.ArrowRight || k.d || k.D) move += 1;
    if (this.touch.left) move -= 1;
    if (this.touch.right) move += 1;
    var fire = !!(k[' '] || k.Spacebar || k.Enter || this.touch.fire || this.firePressed);
    this.firePressed = false;
    return { move: move, fire: fire, aimX: this.touch.aimX };
  };

  // Attract-mode pilot. Deliberately a bit sloppy: it hesitates, aims with an
  // offset and only sometimes dodges, so the demo run actually ends.
  Game.prototype.aiInput = function (dt) {
    var p = this.player;
    this.aiTimer = (this.aiTimer || 0) - dt;
    if (this.aiTimer <= 0) {
      this.aiJitter = rand(-1, 1) * this.cellW * 0.4;
      this.aiDodge = Math.random() < 0.72;
      this.aiTimer = rand(0.3, 0.85);
    }

    var alive = this.aliveRaiders();
    var target = null, bestScore = -Infinity;
    for (var i = 0; i < alive.length; i++) {
      var rect = this.raiderRect(alive[i]);
      var cx = rect.x + rect.w / 2;
      var score = alive[i].row * 100 - Math.abs(cx - p.x) * 0.15;
      if (score > bestScore) { bestScore = score; target = rect; }
    }

    var tx = target ? target.x + target.w / 2 + this.aiJitter : this.w / 2;

    if (this.aiDodge) {
      for (var b = 0; b < this.bolts.length; b++) {
        var bolt = this.bolts[b];
        if (bolt.y < p.y - 90 * this.px) continue;
        if (Math.abs(bolt.x - p.x) > 8 * this.px) continue;
        tx = p.x + (bolt.x < p.x ? 1 : -1) * 22 * this.px;
        break;
      }
    }

    var dx = tx - p.x;
    var move = Math.abs(dx) > 3 * this.px ? (dx > 0 ? 1 : -1) : 0;
    var fire = !!target && Math.abs(dx) < this.cellW * 0.45;
    return { move: move, fire: fire, aimX: null };
  };

  Game.prototype.updatePlayer = function (dt, input) {
    var p = this.player;
    if (input.aimX != null) {
      var d = input.aimX - p.x;
      var max = p.speed * dt * 1.6;
      p.x += clamp(d, -max, max);
    } else if (input.move) {
      p.x += input.move * p.speed * dt;
    }
    p.x = clamp(p.x, this.margin + p.w / 2, this.w - this.margin - p.w / 2);

    p.cooldown -= dt;
    if (input.fire && p.cooldown <= 0 && this.bullets.length < 2) {
      this.bullets.push({ x: p.x, y: this.playerY - p.h, w: this.px, h: 4 * this.px });
      p.cooldown = 0.3;
      this.sound.shoot();
    }
  };

  Game.prototype.updateFormation = function (dt) {
    var alive = this.aliveRaiders();
    if (!alive.length) return;

    var total = this.cols * this.rowCount;
    var frac = alive.length / total;
    var speedUp = 1 + (this.wave - 1) * 0.13;
    var interval = (0.055 + 0.6 * frac * frac) / speedUp;

    this.stepTimer -= dt;
    if (this.stepTimer > 0) return;
    this.stepTimer = interval;
    this.stepPhase++;
    this.sound.step(this.stepPhase % 4);

    var minCol = Infinity, maxCol = -Infinity;
    for (var i = 0; i < alive.length; i++) {
      if (alive[i].col < minCol) minCol = alive[i].col;
      if (alive[i].col > maxCol) maxCol = alive[i].col;
    }

    var step = this.dir * Math.max(2, Math.round(2 * this.px));
    var nextLeft = this.fx + step + minCol * this.cellW;
    var nextRight = this.fx + step + (maxCol + 1) * this.cellW;

    if (nextRight > this.w - this.margin || nextLeft < this.margin) {
      this.dir *= -1;
      this.fy += this.dropDist;
    } else {
      this.fx += step;
    }

    // Boarded: a raider is level with the escort lane, so the liner is lost.
    var lowest = -Infinity;
    for (var j = 0; j < alive.length; j++) {
      var r = this.raiderRect(alive[j]);
      if (r.y + r.h > lowest) lowest = r.y + r.h;
    }
    if (lowest >= this.playerY - 3 * this.px) {
      this.lives = 0;
      this.burst(this.w / 2, this.linerY, this.palette.danger, 40, 220);
      this.gameOver();
    }

    // Raider fire comes from whoever is at the bottom of a column.
    this.fireTimer -= interval;
    if (this.fireTimer <= 0) {
      this.fireTimer = rand(0.5, 1.5) / (1 + (this.wave - 1) * 0.16);
      var bottoms = {};
      for (var k = 0; k < alive.length; k++) {
        var a = alive[k];
        if (!bottoms[a.col] || a.row > bottoms[a.col].row) bottoms[a.col] = a;
      }
      var cols = Object.keys(bottoms);
      if (cols.length) {
        var shooter = bottoms[pick(cols)];
        var sr = this.raiderRect(shooter);
        this.bolts.push({
          x: sr.x + sr.w / 2, y: sr.y + sr.h,
          w: this.px, h: 4 * this.px, phase: 0
        });
      }
    }
  };

  Game.prototype.updateShots = function (dt) {
    var i, j, k;
    var bulletSpeed = 300 * this.px;
    var boltSpeed = (115 + this.wave * 7) * this.px;

    for (i = this.bullets.length - 1; i >= 0; i--) {
      var b = this.bullets[i];
      b.y -= bulletSpeed * dt;
      if (b.y + b.h < 0) { this.bullets.splice(i, 1); continue; }
      if (this.hitPods(b.x, b.y, 4 * this.px)) { this.bullets.splice(i, 1); continue; }

      var consumed = false;

      // Shooting an incoming bolt out of the air is allowed, and satisfying.
      for (j = this.bolts.length - 1; j >= 0; j--) {
        var bo = this.bolts[j];
        if (Math.abs(bo.x - b.x) < 3 * this.px && Math.abs(bo.y - b.y) < 5 * this.px) {
          this.bolts.splice(j, 1);
          this.burst(b.x, b.y, this.palette.gold, 6, 60);
          consumed = true;
          break;
        }
      }
      if (consumed) { this.bullets.splice(i, 1); continue; }

      if (this.barge && overlaps(b, this.barge)) {
        this.score += this.barge.value;
        this.burst(this.barge.x + this.barge.w / 2, this.barge.y, this.palette.ok, 26, 150);
        this.popup(this.barge.x + this.barge.w / 2, this.barge.y, '+' + this.barge.value);
        this.barge = null;
        this.bullets.splice(i, 1);
        this.sound.bonus();
        this.say('Salvage barge down.');
        continue;
      }

      var alive = this.aliveRaiders();
      for (k = 0; k < alive.length; k++) {
        var rect = this.raiderRect(alive[k]);
        if (!overlaps(b, rect)) continue;
        alive[k].alive = false;
        this.score += alive[k].value;
        this.burst(rect.x + rect.w / 2, rect.y + rect.h / 2, this.palette.ember, 12, 110);
        this.bullets.splice(i, 1);
        this.sound.hit();
        this.checkExtraLife();
        break;
      }
    }

    for (i = this.bolts.length - 1; i >= 0; i--) {
      var bolt = this.bolts[i];
      bolt.y += boltSpeed * dt;
      bolt.phase += dt * 18;
      if (bolt.y > this.h) { this.bolts.splice(i, 1); continue; }
      if (this.hitPods(bolt.x, bolt.y + bolt.h, 5 * this.px)) { this.bolts.splice(i, 1); continue; }

      if (this.player.dead <= 0) {
        var pr = {
          x: this.player.x - this.player.w / 2, y: this.playerY - this.player.h,
          w: this.player.w, h: this.player.h
        };
        if (overlaps(bolt, pr)) {
          this.bolts.splice(i, 1);
          this.hitPlayer();
        }
      }
    }
  };

  Game.prototype.hitPods = function (x, y, radius) {
    for (var i = 0; i < this.pods.length; i++) {
      var pod = this.pods[i];
      if (x < pod.x || x > pod.x + pod.w || y < pod.y || y > pod.y + pod.h) continue;
      // Walk a few pixels around the tip so a shot cannot slip through a seam.
      for (var dy = -2; dy <= 2; dy++) {
        for (var dx = -2; dx <= 2; dx++) {
          if (!pod.solidAt(x + dx, y + dy)) continue;
          pod.damage(x, y, radius);
          this.burst(x, y, this.palette.pulseDim, 5, 50);
          return true;
        }
      }
    }
    return false;
  };

  Game.prototype.hitPlayer = function () {
    this.lives--;
    this.burst(this.player.x, this.playerY - this.player.h / 2, this.palette.pulse, 26, 160);
    if (!this.reducedMotion) this.shake = 10;
    this.sound.death();
    if (this.lives <= 0) { this.gameOver(); return; }
    this.player.dead = 1.2;
    this.say(this.lives + ' escort ' + (this.lives === 1 ? 'ship' : 'ships') + ' left.');
  };

  Game.prototype.checkExtraLife = function () {
    if (this.score < this.nextExtraLife) return;
    this.nextExtraLife += 3000;
    this.lives++;
    this.sound.bonus();
    this.popup(this.w / 2, this.h * 0.45, 'EXTRA ESCORT');
    this.say('Extra escort ship earned.');
  };

  Game.prototype.popup = function (x, y, text) {
    this.popups = this.popups || [];
    this.popups.push({ x: x, y: y, text: text, life: 1.1 });
  };

  Game.prototype.updateBarge = function (dt) {
    if (this.barge) {
      this.barge.x += this.barge.vx * dt;
      if (this.barge.x > this.w + 10 || this.barge.x + this.barge.w < -10) this.barge = null;
      return;
    }
    this.bargeTimer -= dt;
    if (this.bargeTimer > 0 || this.aliveRaiders().length < 4) return;
    this.bargeTimer = rand(14, 26);
    var rows = SPRITES.barge;
    var w = rows[0].length * this.px;
    var h = rows.length * this.px;
    var fromLeft = Math.random() < 0.5;
    this.barge = {
      x: fromLeft ? -w : this.w,
      y: Math.round(this.h * 0.045),
      w: w, h: h,
      vx: (fromLeft ? 1 : -1) * 48 * this.px,
      value: pick([50, 100, 150, 300])
    };
  };

  Game.prototype.checkWaveCleared = function () {
    if (this.aliveRaiders().length) return;
    this.score += 100 + this.wave * 25;
    var next = this.wave + 1;
    var dest = DESTINATIONS[(next - 1) % DESTINATIONS.length];
    this.startWave(next);
    this.say('Wave ' + next + ', ' + dest + '.');
  };

  Game.prototype.updatePopups = function (dt) {
    if (!this.popups) return;
    for (var i = this.popups.length - 1; i >= 0; i--) {
      var p = this.popups[i];
      p.life -= dt;
      p.y -= 26 * dt;
      if (p.life <= 0) this.popups.splice(i, 1);
    }
  };

  /* ---------------- drawing ---------------- */

  var MONO = 'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace';

  Game.prototype.blit = function (key, rows, color, x, y, px) {
    var img = this.sprites.get(key, rows, color, px || this.px);
    this.ctx.drawImage(img, Math.round(x), Math.round(y));
  };

  Game.prototype.draw = function () {
    var ctx = this.ctx, pal = this.palette;

    ctx.save();
    if (this.shake > 0) {
      ctx.translate(rand(-1, 1) * this.shake * 0.35, rand(-1, 1) * this.shake * 0.35);
    }

    ctx.fillStyle = pal.bg;
    ctx.fillRect(-20, -20, this.w + 40, this.h + 40);

    this.drawStars();
    this.drawLiner();
    this.drawPods();
    this.drawRaiders();
    this.drawBarge();
    this.drawPlayer();
    this.drawShots();
    this.drawParticles();
    this.drawPopups();

    ctx.restore();

    this.drawHud();
    this.drawBanner();
  };

  Game.prototype.drawStars = function () {
    var ctx = this.ctx;
    ctx.fillStyle = this.palette.text;
    for (var i = 0; i < this.stars.length; i++) {
      var s = this.stars[i];
      ctx.globalAlpha = 0.12 + 0.45 * s.z * (0.75 + 0.25 * Math.sin(s.tw));
      var size = s.z > 0.75 ? 2 : 1;
      ctx.fillRect(Math.round(s.x), Math.round(s.y), size, size);
    }
    ctx.globalAlpha = 1;
  };

  Game.prototype.drawLiner = function () {
    var ctx = this.ctx, lp = this.linerPx;
    var rows = SPRITES.liner;
    var w = rows[0].length * lp;
    var x = Math.round((this.w - w) / 2);

    // A soft wash under the liner so it reads as something large and lit.
    var grad = ctx.createLinearGradient(0, this.linerY - 18 * this.px, 0, this.h);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, this.palette.line);
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = grad;
    ctx.fillRect(0, this.linerY - 18 * this.px, this.w, this.h - this.linerY + 18 * this.px);
    ctx.globalAlpha = 1;

    this.blit('liner', rows, this.palette.pulseDim, x, this.linerY, lp);

    // Lit portholes along the visible deck.
    ctx.fillStyle = this.palette.gold;
    var rowY = this.linerY + 2 * lp;
    for (var i = 3; i <= 24; i += 3) {
      ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin((this.lastFrame / 900) + i));
      ctx.fillRect(x + i * lp, rowY, lp, lp);
    }
    ctx.globalAlpha = 1;
  };

  Game.prototype.drawPods = function () {
    for (var i = 0; i < this.pods.length; i++) {
      var pod = this.pods[i];
      this.ctx.drawImage(pod.canvas, pod.x, pod.y);
    }
  };

  Game.prototype.drawRaiders = function () {
    var frame = this.stepPhase % 2;
    var colors = {
      raiderA: this.palette.gold,
      raiderB: this.palette.ember,
      raiderC: this.palette.pulseDim
    };
    for (var i = 0; i < this.raiders.length; i++) {
      var r = this.raiders[i];
      if (!r.alive) continue;
      var rect = this.raiderRect(r);
      this.blit(r.type + frame, SPRITES[r.type][frame], colors[r.type], rect.x, rect.y);
    }
  };

  Game.prototype.drawBarge = function () {
    if (!this.barge) return;
    this.blit('barge', SPRITES.barge, this.palette.ok, this.barge.x, this.barge.y);
  };

  Game.prototype.drawPlayer = function () {
    var p = this.player;
    if (p.dead > 0) {
      // Blink the lane while the replacement escort moves up.
      if (Math.floor(p.dead * 10) % 2 === 0) return;
    }
    this.blit('escort', SPRITES.escort, this.palette.pulse, p.x - p.w / 2, this.playerY - p.h);
  };

  Game.prototype.drawShots = function () {
    var ctx = this.ctx, i;
    ctx.fillStyle = this.palette.text;
    for (i = 0; i < this.bullets.length; i++) {
      var b = this.bullets[i];
      ctx.fillRect(Math.round(b.x), Math.round(b.y), b.w, b.h);
    }
    ctx.fillStyle = this.palette.danger;
    for (i = 0; i < this.bolts.length; i++) {
      var bo = this.bolts[i];
      var wobble = Math.round(Math.sin(bo.phase) * this.px);
      ctx.fillRect(Math.round(bo.x + wobble), Math.round(bo.y), bo.w, bo.h);
    }
  };

  Game.prototype.drawParticles = function () {
    var ctx = this.ctx;
    for (var i = 0; i < this.particles.length; i++) {
      var p = this.particles[i];
      ctx.globalAlpha = clamp(p.life * 2, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
    }
    ctx.globalAlpha = 1;
  };

  Game.prototype.drawPopups = function () {
    if (!this.popups || !this.popups.length) return;
    var ctx = this.ctx;
    ctx.font = '700 ' + Math.round(3.4 * this.px) + 'px ' + MONO;
    ctx.textAlign = 'center';
    for (var i = 0; i < this.popups.length; i++) {
      var p = this.popups[i];
      ctx.globalAlpha = clamp(p.life, 0, 1);
      ctx.fillStyle = this.palette.gold;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
  };

  Game.prototype.drawHud = function () {
    var ctx = this.ctx, px = this.px, pal = this.palette;
    var size = this.hudSize;
    ctx.font = '700 ' + size + 'px ' + MONO;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'left';

    ctx.fillStyle = pal.muted;
    ctx.fillText('SCORE', this.margin, this.margin);
    ctx.fillStyle = pal.text;
    ctx.fillText(String(this.score), this.margin + size * 4, this.margin);

    // Remaining escorts, drawn as the ships themselves.
    var iconPx = this.hudIconPx;
    var iconW = SPRITES.escort[0].length * iconPx;
    var iconY = this.margin + size * 1.5;
    for (var i = 0; i < Math.min(this.lives, 6); i++) {
      this.blit('escort', SPRITES.escort, pal.pulse,
        this.margin + i * (iconW + 3 * iconPx), iconY, iconPx);
    }

    var dest = DESTINATIONS[(this.wave - 1) % DESTINATIONS.length];
    var label = 'WAVE ' + this.wave + '  ' + dest.toUpperCase();
    ctx.fillStyle = pal.muted;
    if (this.w < 560) {
      // Too narrow to centre it without running into the sound and pause buttons.
      ctx.fillText(label, this.margin, iconY + SPRITES.escort.length * iconPx + 5);
    } else {
      ctx.textAlign = 'center';
      ctx.fillText(label, this.w / 2, this.margin);
      ctx.textAlign = 'left';
    }
    ctx.textBaseline = 'alphabetic';
  };

  Game.prototype.drawBanner = function () {
    if (!(this.waveBanner > 0) || this.state === 'attract') return;
    var ctx = this.ctx, px = this.px;
    var alpha = clamp(this.waveBanner / 0.6, 0, 1);
    var dest = DESTINATIONS[(this.wave - 1) % DESTINATIONS.length];
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.fillStyle = this.palette.gold;
    ctx.font = '800 ' + Math.round(7 * px) + 'px ' + MONO;
    ctx.fillText(dest.toUpperCase(), this.w / 2, this.h * 0.42);
    ctx.fillStyle = this.palette.muted;
    ctx.font = '700 ' + Math.round(3.2 * px) + 'px ' + MONO;
    ctx.fillText('WAVE ' + this.wave, this.w / 2, this.h * 0.42 + 6 * px);
    ctx.restore();
  };

  /* ----------------------------------------------------------------------
     Mounting
     ---------------------------------------------------------------------- */

  function optionsFromDataset(el) {
    var d = el.dataset || {};
    var o = {};
    if (d.attract != null) o.attract = !(d.attract === 'false' || d.attract === 'off');
    if (d.sound != null) o.sound = (d.sound === 'true' || d.sound === 'on');
    if (d.lives) o.lives = clamp(parseInt(d.lives, 10) || 3, 1, 9);
    if (d.aspect) o.aspect = d.aspect;
    if (d.title) o.title = d.title;
    if (d.creditLabel) o.creditLabel = d.creditLabel;
    if (d.creditHref) o.creditHref = d.creditHref;
    return o;
  }

  function mount(target, options) {
    var el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error('SpaceToursDefense: mount target not found');
    if (el.__spaceToursDefense) return el.__spaceToursDefense;
    var merged = optionsFromDataset(el);
    for (var k in options) { if (options.hasOwnProperty(k)) merged[k] = options[k]; }
    var game = new Game(el, merged);
    el.__spaceToursDefense = game;
    return game;
  }

  function autoMount() {
    var nodes = document.querySelectorAll('[data-space-tours-game]');
    for (var i = 0; i < nodes.length; i++) mount(nodes[i]);
    return nodes.length;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', autoMount);
  } else {
    autoMount();
  }

  global.SpaceToursDefense = { mount: mount, autoMount: autoMount, version: VERSION };

})(typeof window !== 'undefined' ? window : this);
