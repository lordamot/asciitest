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
  };

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

  // ───────────────────────────────────────────────────────────────────────
  //  INPUT
  // ───────────────────────────────────────────────────────────────────────
  const keys = Object.create(null);
  let jumpQueued = false;
  window.addEventListener('keydown', (e) => {
    const k = e.key;
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ','Spacebar'].includes(k)) e.preventDefault();
    if (k === ' ' && !keys[' ']) jumpQueued = true;
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
    if (gameState === 'won') resetGame();
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
    KEY.collected = false;
    particles.length = 0;
  }

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
    if (gameState !== 'playing') {
      // background-only effects
      for (const s of STARS) s.phase += dt * s.speed;
      updateParticles(dt);
      return;
    }

    for (const s of STARS) s.phase += dt * s.speed;

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

    // ── BLINK ───────────────────────────────────────────────────────
    player.blinkTimer -= dt;
    if (player.blinkTimer < -0.12) player.blinkTimer = 3 + Math.random() * 2;

    updateParticles(dt);
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
    if (t.kind === 'pine') {
      putSpriteColored(t.x - 3, y, TREE_PINE, TREE_PINE_COLORS);
    } else {
      putSpriteColored(t.x - 3, y, TREE_ROUND, TREE_ROUND_COLORS);
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
    putSpriteColored(px, py, sprite, colors);

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

    // far decorations (behind player) — back to front
    for (const t of TREES) drawTree(t);
    drawFloors();
    drawLadders();
    for (const b of BUSHES) drawBush(b);
    for (const r of ROCKS) drawRock(r);

    drawChest();
    drawKey(time);

    drawPlayer(time);

    drawParticles();

    drawGround();
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
