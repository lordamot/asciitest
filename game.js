'use strict';

(function () {

  // ───────────────────────────────────────────────────────────────────────
  //  CANVAS / GRID
  // ───────────────────────────────────────────────────────────────────────
  const CHAR_W = 10;
  const CHAR_H = 18;
  const COLS = 100;
  const ROWS = 34;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  canvas.width = COLS * CHAR_W;
  canvas.height = ROWS * CHAR_H;

  const FONT = '16px "Cascadia Mono", "Fira Code", "JetBrains Mono", "Source Code Pro", "Consolas", "Menlo", monospace';
  ctx.font = FONT;
  ctx.textBaseline = 'top';
  ctx.textAlign = 'center';

  function putChar(col, row, ch, color) {
    if (!ch || ch === ' ') return;
    ctx.fillStyle = color;
    ctx.fillText(ch, col * CHAR_W + CHAR_W / 2, row * CHAR_H + 1);
  }
  function putString(col, row, str, color) {
    for (let i = 0; i < str.length; i++) putChar(col + i, row, str[i], color);
  }
  function putSprite(col, row, lines, color) {
    for (let r = 0; r < lines.length; r++) putString(col, row + r, lines[r], color);
  }
  function putSpriteColored(col, row, lines, colorRows) {
    for (let r = 0; r < lines.length; r++) {
      const color = Array.isArray(colorRows) ? colorRows[r] : colorRows;
      putString(col, row + r, lines[r], color);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  //  WORLD LAYOUT
  // ───────────────────────────────────────────────────────────────────────
  // FLOOR_Y is the row of the floor's top edge.  Player feet sit on FLOOR_Y-1.
  const FLOOR_Y = [6, 18, 30];   // top, middle, bottom
  const FLOOR_LEFT = 1;
  const FLOOR_RIGHT = COLS - 2;

  const LADDERS = [
    { x: 22, top: 6,  bottom: 18 },
    { x: 70, top: 6,  bottom: 18 },
    { x: 38, top: 18, bottom: 30 },
    { x: 84, top: 18, bottom: 30 },
  ];

  // Trees / bushes / etc., positioned so they sit on a given floor.
  const TREES = [
    { x: 8,  floorIdx: 2, kind: 'pine' },
    { x: 50, floorIdx: 2, kind: 'round' },
    { x: 92, floorIdx: 2, kind: 'pine' },
    { x: 15, floorIdx: 1, kind: 'round' },
    { x: 56, floorIdx: 1, kind: 'pine' },
    { x: 90, floorIdx: 1, kind: 'round' },
    { x: 10, floorIdx: 0, kind: 'pine' },
    { x: 80, floorIdx: 0, kind: 'round' },
  ];
  const BUSHES = [
    { x: 18, floorIdx: 2 }, { x: 30, floorIdx: 2 },
    { x: 60, floorIdx: 2 }, { x: 76, floorIdx: 2 },
    { x: 26, floorIdx: 1 }, { x: 45, floorIdx: 1 },
    { x: 76, floorIdx: 1 }, { x: 4,  floorIdx: 1 },
    { x: 20, floorIdx: 0 }, { x: 70, floorIdx: 0 },
  ];
  const ROCKS = [
    { x: 42, floorIdx: 2 }, { x: 88, floorIdx: 2 },
    { x: 64, floorIdx: 1 }, { x: 30, floorIdx: 0 },
  ];

  // Chest sits at top floor, key floats next to it.
  const CHEST = { x: 44, floorIdx: 0 };
  const KEY   = { x: 52, floorIdx: 0, collected: false };

  // ───────────────────────────────────────────────────────────────────────
  //  STARFIELD + MOON
  // ───────────────────────────────────────────────────────────────────────
  const STAR_CHARS = ['·', '·', '+', '*', '✦', '·'];
  const STARS = [];
  for (let i = 0; i < 70; i++) {
    STARS.push({
      x: Math.random() * COLS,
      y: Math.random() * 5.5,
      ch: STAR_CHARS[(Math.random() * STAR_CHARS.length) | 0],
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 1.5,
    });
  }

  const MOON = { x: 82, y: 1 };
  const MOON_SPRITE = [
    '  ╭───╮ ',
    ' (  ◔  )',
    '  ╰───╯ ',
  ];

  // ───────────────────────────────────────────────────────────────────────
  //  PARALLAX HORIZON  (mountains + distant tree silhouettes)
  // ───────────────────────────────────────────────────────────────────────
  // Two repeating horizon strips scrolled at different rates based on
  // player.x — far things move less than near things.  Strips are longer
  // than COLS so wrap-around is invisible at any shift.
  const MOUNTAIN_TOP =
    '   ▲            ▲▲              ▲▲▲              ▲              ▲▲              ▲▲▲▲              ▲▲           ▲▲▲           ▲        ▲▲             ▲           ▲▲▲       ';
  const MOUNTAIN_BOT =
    ' ▲▲▲▲▲        ▲▲▲▲▲▲▲▲        ▲▲▲▲▲▲▲▲▲         ▲▲▲▲▲▲        ▲▲▲▲▲▲▲▲         ▲▲▲▲▲▲▲▲▲▲▲       ▲▲▲▲         ▲▲▲▲▲▲▲        ▲▲▲▲▲     ▲▲▲▲▲▲▲        ▲▲▲▲▲       ▲▲▲▲▲▲▲▲  ';
  const FAR_TREES =
    '  ♠   ♣       ♠ ♠    ♣ ♠   ♣       ♠ ♠ ♣        ♠    ♠ ♠    ♣ ♠       ♠   ♣   ♠ ♠ ♣       ♠   ♣ ♠       ♠ ♣  ♠ ♠    ♠   ♣ ♠      ♠     ♣ ♠   ♠ ♣      ';

  // ───────────────────────────────────────────────────────────────────────
  //  DRIFTING CLOUDS (independent animation)
  // ───────────────────────────────────────────────────────────────────────
  const CLOUD_SHAPES = [
    ['  ╭▒▒▒╮  ',
     ' ╰══════╯'],
    [' ╭══╮ ',
     '╰▒▒▒▒╯'],
    [' ╭▒▒▒▒╮  ',
     '╰══════╯ '],
  ];
  const CLOUDS = [];
  for (let i = 0; i < 5; i++) {
    CLOUDS.push({
      x: Math.random() * COLS - 4,
      y: 0 + ((Math.random() * 3) | 0),
      speed: 0.6 + Math.random() * 1.4,
      shape: (Math.random() * CLOUD_SHAPES.length) | 0,
      colors: Math.random() < 0.5
        ? ['#3a4360', '#262c40']
        : ['#4a526e', '#2f3650'],
    });
  }

  // ───────────────────────────────────────────────────────────────────────
  //  SHOOTING STARS, FIREFLIES, BATS
  // ───────────────────────────────────────────────────────────────────────
  const SHOOTING_STARS = [];
  const BATS = [];

  const FIREFLIES = [];
  for (let i = 0; i < 16; i++) {
    FIREFLIES.push({
      cx: 4 + Math.random() * (COLS - 8),
      cy: 8 + Math.random() * 20,
      rx: 2 + Math.random() * 5,
      ry: 1 + Math.random() * 2,
      phase: Math.random() * Math.PI * 2,
      pSpeed: 0.5 + Math.random() * 1.2,
      blinkOff: Math.random() * Math.PI * 2,
    });
  }

  // Tree sway phase
  let windPhase = 0;


  // ───────────────────────────────────────────────────────────────────────
  //  PLAYER
  // ───────────────────────────────────────────────────────────────────────
  // The player sprite is 3 rows tall, 3 cols wide.  `x` and `y` are the
  // top-left cell of the sprite (floats so motion looks smooth).
  const player = {
    x: 6,
    y: FLOOR_Y[2] - 3,
    vx: 0,
    vy: 0,
    facing: 1,
    state: 'stand',
    floorIdx: 2,
    onLadder: false,
    ladderIdx: -1,
    walkPhase: 0,
    climbPhase: 0,
    stepTimer: 0,
    blinkTimer: 0,
    hp: 3,
    maxHp: 3,
    invul: 0,         // seconds of invulnerability after a hit
    attack: 0,        // seconds remaining in attack swing
    attackCool: 0,    // brief cooldown so X doesn't auto-spam
    hurtFlash: 0,
    dead: false,
  };
  const ATTACK_DUR = 0.30;
  const ATTACK_COOL = 0.12;
  const PLAYER_INVUL = 1.0;

  const PHYS = {
    walkSpeed: 12,        // cells per second
    climbSpeed: 8,
    jumpV: -22,           // initial vy on jump
    gravity: 70,
    maxFall: 32,
  };

  // ───────────────────────────────────────────────────────────────────────
  //  SPRITES
  // ───────────────────────────────────────────────────────────────────────
  function mirror(lines) {
    const swap = { '/': '\\', '\\': '/', '<': '>', '>': '<', '(': ')', ')': '(' , '┤': '├', '├': '┤' };
    return lines.map(l => {
      const arr = [];
      for (let i = l.length - 1; i >= 0; i--) arr.push(swap[l[i]] || l[i]);
      return arr.join('');
    });
  }

  const STAND_R = [
    ' O ',
    '/|\\',
    '/ \\',
  ];
  const WALK_A_R = [
    ' O ',
    '/|\\',
    '/_\\',
  ];
  const WALK_B_R = [
    ' O ',
    '\\|/',
    '/ \\',
  ];
  const SIT_R = [
    '   ',
    ' O ',
    '/=\\',
  ];
  const JUMP_R = [
    '\\O/',
    ' | ',
    '/ \\',
  ];
  const CLIMB_A = [
    ' O ',
    '-|-',
    ' | ',
  ];
  const CLIMB_B = [
    '\\O/',
    ' | ',
    '-|-',
  ];
  const BLINK_R = [
    ' o ',
    '/|\\',
    '/ \\',
  ];

  const STAND_L = mirror(STAND_R);
  const WALK_A_L = mirror(WALK_A_R);
  const WALK_B_L = mirror(WALK_B_R);
  const SIT_L = mirror(SIT_R);
  const JUMP_L = mirror(JUMP_R);
  const BLINK_L = mirror(BLINK_R);

  const COLOR_PLAYER = ['#ffd9a8', '#6fb6ff', '#2d4a78']; // head / shirt / legs
  const COLOR_PLAYER_CLIMB = ['#ffd9a8', '#ffb45a', '#2d4a78']; // arms outstretched -> highlight

  // ───────────────────────────────────────────────────────────────────────
  //  SWORD SPRITES — drawn next to the player; extends during attack.
  // ───────────────────────────────────────────────────────────────────────
  // Each entry: { dx, dy, ch }, dx/dy are offsets from the player sprite
  // origin (top-left of 3x3 sprite).  When facing left, dx is mirrored to
  // (2 - dx) and certain characters are swapped.
  const SWORD_IDLE = [
    { dx: 3, dy: 1, ch: '╾', color: '#d8e3f0' },
    { dx: 3, dy: 2, ch: '┃', color: '#7a8090' },
  ];
  // Three attack frames timed across ATTACK_DUR.
  const SWORD_FRAMES = [
    // Frame 0 — wind up, sword raised behind/up
    [
      { dx: 2, dy: -1, ch: '╱', color: '#ffe69a' },
      { dx: 3, dy: 0,  ch: '╱', color: '#ffd56b' },
    ],
    // Frame 1 — horizontal slash extended
    [
      { dx: 3, dy: 1, ch: '━', color: '#ffffff' },
      { dx: 4, dy: 1, ch: '━', color: '#ffe69a' },
      { dx: 5, dy: 1, ch: '➤', color: '#ffd56b' },
      { dx: 3, dy: 0, ch: '✦', color: '#ffffff' },
    ],
    // Frame 2 — follow-through, sword down
    [
      { dx: 3, dy: 2, ch: '╲', color: '#ffd56b' },
      { dx: 4, dy: 2, ch: '╲', color: '#caa040' },
    ],
  ];
  function swordSwapChar(c) {
    if (c === '╱') return '╲';
    if (c === '╲') return '╱';
    if (c === '➤') return '◀';
    if (c === '╾') return '╼';
    if (c === '╼') return '╾';
    return c;
  }

  // ───────────────────────────────────────────────────────────────────────
  //  ENEMIES
  // ───────────────────────────────────────────────────────────────────────
  // Enemies are 3 cols wide × 3 rows tall and have a simple AI.  All
  // contact-damage the player and can be killed with the sword.
  const SLIME = [
    '  ▄  ',
    '◜◍◍◍◝',
  ];
  const SLIME_COLORS = ['#4ec46f', '#2f8e4a'];

  const SKEL_A = [
    ' Θ ',
    '/┃\\',
    '/ \\',
  ];
  const SKEL_B = [
    ' Θ ',
    '\\┃/',
    ' ╲╱',
  ];
  const SKEL_COLORS = ['#e6e8ee', '#b8bcc4', '#9aa0aa'];

  const GHOST_A = [
    ' ⌒ ',
    '◕◕◕',
    '╲╳╱',
  ];
  const GHOST_B = [
    ' ⌒ ',
    '◔◔◔',
    '╱╳╲',
  ];
  const GHOST_COLORS = ['#dfeaff', '#9fb8e0', '#5870a0'];

  // Enemy registry — built fresh in resetGame() so death state resets.
  let enemies = [];
  function spawnEnemies() {
    enemies = [
      // Slime patrolling the bottom floor
      { type: 'slime', x: 36, y: FLOOR_Y[2] - 2, vx: 4.5, facing: 1, hp: 1, maxHp: 1,
        floorIdx: 2, minX: 24, maxX: 70, hop: 0, hurt: 0, dead: 0,
        w: 5, h: 2, originY: FLOOR_Y[2] - 2 },
      // Slime guarding the top floor near the key
      { type: 'slime', x: 70, y: FLOOR_Y[0] - 2, vx: -4, facing: -1, hp: 1, maxHp: 1,
        floorIdx: 0, minX: 58, maxX: 90, hop: 0, hurt: 0, dead: 0,
        w: 5, h: 2, originY: FLOOR_Y[0] - 2 },
      // Skeleton patrolling the middle platform
      { type: 'skel', x: 56, y: FLOOR_Y[1] - 3, vx: -6, facing: -1, hp: 2, maxHp: 2,
        floorIdx: 1, minX: 26, maxX: 80, walk: 0, hurt: 0, dead: 0,
        w: 3, h: 3, originY: FLOOR_Y[1] - 3 },
      // Skeleton on the bottom floor far side
      { type: 'skel', x: 84, y: FLOOR_Y[2] - 3, vx: 5, facing: 1, hp: 2, maxHp: 2,
        floorIdx: 2, minX: 74, maxX: 95, walk: 0, hurt: 0, dead: 0,
        w: 3, h: 3, originY: FLOOR_Y[2] - 3 },
      // Free-floating ghost between the floors
      { type: 'ghost', cx: 50, cy: 13, rx: 14, ry: 4,
        x: 49, y: 13, phase: 0, pSpeed: 0.9, hp: 1, maxHp: 1,
        facing: 1, hurt: 0, dead: 0, w: 3, h: 3 },
    ];
  }

  // ───────────────────────────────────────────────────────────────────────
  //  ORNAMENT PATTERNS (parallax wallpaper behind the play area)
  // ───────────────────────────────────────────────────────────────────────
  // Each pattern is a list of strings that tile horizontally and
  // vertically; we draw them inside the inter-floor "tiers" only.
  const ORN_FAR = [
    '   ·       ·         ·       ·         ·       ·         ·    ',
    '       ·       ·         ·       ·         ·       ·       ·  ',
    '   ✦       ·         ·       ✦         ·       ·         ✦    ',
  ];
  const ORN_MID = [
    '    ◇          ◇          ◇          ◇          ◇          ◇  ',
    '   ╱ ╲        ╱ ╲        ╱ ╲        ╱ ╲        ╱ ╲        ╱ ╲ ',
    '  ╱   ╲      ╱   ╲      ╱   ╲      ╱   ╲      ╱   ╲      ╱   ╲',
    '   ╲ ╱        ╲ ╱        ╲ ╱        ╲ ╱        ╲ ╱        ╲ ╱ ',
    '    ◇          ◇          ◇          ◇          ◇          ◇  ',
  ];
  const ORN_NEAR = [
    '┃           ┃           ┃           ┃           ┃           ┃   ',
    '┃           ┃           ┃           ┃           ┃           ┃   ',
    '╪═══════════╪═══════════╪═══════════╪═══════════╪═══════════╪═══',
    '┃           ┃           ┃           ┃           ┃           ┃   ',
    '┃           ┃           ┃           ┃           ┃           ┃   ',
  ];
  const ORN_VINE = [
    '   ┊       ┊       ┊       ┊       ┊       ┊       ┊       ┊  ',
    '  ╲┊╱     ╲┊╱     ╲┊╱     ╲┊╱     ╲┊╱     ╲┊╱     ╲┊╱     ╲┊╱ ',
    '   ╳       ╳       ╳       ╳       ╳       ╳       ╳       ╳  ',
  ];

  // Tree sprites
  const TREE_PINE = [
    '   ▲   ',
    '  ▲▲▲  ',
    ' ▲▲▲▲▲ ',
    '▲▲▲▲▲▲▲',
    '   ║   ',
    '   ║   ',
  ];
  const TREE_PINE_COLORS = ['#3ea65a', '#3ea65a', '#2f8e4a', '#256f3a', '#7a4a22', '#7a4a22'];

  const TREE_ROUND = [
    '  ╭▒▓╮  ',
    ' ▓▓▓▓▓▓ ',
    '▓▓▒▓▓▓▒▓',
    ' ▓▒▓▓▓▒ ',
    '   ║║   ',
    '   ║║   ',
  ];
  const TREE_ROUND_COLORS = ['#4ec46f', '#3ea65a', '#3ea65a', '#2f8e4a', '#7a4a22', '#5a3a18'];

  const BUSH = [
    ' ░▒░ ',
    '▒▓▓▓▒',
  ];
  const BUSH_COLORS = ['#3a7a32', '#2c5d28'];

  const ROCK = [
    ' ╱▀▀╲ ',
    '▒▓▓▓▓▒',
  ];
  const ROCK_COLORS = ['#7a7e88', '#5a5d66'];

  const CHEST_SPRITE = [
    ' ┌──╨──┐ ',
    ' │░▓◆▓░│ ',
    ' └──┴──┘ ',
  ];
  const CHEST_COLORS = ['#c08840', '#ffce5a', '#7a4a18'];

  const KEY_FRAMES = [
    ['◉━┓', ' ┃┛'],
    ['◎━┓', ' ┃┛'],
  ];

  // ───────────────────────────────────────────────────────────────────────
  //  PARTICLES
  // ───────────────────────────────────────────────────────────────────────
  const particles = [];
  function spawnParticles(cx, cy, opts = {}) {
    const count = opts.count || 24;
    const colors = opts.colors || ['#ffd56b', '#ffe69a', '#ffffff', '#ff9a3a'];
    const chars = opts.chars || ['·', '*', '✦', '+', '★'];
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 4 + Math.random() * 10;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 4,
        ch: chars[(Math.random() * chars.length) | 0],
        color: colors[(Math.random() * colors.length) | 0],
        life: 0.6 + Math.random() * 0.6,
        age: 0,
      });
    }
  }
  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];
      p.age += dt;
      if (p.age >= p.life) { particles.splice(i, 1); continue; }
      p.vy += dt * 18;        // gravity
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
  }
  function drawParticles() {
    for (const p of particles) {
      const a = 1 - p.age / p.life;
      const col = p.color + Math.floor(a * 255).toString(16).padStart(2, '0');
      const cx = Math.floor(p.x);
      const cy = Math.floor(p.y);
      if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) putChar(cx, cy, p.ch, col);
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  //  BACKGROUND ANIMATION UPDATES
  // ───────────────────────────────────────────────────────────────────────
  function updateClouds(dt) {
    for (const c of CLOUDS) {
      c.x += c.speed * dt;
      const shapeW = CLOUD_SHAPES[c.shape][0].length;
      if (c.x > COLS + 1) c.x = -shapeW - Math.random() * 10;
    }
  }
  function updateShootingStars(dt) {
    if (Math.random() < dt * 0.35) {
      const fromLeft = Math.random() < 0.5;
      SHOOTING_STARS.push({
        x: fromLeft ? -2 : COLS + 2,
        y: Math.random() * 4,
        vx: fromLeft ? 55 + Math.random() * 25 : -(55 + Math.random() * 25),
        vy: 12 + Math.random() * 18,
        trail: [],
        age: 0,
        life: 0.7 + Math.random() * 0.3,
      });
    }
    for (let i = SHOOTING_STARS.length - 1; i >= 0; i--) {
      const s = SHOOTING_STARS[i];
      s.age += dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.trail.push({ x: s.x, y: s.y });
      if (s.trail.length > 10) s.trail.shift();
      if (s.age >= s.life || s.y > 8 || s.x < -5 || s.x > COLS + 5) {
        SHOOTING_STARS.splice(i, 1);
      }
    }
  }
  function updateFireflies(dt) {
    for (const f of FIREFLIES) f.phase += dt * f.pSpeed;
  }
  function updateBats(dt) {
    if (BATS.length < 2 && Math.random() < dt * 0.15) {
      const goingRight = Math.random() < 0.5;
      BATS.push({
        x: goingRight ? -3 : COLS + 3,
        y: 1 + Math.random() * 3,
        vx: goingRight ? 9 + Math.random() * 4 : -(9 + Math.random() * 4),
        yPhase: Math.random() * Math.PI * 2,
        anim: 0,
      });
    }
    for (let i = BATS.length - 1; i >= 0; i--) {
      const b = BATS[i];
      b.x += b.vx * dt;
      b.yPhase += dt * 5;
      b.anim += dt * 9;
      if (b.x < -6 || b.x > COLS + 6) BATS.splice(i, 1);
    }
  }
  function updateBackground(dt) {
    windPhase += dt * 0.9;
    updateClouds(dt);
    updateShootingStars(dt);
    updateFireflies(dt);
    updateBats(dt);
  }

  // ───────────────────────────────────────────────────────────────────────
  //  AUDIO
  // ───────────────────────────────────────────────────────────────────────
  let audioCtx = null;
  let soundOn = true;
  function ensureAudio() {
    if (!audioCtx) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (Ctx) audioCtx = new Ctx();
    }
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }
  function blip(freq, dur, type = 'square', vol = 0.05, slideTo = null) {
    if (!soundOn || !audioCtx) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo !== null) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }
  function noiseBurst(dur, vol = 0.06) {
    if (!soundOn || !audioCtx) return;
    const t = audioCtx.currentTime;
    const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * dur, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const filt = audioCtx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 400;
    const g = audioCtx.createGain();
    g.gain.value = vol;
    src.connect(filt).connect(g).connect(audioCtx.destination);
    src.start(t);
  }
  function jumpSound()    { blip(280, 0.18, 'square', 0.05, 760); }
  function landSound()    { noiseBurst(0.08, 0.05); }
  function walkStep()     { blip(180, 0.03, 'square', 0.018); }
  function climbStep()    { blip(420, 0.04, 'triangle', 0.025); }
  function pickupSound()  {
    blip(523, 0.10, 'square', 0.06);
    setTimeout(() => blip(659, 0.10, 'square', 0.06), 90);
    setTimeout(() => blip(784, 0.14, 'square', 0.06), 180);
    setTimeout(() => blip(1046, 0.22, 'square', 0.07), 290);
  }
  function winSound() {
    const notes = [523, 659, 784, 1046, 784, 1046, 1318];
    notes.forEach((n, i) => setTimeout(() => blip(n, 0.20, 'triangle', 0.07), i * 110));
  }
  function slashSound()    { blip(900, 0.08, 'square',   0.04, 380); }
  function enemyHitSound() { blip(220, 0.12, 'sawtooth', 0.05, 90); }
  function enemyDieSound() { noiseBurst(0.18, 0.06); setTimeout(() => blip(140, 0.18, 'sawtooth', 0.05, 60), 30); }
  function hurtSound()     { noiseBurst(0.08, 0.04); blip(180, 0.20, 'square', 0.05, 80); }
  function gameOverSound() {
    const notes = [392, 370, 349, 330, 311, 277];
    notes.forEach((n, i) => setTimeout(() => blip(n, 0.20, 'triangle', 0.06), i * 130));
  }

  // ───────────────────────────────────────────────────────────────────────
  //  INPUT
  // ───────────────────────────────────────────────────────────────────────
  const keys = Object.create(null);
  let jumpQueued = false;
  let attackQueued = false;
  const ATTACK_KEYS = new Set(['x','X','z','Z','j','J']);
  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ','Spacebar'].includes(k)) e.preventDefault();
    if (k === ' ' && !keys[' ']) jumpQueued = true;
    if (ATTACK_KEYS.has(k) && !keys[k]) attackQueued = true;
    if (k === 'm' || k === 'M') {
      soundOn = !soundOn;
      sndBtn.textContent = soundOn ? 'ON' : 'OFF';
    }
    keys[k] = true;
    ensureAudio();
  }, { passive: false });
  window.addEventListener('keyup', (e) => { keys[e.key] = false; });

  // Sound toggle
  const sndBtn = document.getElementById('sndBtn');
  sndBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    soundOn = !soundOn;
    sndBtn.textContent = soundOn ? 'ON' : 'OFF';
  });

  // Overlay
  const overlay = document.getElementById('overlay');
  const overlayText = document.getElementById('overlayText');
  const overlaySub = document.getElementById('overlaySub');
  let gameState = 'menu';   // menu | playing | won
  overlay.addEventListener('click', () => {
    ensureAudio();
    if (gameState === 'won' || gameState === 'gameover') resetGame();
    overlay.classList.add('hidden');
    gameState = 'playing';
  });

  function resetGame() {
    player.x = 6;
    player.y = FLOOR_Y[2] - 3;
    player.vx = 0;
    player.vy = 0;
    player.facing = 1;
    player.state = 'stand';
    player.floorIdx = 2;
    player.onLadder = false;
    player.ladderIdx = -1;
    player.hp = player.maxHp;
    player.invul = 0;
    player.attack = 0;
    player.attackCool = 0;
    player.hurtFlash = 0;
    player.dead = false;
    KEY.collected = false;
    particles.length = 0;
    SHOOTING_STARS.length = 0;
    BATS.length = 0;
    spawnEnemies();
  }
  spawnEnemies();

  // ───────────────────────────────────────────────────────────────────────
  //  HELPERS
  // ───────────────────────────────────────────────────────────────────────
  function ladderAt(px) {
    // returns ladder index if player col `px` (float, sprite top-left) is
    // within reach of a ladder, else -1.  Sprite is 3 wide so center is px+1.
    const cx = px + 1;
    for (let i = 0; i < LADDERS.length; i++) {
      const L = LADDERS[i];
      if (Math.abs(cx - L.x) < 0.7) return i;
    }
    return -1;
  }
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  // ───────────────────────────────────────────────────────────────────────
  //  UPDATE
  // ───────────────────────────────────────────────────────────────────────
  function update(dt) {
    for (const s of STARS) s.phase += dt * s.speed;
    updateBackground(dt);
    updateEnemies(dt);

    if (gameState !== 'playing') {
      updateParticles(dt);
      return;
    }

    const left  = !!(keys['ArrowLeft']  || keys['a'] || keys['A']);
    const right = !!(keys['ArrowRight'] || keys['d'] || keys['D']);
    const up    = !!(keys['ArrowUp']    || keys['w'] || keys['W']);
    const down  = !!(keys['ArrowDown']  || keys['s'] || keys['S']);
    const jump  = jumpQueued;
    jumpQueued = false;

    const onGround = player.vy === 0 && !player.onLadder;

    // ── LADDER LOGIC ────────────────────────────────────────────────
    const lIdx = ladderAt(player.x);
    if (!player.onLadder && lIdx >= 0 && onGround) {
      const L = LADDERS[lIdx];
      const floorY = FLOOR_Y[player.floorIdx];
      const canGoUp   = up   && floorY === L.bottom;
      const canGoDown = down && floorY === L.top;
      if (canGoUp || canGoDown) {
        player.onLadder = true;
        player.ladderIdx = lIdx;
        player.x = L.x - 1;   // snap horizontally
        player.vx = 0;
        player.vy = 0;
        player.state = 'climb';
      }
    }
    if (player.onLadder) {
      const L = LADDERS[player.ladderIdx];
      player.vx = 0;
      player.vy = 0;
      if (up)   player.vy = -PHYS.climbSpeed;
      if (down) player.vy =  PHYS.climbSpeed;
      if (left || right) {
        // Hop off ladder onto nearest floor
        player.onLadder = false;
        player.state = 'stand';
        player.facing = left ? -1 : 1;
      }
      player.y += player.vy * dt;
      // Climb step sound
      if (player.vy !== 0) {
        player.climbPhase += Math.abs(player.vy) * dt * 0.4;
        player.stepTimer -= dt;
        if (player.stepTimer <= 0) { climbStep(); player.stepTimer = 0.18; }
      }
      // Reached top or bottom of ladder -> snap to floor
      const footRow = player.y + 3;
      if (player.vy < 0 && footRow <= L.top) {
        // arrived at top floor
        player.y = L.top - 3;
        player.onLadder = false;
        player.state = 'stand';
        player.vy = 0;
        // determine which floor index
        player.floorIdx = FLOOR_Y.indexOf(L.top);
      } else if (player.vy > 0 && footRow >= L.bottom) {
        player.y = L.bottom - 3;
        player.onLadder = false;
        player.state = 'stand';
        player.vy = 0;
        player.floorIdx = FLOOR_Y.indexOf(L.bottom);
      }
    } else {
      // ── HORIZONTAL MOVEMENT ───────────────────────────────────────
      let moving = false;
      if (left  && !right) { player.vx = -PHYS.walkSpeed; player.facing = -1; moving = true; }
      else if (right && !left) { player.vx =  PHYS.walkSpeed; player.facing =  1; moving = true; }
      else { player.vx = 0; }

      // Sitting / jumping
      if (jump && onGround) {
        player.vy = PHYS.jumpV;
        player.state = 'jump';
        jumpSound();
      } else if (down && onGround && !moving) {
        player.state = 'sit';
        player.vx = 0;
      } else if (onGround) {
        player.state = moving ? 'walk' : 'stand';
      } else {
        player.state = 'jump';
      }

      // Gravity
      if (!onGround) player.vy = clamp(player.vy + PHYS.gravity * dt, -100, PHYS.maxFall);

      // Apply velocity
      const prevY = player.y;
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      player.x = clamp(player.x, FLOOR_LEFT, FLOOR_RIGHT - 2);

      // Land on floor
      const footRow = player.y + 3;
      for (let i = 0; i < FLOOR_Y.length; i++) {
        const fy = FLOOR_Y[i];
        const prevFoot = prevY + 3;
        if (prevFoot <= fy && footRow >= fy && player.vy >= 0) {
          player.y = fy - 3;
          player.vy = 0;
          player.floorIdx = i;
          if (player.state === 'jump') { player.state = 'stand'; landSound(); }
          break;
        }
      }

      // Walk step sounds + anim
      if (player.state === 'walk') {
        player.walkPhase += Math.abs(player.vx) * dt * 0.5;
        player.stepTimer -= dt;
        if (player.stepTimer <= 0) { walkStep(); player.stepTimer = 0.22; }
      } else {
        player.stepTimer = 0;
      }
    }

    // ── KEY PICKUP ──────────────────────────────────────────────────
    if (!KEY.collected) {
      const keyRow = FLOOR_Y[KEY.floorIdx] - 2;
      const dx = (player.x + 1) - (KEY.x + 1);
      const dy = (player.y + 1.5) - (keyRow + 0.5);
      if (Math.abs(dx) < 2 && Math.abs(dy) < 2.5) {
        KEY.collected = true;
        pickupSound();
        spawnParticles(KEY.x + 1, keyRow);
        setTimeout(winSound, 400);
        setTimeout(() => {
          gameState = 'won';
          overlayText.textContent = 'YOU GOT THE KEY!';
          overlaySub.textContent = 'Click to play again';
          overlay.classList.remove('hidden');
        }, 800);
      }
    }

    // ── ATTACK INPUT ───────────────────────────────────────────────
    if (player.attackCool > 0) player.attackCool -= dt;
    if (player.attack > 0) player.attack -= dt;
    if (attackQueued && player.attack <= 0 && player.attackCool <= 0 && !player.onLadder) {
      player.attack = ATTACK_DUR;
      player.attackCool = ATTACK_DUR + ATTACK_COOL;
      slashSound();
    }
    attackQueued = false;

    // ── COMBAT ─────────────────────────────────────────────────────
    resolveCombat();

    if (player.invul > 0)     player.invul -= dt;
    if (player.hurtFlash > 0) player.hurtFlash -= dt;

    // ── DEATH ───────────────────────────────────────────────────────
    if (player.hp <= 0 && !player.dead) {
      player.dead = true;
      gameOverSound();
      spawnParticles(player.x + 1, player.y + 1.5, { count: 30, colors: ['#ff6464','#ff9a3a','#ffd56b'] });
      setTimeout(() => {
        gameState = 'gameover';
        overlayText.textContent = 'YOU DIED';
        overlaySub.textContent = 'Click to try again';
        overlay.classList.remove('hidden');
      }, 700);
    }

    // ── BLINK ───────────────────────────────────────────────────────
    player.blinkTimer -= dt;
    if (player.blinkTimer < -0.12) player.blinkTimer = 3 + Math.random() * 2;

    updateParticles(dt);
  }

  // ───────────────────────────────────────────────────────────────────────
  //  ENEMY AI
  // ───────────────────────────────────────────────────────────────────────
  function updateEnemies(dt) {
    for (const e of enemies) {
      if (e.dead > 0) { e.dead -= dt; continue; }
      if (e.hurt > 0) e.hurt -= dt;
      if (e.type === 'slime') {
        e.x += e.vx * dt;
        if (e.x <= e.minX) { e.x = e.minX; e.vx = Math.abs(e.vx); e.facing = 1; }
        else if (e.x >= e.maxX) { e.x = e.maxX; e.vx = -Math.abs(e.vx); e.facing = -1; }
        e.hop += dt * 4.5;
        e.y = e.originY - Math.abs(Math.sin(e.hop)) * 1.5;
      } else if (e.type === 'skel') {
        e.x += e.vx * dt;
        if (e.x <= e.minX) { e.x = e.minX; e.vx = Math.abs(e.vx); e.facing = 1; }
        else if (e.x >= e.maxX) { e.x = e.maxX; e.vx = -Math.abs(e.vx); e.facing = -1; }
        e.walk += dt * 6;
        e.y = e.originY;
      } else if (e.type === 'ghost') {
        e.phase += dt * e.pSpeed;
        e.x = e.cx + Math.cos(e.phase) * e.rx - 1;
        e.y = e.cy + Math.sin(e.phase * 1.4) * e.ry;
        e.facing = Math.cos(e.phase) >= 0 ? 1 : -1;
      }
    }
    // Cull dead enemies whose fade-out finished.
    for (let i = enemies.length - 1; i >= 0; i--) {
      if (enemies[i].dead < -0.5) enemies.splice(i, 1);
    }
  }

  function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  function resolveCombat() {
    // Player attack hitbox (only during middle portion of the swing).
    const inHitFrame = player.attack > ATTACK_DUR * 0.25 && player.attack < ATTACK_DUR * 0.75;
    if (inHitFrame) {
      const hx = player.facing === 1 ? player.x + 3 : player.x - 3;
      const hy = player.y;
      const hw = 3, hh = 3;
      for (const e of enemies) {
        if (e.dead > 0 || e.hurt > 0) continue;
        if (rectOverlap(hx, hy, hw, hh, e.x, e.y, e.w, e.h)) {
          e.hp -= 1;
          e.hurt = 0.25;
          enemyHitSound();
          spawnParticles(e.x + e.w / 2, e.y + e.h / 2, { count: 8, colors: ['#ffe69a','#ff9a3a','#ffffff'], chars: ['*','+','✦'] });
          if (e.hp <= 0) {
            e.dead = 0.45;
            enemyDieSound();
            spawnParticles(e.x + e.w / 2, e.y + e.h / 2, {
              count: 18,
              colors: e.type === 'ghost' ? ['#9fb8e0','#dfeaff','#ffffff'] : ['#3ea65a','#ffd56b','#ffffff'],
              chars: ['*','·','✦','+'],
            });
          }
        }
      }
    }
    // Enemy contact damage
    if (player.invul <= 0 && !player.dead) {
      const px = player.x, py = player.y;
      for (const e of enemies) {
        if (e.dead > 0) continue;
        if (rectOverlap(px, py, 3, 3, e.x, e.y, e.w, e.h)) {
          player.hp -= 1;
          player.invul = PLAYER_INVUL;
          player.hurtFlash = 0.25;
          hurtSound();
          // Knockback away from enemy
          const dir = (player.x + 1.5) < (e.x + e.w / 2) ? -1 : 1;
          player.vx = dir * 8;
          if (!player.onLadder) player.vy = -10;
          break;
        }
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  //  DRAW
  // ───────────────────────────────────────────────────────────────────────
  function drawSky(time) {
    // gradient sky
    const grad = ctx.createLinearGradient(0, 0, 0, FLOOR_Y[0] * CHAR_H);
    grad.addColorStop(0, '#0a0e22');
    grad.addColorStop(0.7, '#162244');
    grad.addColorStop(1, '#2a1a3a');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, FLOOR_Y[0] * CHAR_H);

    // tier backgrounds (subtle)
    ctx.fillStyle = '#0c0e18';
    ctx.fillRect(0, FLOOR_Y[0] * CHAR_H, canvas.width, (FLOOR_Y[1] - FLOOR_Y[0]) * CHAR_H);
    ctx.fillStyle = '#0a0d16';
    ctx.fillRect(0, FLOOR_Y[1] * CHAR_H, canvas.width, (FLOOR_Y[2] - FLOOR_Y[1]) * CHAR_H);
    ctx.fillStyle = '#080a12';
    ctx.fillRect(0, FLOOR_Y[2] * CHAR_H, canvas.width, (ROWS - FLOOR_Y[2]) * CHAR_H);

    // moon glow
    const mgx = (MOON.x + 4) * CHAR_W, mgy = (MOON.y + 1) * CHAR_H;
    const mg = ctx.createRadialGradient(mgx, mgy, 0, mgx, mgy, 90);
    mg.addColorStop(0, 'rgba(255,230,160,0.20)');
    mg.addColorStop(1, 'rgba(255,230,160,0)');
    ctx.fillStyle = mg;
    ctx.fillRect(mgx - 90, mgy - 90, 180, 180);

    // stars
    for (const s of STARS) {
      const tw = 0.5 + 0.5 * Math.sin(s.phase + time * 2);
      const color = `rgba(${200 + Math.floor(tw*55)},${220 + Math.floor(tw*35)},255,${0.4 + tw*0.6})`;
      putChar(s.x | 0, s.y | 0, s.ch, color);
    }

    // moon
    putSpriteColored(MOON.x, MOON.y, MOON_SPRITE, '#fff3c4');
  }

  function drawMountains() {
    // Parallax: as the player moves right, the mountains slide left a bit.
    const shift = (player.x - 48) * 0.07;
    const len = MOUNTAIN_TOP.length;
    for (let col = 0; col < COLS; col++) {
      const src = (((col + Math.round(shift)) % len) + len) % len;
      const c1 = MOUNTAIN_TOP[src];
      const c2 = MOUNTAIN_BOT[src];
      if (c1 && c1 !== ' ') putChar(col, 4, c1, '#2c3656');
      if (c2 && c2 !== ' ') putChar(col, 5, c2, '#1d2540');
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  //  ORNAMENT WALLPAPER  (tiled parallax pattern inside each tier)
  // ───────────────────────────────────────────────────────────────────────
  function drawOrnamentLayer(pattern, yStart, yEnd, factor, color) {
    const shift = (player.x - 48) * factor;
    const ph = pattern.length;
    for (let y = yStart; y < yEnd; y++) {
      const row = pattern[((y - yStart) % ph + ph) % ph];
      const pw = row.length;
      for (let x = 0; x < COLS; x++) {
        const sx = (((x + Math.round(shift)) % pw) + pw) % pw;
        const ch = row[sx];
        if (ch && ch !== ' ') putChar(x, y, ch, color);
      }
    }
  }
  function drawTierOrnaments(time) {
    // Tier 1: rows 7..17 (between top and middle floors)
    drawOrnamentLayer(ORN_FAR,  7, 17, 0.03, '#171a2e');
    drawOrnamentLayer(ORN_MID,  7, 17, 0.10, '#1d2742');
    drawOrnamentLayer(ORN_VINE, 7, 17, 0.16, '#22324a');
    drawOrnamentLayer(ORN_NEAR, 7, 17, 0.22, '#2a2240');

    // Tier 2: rows 19..29 (between middle and bottom floors)
    drawOrnamentLayer(ORN_FAR,  19, 29, 0.03, '#161a26');
    drawOrnamentLayer(ORN_MID,  19, 29, 0.10, '#1c2438');
    drawOrnamentLayer(ORN_VINE, 19, 29, 0.16, '#1f2a3a');
    drawOrnamentLayer(ORN_NEAR, 19, 29, 0.22, '#26203a');

    // Bottom strip: rows 31..33 (cave floor texture)
    drawOrnamentLayer(ORN_MID,  31, 33, 0.10, '#1a1722');
  }

  function drawFarTrees() {
    // A second parallax layer that shifts more than the mountains.
    const shift = (player.x - 48) * 0.18;
    const len = FAR_TREES.length;
    // place silhouettes just above each platform for a multi-tier feel
    const rows = [5];
    for (const row of rows) {
      for (let col = 0; col < COLS; col++) {
        const src = (((col + Math.round(shift)) % len) + len) % len;
        const ch = FAR_TREES[src];
        if (ch && ch !== ' ') putChar(col, row, ch, '#1f3b2c');
      }
    }
  }

  function drawClouds() {
    for (const c of CLOUDS) {
      const shape = CLOUD_SHAPES[c.shape];
      const px = Math.round(c.x);
      for (let r = 0; r < shape.length; r++) {
        const line = shape[r];
        for (let i = 0; i < line.length; i++) {
          const ch = line[i];
          if (ch === ' ') continue;
          const col = px + i;
          if (col < 0 || col >= COLS) continue;
          const color = (ch === '═' || ch === '╯' || ch === '╰') ? c.colors[1] : c.colors[0];
          putChar(col, c.y + r, ch, color);
        }
      }
    }
  }

  function drawShootingStars() {
    for (const s of SHOOTING_STARS) {
      const a0 = 1 - s.age / s.life;
      for (let i = 0; i < s.trail.length; i++) {
        const t = s.trail[i];
        const a = (i / s.trail.length) * a0;
        if (a < 0.05) continue;
        const cx = Math.floor(t.x), cy = Math.floor(t.y);
        if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) continue;
        const head = i === s.trail.length - 1;
        const ch = head ? '✦' : (i > s.trail.length - 4 ? '*' : '·');
        putChar(cx, cy, ch, `rgba(255,245,210,${a.toFixed(2)})`);
      }
    }
  }

  function drawBats() {
    for (const b of BATS) {
      const y = b.y + Math.sin(b.yPhase) * 0.7;
      const wing = (b.anim | 0) % 2;
      const ch = wing === 0 ? '"v"' : '\\v/';
      const px = Math.floor(b.x);
      const py = Math.floor(y);
      putString(px, py, ch, '#3a2e3c');
    }
  }

  function drawFireflies(time) {
    for (const f of FIREFLIES) {
      const x = f.cx + Math.cos(f.phase) * f.rx;
      const y = f.cy + Math.sin(f.phase * 1.3 + 0.7) * f.ry;
      const glow = 0.35 + 0.65 * Math.sin(time * 2.5 + f.blinkOff);
      if (glow < 0.25) continue;
      const a = glow.toFixed(2);
      putChar(Math.floor(x), Math.floor(y), '·', `rgba(190,255,140,${a})`);
    }
  }

  function drawEnemy(e, time) {
    const px = Math.round(e.x);
    const py = Math.round(e.y);
    let sprite, colors;
    if (e.type === 'slime') {
      sprite = SLIME;
      colors = SLIME_COLORS;
    } else if (e.type === 'skel') {
      const a = ((e.walk | 0) % 2) === 0;
      sprite = a ? SKEL_A : SKEL_B;
      if (e.facing === -1) sprite = mirror(sprite);
      colors = SKEL_COLORS;
    } else if (e.type === 'ghost') {
      const a = (((time * 4) | 0) % 2) === 0;
      sprite = a ? GHOST_A : GHOST_B;
      colors = GHOST_COLORS;
    }
    // Dead enemies fade and shake
    if (e.dead > 0) {
      const a = (e.dead / 0.45).toFixed(2);
      const sh = (Math.random() - 0.5) * 1.2;
      ctx.globalAlpha = parseFloat(a);
      for (let r = 0; r < sprite.length; r++) putString(px + Math.round(sh), py + r, sprite[r], colors[r] || colors[colors.length - 1]);
      ctx.globalAlpha = 1;
      return;
    }
    // Hurt flash → tint white
    if (e.hurt > 0 && (((e.hurt * 30) | 0) % 2) === 0) {
      for (let r = 0; r < sprite.length; r++) putString(px, py + r, sprite[r], '#ffffff');
    } else {
      // Ghost translucent
      if (e.type === 'ghost') ctx.globalAlpha = 0.75;
      for (let r = 0; r < sprite.length; r++) putString(px, py + r, sprite[r], colors[r] || colors[colors.length - 1]);
      ctx.globalAlpha = 1;
    }
    // Tiny HP pip above multi-HP enemies
    if (e.maxHp > 1) {
      for (let i = 0; i < e.maxHp; i++) {
        putChar(px + i, py - 1, i < e.hp ? '▮' : '▯', '#ff6464');
      }
    }
  }

  function drawSword(time) {
    if (player.onLadder || player.state === 'sit') return;
    const facingR = player.facing === 1;
    const px = Math.round(player.x);
    const py = Math.round(player.y);
    let parts;
    if (player.attack > 0) {
      const t = (ATTACK_DUR - player.attack) / ATTACK_DUR; // 0..1
      const frameIdx = t < 0.33 ? 0 : t < 0.66 ? 1 : 2;
      parts = SWORD_FRAMES[frameIdx];
    } else {
      parts = SWORD_IDLE;
    }
    for (const p of parts) {
      const dx = facingR ? p.dx : (2 - p.dx);
      const ch = facingR ? p.ch : swordSwapChar(p.ch);
      const cx = px + dx;
      const cy = py + p.dy;
      if (cx < 0 || cx >= COLS || cy < 0 || cy >= ROWS) continue;
      putChar(cx, cy, ch, p.color);
    }
  }

  function drawHP() {
    // Three hearts top-left of the canvas.
    for (let i = 0; i < player.maxHp; i++) {
      const filled = i < player.hp;
      putChar(1 + i * 2, 0, filled ? '♥' : '♡', filled ? '#ff5070' : '#552040');
    }
  }

  function drawFloors() {
    for (let i = 0; i < FLOOR_Y.length; i++) {
      const y = FLOOR_Y[i];
      // platform top: heavy line with subtle grain
      for (let x = FLOOR_LEFT; x <= FLOOR_RIGHT; x++) {
        const grain = ((x * 7 + i * 31) % 13) === 0 ? '═' : '━';
        putChar(x, y, grain, i === 0 ? '#caa070' : i === 1 ? '#b58952' : '#a07a44');
      }
      // shadow line below
      for (let x = FLOOR_LEFT; x <= FLOOR_RIGHT; x++) {
        const ch = ((x + i) % 4 === 0) ? '▓' : ((x + i) % 4 === 2 ? '▒' : '░');
        putChar(x, y + 1, ch, i === 0 ? '#704830' : i === 1 ? '#5c3a24' : '#4a2e1c');
      }
      // edge caps
      putChar(FLOOR_LEFT - 1, y, '╞', '#7a5a32');
      putChar(FLOOR_RIGHT + 1, y, '╡', '#7a5a32');
    }
  }

  function drawLadders() {
    for (const L of LADDERS) {
      for (let r = L.top; r < L.bottom; r++) {
        putChar(L.x - 1, r, '║', '#b58952');
        putChar(L.x + 1, r, '║', '#b58952');
        if ((r - L.top) % 2 === 1) {
          putChar(L.x, r, '═', '#caa070');
        } else {
          putChar(L.x, r, ' ', '#000');
        }
      }
      // base caps
      putChar(L.x - 1, L.bottom - 1, '╨', '#caa070');
      putChar(L.x + 1, L.bottom - 1, '╨', '#caa070');
    }
  }

  function drawTree(t) {
    const y = FLOOR_Y[t.floorIdx] - 6;
    const sprite = t.kind === 'pine' ? TREE_PINE : TREE_ROUND;
    const colors = t.kind === 'pine' ? TREE_PINE_COLORS : TREE_ROUND_COLORS;
    // Top of the tree sways with the wind; trunk stays put.
    const sway = Math.sin(windPhase + t.x * 0.35) * 0.6;
    for (let r = 0; r < sprite.length; r++) {
      const isCanopy = r < 4;
      const dx = isCanopy ? Math.round(sway * (1 - r * 0.25)) : 0;
      putString(t.x - 3 + dx, y + r, sprite[r], colors[r]);
    }
  }
  function drawBush(b) {
    const y = FLOOR_Y[b.floorIdx] - 2;
    putSpriteColored(b.x - 2, y, BUSH, BUSH_COLORS);
  }
  function drawRock(r) {
    const y = FLOOR_Y[r.floorIdx] - 2;
    putSpriteColored(r.x - 2, y, ROCK, ROCK_COLORS);
  }

  function drawChest() {
    const y = FLOOR_Y[CHEST.floorIdx] - 3;
    putSpriteColored(CHEST.x - 4, y, CHEST_SPRITE, CHEST_COLORS);
  }

  function drawKey(time) {
    if (KEY.collected) return;
    const baseY = FLOOR_Y[KEY.floorIdx] - 2;
    const bob = Math.sin(time * 3) * 0.4;
    const drawY = Math.round(baseY + bob);
    const frame = (((time * 4) | 0) % 2);
    const sp = KEY_FRAMES[frame];
    const colors = ['#ffd56b', '#caa040'];
    putSpriteColored(KEY.x, drawY, sp, colors);
    // sparkle
    if ((((time * 6) | 0) % 3) === 0) {
      const sx = KEY.x + ((Math.random() * 3) | 0);
      const sy = drawY - 1 + ((Math.random() * 2) | 0);
      putChar(sx, sy, '✦', '#fffbe0');
    }
  }

  function drawPlayer(time) {
    let sprite;
    let colors = COLOR_PLAYER;
    const facingR = player.facing === 1;
    if (player.onLadder) {
      const a = ((player.climbPhase | 0) % 2) === 0;
      sprite = a ? CLIMB_A : CLIMB_B;
      colors = COLOR_PLAYER_CLIMB;
    } else if (player.state === 'jump') {
      sprite = facingR ? JUMP_R : JUMP_L;
    } else if (player.state === 'sit') {
      sprite = facingR ? SIT_R : SIT_L;
    } else if (player.state === 'walk') {
      const a = ((player.walkPhase | 0) % 2) === 0;
      sprite = facingR ? (a ? WALK_A_R : WALK_B_R) : (a ? WALK_A_L : WALK_B_L);
    } else {
      // stand
      if (player.blinkTimer < 0) sprite = facingR ? BLINK_R : BLINK_L;
      else sprite = facingR ? STAND_R : STAND_L;
    }
    const px = Math.round(player.x);
    const py = Math.round(player.y);
    // Invulnerability flicker (skip rendering every other tick)
    const flicker = player.invul > 0 && (((player.invul * 18) | 0) % 2) === 0;
    if (flicker) return;
    // Hurt flash → blanket the sprite in red briefly
    if (player.hurtFlash > 0) {
      for (let r = 0; r < sprite.length; r++) putString(px, py + r, sprite[r], '#ff5070');
    } else {
      putSpriteColored(px, py, sprite, colors);
    }

    // soft shadow underneath
    if (!player.onLadder) {
      const fy = FLOOR_Y[player.floorIdx];
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.fillRect((px) * CHAR_W, (fy - 0.2) * CHAR_H, 3 * CHAR_W, 3);
    }
  }

  function drawGround() {
    // pixels of ground at the very bottom
    for (let x = 0; x < COLS; x++) {
      const ch = (x % 5 === 0) ? '▓' : ((x % 3 === 0) ? '▒' : '░');
      putChar(x, ROWS - 1, ch, '#1a1410');
    }
  }

  function draw(time) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawSky(time);

    // Tier wallpaper (behind the play area, in front of dark fills)
    drawTierOrnaments(time);

    // Background parallax + sky animations (back to front)
    drawMountains();
    drawFarTrees();
    drawClouds();
    drawBats();
    drawShootingStars();

    // Foreground world
    for (const t of TREES) drawTree(t);
    drawFloors();
    drawLadders();
    for (const b of BUSHES) drawBush(b);
    for (const r of ROCKS) drawRock(r);

    drawFireflies(time);

    drawChest();
    drawKey(time);

    // Enemies behind player so player passes in front during overlap.
    for (const e of enemies) drawEnemy(e, time);

    drawPlayer(time);
    drawSword(time);

    drawParticles();

    drawGround();
    drawHP();
  }

  // ───────────────────────────────────────────────────────────────────────
  //  MAIN LOOP
  // ───────────────────────────────────────────────────────────────────────
  let lastTime = performance.now();
  function loop(now) {
    const dt = Math.min(0.04, (now - lastTime) / 1000);
    lastTime = now;
    update(dt);
    draw(now / 1000);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

})();
