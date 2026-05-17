'use strict';

(function () {

  // ───────────────────────────────────────────────────────────────────────
  //  CANVAS / GRID
  // ───────────────────────────────────────────────────────────────────────
  const CHAR_W = 5;
  const CHAR_H = 9;
  const COLS = 200;
  const ROWS = 68;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  canvas.width = COLS * CHAR_W;
  canvas.height = ROWS * CHAR_H;

  const FONT = '8px "Cascadia Mono", "Fira Code", "JetBrains Mono", "Source Code Pro", "Consolas", "Menlo", monospace';
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
  //  WORLD LAYOUT (per-screen, populated by loadScreen())
  // ───────────────────────────────────────────────────────────────────────
  // A "floor" is now a platform segment {y, left, right} so we can have
  // partial floors (banks of a river) and flying platforms.
  let FLOORS = [];
  let FLOOR_Y = [];   // derived: FLOORS.map(f => f.y), for legacy lookups
  let LADDERS = [];
  let TREES = [];
  let BUSHES = [];
  let ROCKS = [];
  let STALACTITES = [];  // cave decorations (cave: screen 3)
  let STALAGMITES = [];
  let CRYSTALS = [];
  let TORCHES = [];
  let CHEST = null;     // { x, floorIdx }
  let KEY = null;       // { x, floorIdx, collected }
  let POTION = null;    // { x, floorIdx, collected } — heals +1 HP
  let FRAGMENT = null;  // { x, floorIdx, digits: "47", collected, levelIdx }
  let SAFE = null;      // { x, floorIdx, opened }
  let BOAT = null;      // screen 1: { x, y, w, baseY, phase, onBoard }
  let RIVER = null;     // screen 1: { left, right, top }
  let MOV_PLATS = [];   // screen 2: list of moving platforms (also live in FLOORS)
  let GOAL = null;      // win-or-advance objective for the current screen
  let screen = 0;
  const NUM_SCREENS = 5;

  // Dog companion (granted at start of level 5 if the cave safe was
  // cracked).  Floats / hops alongside the player and chases the
  // snowman boss.  Set in loadScreen(4).
  let dog = null;
  // Falling snow particles for the snow level.
  const SNOWFLAKES = [];

  // 6-digit safe code, split into three 2-digit fragments — one per level.
  const FRAGMENT_DIGITS = ['47', '13', '82'];
  const SAFE_CODE = FRAGMENT_DIGITS.join('');   // "471382"
  // Player-collected fragments (null until picked up).
  let collectedCodes = [null, null, null];
  let safeOpened = false;

  // Modal code-entry state
  let codeInputMode = false;
  let codeBuffer = '';
  let codeShake = 0;
  let codeMessage = '';     // transient feedback line
  let codeMessageTimer = 0;
  let interactQueued = false;

  function setFloors(arr) {
    FLOORS = arr;
    FLOOR_Y = arr.map(f => f.y);
  }

  // ───────────────────────────────────────────────────────────────────────
  //  SCREEN LOADER  (each screen has its own platforms, decor, enemies)
  // ───────────────────────────────────────────────────────────────────────
  function loadScreen(n) {
    screen = n;
    BOAT = null;
    RIVER = null;
    MOV_PLATS = [];
    KEY = null;
    CHEST = null;
    POTION = null;
    FRAGMENT = null;
    SAFE = null;
    BUSHES = [];
    ROCKS = [];
    TREES = [];
    LADDERS = [];
    STALACTITES = [];
    STALAGMITES = [];
    CRYSTALS = [];
    TORCHES = [];
    codeInputMode = false;
    codeBuffer = '';

    if (n === 0) {
      // ───── Screen 0: Forest at night
      setFloors([
        { y: 12,  left: 2, right: 196, theme: 'wood-light' },
        { y: 36, left: 2, right: 196, theme: 'wood-mid' },
        { y: 60, left: 2, right: 196, theme: 'wood-dark' },
      ]);
      LADDERS = [
        { x: 44, top: 12,  bottom: 36 },
        { x: 140, top: 12,  bottom: 36 },
        { x: 76, top: 36, bottom: 60 },
        { x: 168, top: 36, bottom: 60 },
      ];
      TREES = [
        { x: 16,  floorIdx: 2, kind: 'pine' },
        { x: 100, floorIdx: 2, kind: 'round' },
        { x: 184, floorIdx: 2, kind: 'pine' },
        { x: 30, floorIdx: 1, kind: 'round' },
        { x: 112, floorIdx: 1, kind: 'pine' },
        { x: 180, floorIdx: 1, kind: 'round' },
        { x: 20, floorIdx: 0, kind: 'pine' },
        { x: 160, floorIdx: 0, kind: 'round' },
      ];
      BUSHES = [
        { x: 36, floorIdx: 2 }, { x: 60, floorIdx: 2 },
        { x: 120, floorIdx: 2 }, { x: 152, floorIdx: 2 },
        { x: 52, floorIdx: 1 }, { x: 90, floorIdx: 1 },
        { x: 152, floorIdx: 1 }, { x: 8,  floorIdx: 1 },
        { x: 40, floorIdx: 0 }, { x: 140, floorIdx: 0 },
      ];
      ROCKS = [
        { x: 84, floorIdx: 2 }, { x: 176, floorIdx: 2 },
        { x: 128, floorIdx: 1 }, { x: 60, floorIdx: 0 },
      ];
      CHEST = { x: 88, floorIdx: 0 };
      KEY   = { x: 104, floorIdx: 0, collected: false };
      // Optional code fragment (digits "47") + healing potion
      FRAGMENT = { x: 72, floorIdx: 1, digits: FRAGMENT_DIGITS[0], levelIdx: 0, collected: !!collectedCodes[0] };
      POTION   = { x: 128, floorIdx: 2, collected: false };
      GOAL  = 'pickup-key';

    } else if (n === 1) {
      // ───── Screen 1: River crossing with a boat
      setFloors([
        { y: 52, left: 2,  right: 48, theme: 'bank' },  // left bank
        { y: 52, left: 152, right: 196, theme: 'bank' },  // right bank
      ]);
      RIVER = { left: 48, right: 152, top: 52 };
      BOAT = {
        baseX: 100, baseY: 50,
        x: 60,             // updated each frame
        y: 50,
        w: 7, h: 1,
        range: 44,         // half-amplitude
        phase: -Math.PI / 2,
        speed: 0.42,       // radians per second
        prevX: 30,
      };
      // Add boat as a moving platform (last entry in FLOORS).
      FLOORS.push({ y: BOAT.y, left: BOAT.x, right: BOAT.x + BOAT.w - 1, isBoat: true });
      FLOOR_Y = FLOORS.map(f => f.y);
      // No ladders; decorations.
      TREES = [
        { x: 16,  floorIdx: 0, kind: 'round' },
        { x: 36, floorIdx: 0, kind: 'pine' },
        { x: 164, floorIdx: 1, kind: 'pine' },
        { x: 184, floorIdx: 1, kind: 'round' },
      ];
      BUSHES = [
        { x: 8,  floorIdx: 0 }, { x: 28, floorIdx: 0 },
        { x: 172, floorIdx: 1 }, { x: 192, floorIdx: 1 },
      ];
      ROCKS = [
        { x: 44, floorIdx: 0 }, { x: 156, floorIdx: 1 },
      ];
      FRAGMENT = { x: 20, floorIdx: 0, digits: FRAGMENT_DIGITS[1], levelIdx: 1, collected: !!collectedCodes[1] };
      POTION   = { x: 180, floorIdx: 1, collected: false };
      GOAL = 'reach-right';

    } else if (n === 2) {
      // ───── Screen 2: Flying platforms in the sky
      setFloors([
        { y: 60, left: 2,  right: 28, theme: 'cloud' },   // start
        { y: 52, left: 36, right: 52, theme: 'cloud', oscY: { phase: 0,        amp: 2.4, speed: 1.0 } },
        { y: 44, left: 64, right: 80, theme: 'cloud' },
        { y: 36, left: 92, right: 108, theme: 'cloud', oscY: { phase: Math.PI/2,amp: 2.8, speed: 0.8 } },
        { y: 28, left: 120, right: 136, theme: 'cloud' },
        { y: 20, left: 148, right: 164, theme: 'cloud', oscY: { phase: Math.PI,  amp: 2.4, speed: 1.2 } },
        { y: 12,  left: 172, right: 196, theme: 'cloud' },   // goal
      ]);
      // Stash baseY and originals for oscillation.
      for (const f of FLOORS) {
        if (f.oscY) { f.baseY = f.y; f.prevY = f.y; }
      }
      // No final key here any more — sky goal is now reach-right (advance
      // into the cave).  Fragment + potion live on the path.
      FRAGMENT = { x: 72, floorIdx: 2, digits: FRAGMENT_DIGITS[2], levelIdx: 2, collected: !!collectedCodes[2] };
      POTION   = { x: 124, floorIdx: 4, collected: false };
      BUSHES = [];
      ROCKS  = [];
      TREES  = [];
      LADDERS = [];
      GOAL = 'reach-right';

    } else if (n === 3) {
      // ───── Screen 3: Cave with the safe
      setFloors([
        { y: 60, left: 2,  right: 196, theme: 'stone' },  // 0  main bottom
        { y: 40, left: 44, right: 156, theme: 'stone' },  // 1  mid (safe here)
        { y: 20, left: 2,  right: 64, theme: 'stone' },  // 2  upper-left
        { y: 20, left: 132, right: 196, theme: 'stone' },  // 3  upper-right (key here)
      ]);
      LADDERS = [
        { x: 60, top: 40, bottom: 60 },
        { x: 140, top: 40, bottom: 60 },
        { x: 52, top: 20, bottom: 40 },
        { x: 144, top: 20, bottom: 40 },
      ];
      // Decorations: stalactites along ceiling, stalagmites on bottom,
      // crystals embedded in walls, torches for atmosphere.
      STALACTITES = [
        { x: 12 }, { x: 28 }, { x: 44 }, { x: 76 }, { x: 100 },
        { x: 124 }, { x: 152 }, { x: 172 }, { x: 188 },
      ];
      STALAGMITES = [
        { x: 16, floorIdx: 0 }, { x: 32, floorIdx: 0 }, { x: 156, floorIdx: 0 },
        { x: 176, floorIdx: 0 }, { x: 80, floorIdx: 1 }, { x: 120, floorIdx: 1 },
      ];
      CRYSTALS = [
        { x: 8,  y: 12,  color: 'teal'   },
        { x: 192, y: 12,  color: 'purple' },
        { x: 24, y: 32, color: 'pink'   },
        { x: 176, y: 32, color: 'teal'   },
        { x: 8,  y: 52, color: 'purple' },
        { x: 192, y: 52, color: 'pink'   },
      ];
      TORCHES = [
        { x: 36, floorIdx: 0 }, { x: 160, floorIdx: 0 },
        { x: 60, floorIdx: 1 }, { x: 140, floorIdx: 1 },
      ];
      CHEST = { x: 176, floorIdx: 3 };
      KEY   = { x: 184, floorIdx: 3, collected: false };
      POTION = { x: 100, floorIdx: 0, collected: false };
      SAFE = { x: 96, floorIdx: 1, opened: safeOpened };
      // Cave's key now opens the way to the snow boss arena.
      GOAL = 'pickup-key';

    } else if (n === 4) {
      // ───── Screen 4: Snowy boss arena (3 floors + ladders)
      setFloors([
        { y: 12,  left: 2, right: 196, theme: 'snow' },
        { y: 36, left: 2, right: 196, theme: 'snow' },
        { y: 60, left: 2, right: 196, theme: 'snow' },
      ]);
      LADDERS = [
        { x: 48, top: 12,  bottom: 36 },
        { x: 152, top: 12,  bottom: 36 },
        { x: 80, top: 36, bottom: 60 },
        { x: 172, top: 36, bottom: 60 },
      ];
      TREES = [
        { x: 20, floorIdx: 2, kind: 'snow-pine' },
        { x: 104, floorIdx: 2, kind: 'snow-pine' },
        { x: 184, floorIdx: 2, kind: 'snow-pine' },
        { x: 28, floorIdx: 1, kind: 'snow-pine' },
        { x: 116, floorIdx: 1, kind: 'snow-pine' },
        { x: 180, floorIdx: 1, kind: 'snow-pine' },
      ];
      BUSHES = [];
      ROCKS = [];
      // Build snowflake storm for ambient effect
      SNOWFLAKES.length = 0;
      for (let i = 0; i < 80; i++) {
        SNOWFLAKES.push({
          x: Math.random() * COLS,
          y: Math.random() * ROWS,
          vy: 3 + Math.random() * 5,
          vx: -0.8 + Math.random() * 1.6,
          ch: Math.random() < 0.5 ? '*' : (Math.random() < 0.5 ? '·' : '❄'),
          phase: Math.random() * Math.PI * 2,
        });
      }
      GOAL = 'defeat-snowman';
      // Dog created below after player position is finalised.
      dog = null;
    }

    // Player starting position (shared with respawnPlayer())
    const sp = spawnPosFor(n);
    player.x = sp.x; player.y = sp.y; player.floorIdx = sp.floorIdx;
    player.vx = 0; player.vy = 0;
    player.state = 'stand'; player.facing = 1;
    player.onLadder = false; player.ladderIdx = -1;
    player.onBoat = false;

    // Spawn the dog companion now (after player position is final).
    if (n === 4 && safeOpened) {
      dog = {
        x: Math.max(2, player.x - 4),
        y: player.y,
        vx: 0,
        facing: 1,
        biteCool: 0.6,
        biteFlash: 0,
        mood: 'follow',
        bobPhase: 0,
      };
    }

    spawnEnemiesForScreen(n);
  }

  function advanceScreen() {
    const next = screen + 1;
    if (next >= NUM_SCREENS) {
      gameState = 'won';
      if (safeOpened) {
        overlayText.textContent = 'PERFECT VICTORY! ★';
        overlaySub.textContent = 'You opened the safe — click to play again';
      } else {
        overlayText.textContent = 'YOU WIN!';
        overlaySub.textContent = 'Click to play again';
      }
      overlay.classList.remove('hidden');
      setTimeout(winSound, 200);
      return;
    }
    // Brief flash then load next screen.
    spawnParticles(player.x + 1, player.y + 1, {
      count: 30,
      colors: ['#ffd56b', '#ffe69a', '#ffffff'],
      chars: ['✦', '*', '+', '·'],
    });
    setTimeout(() => {
      loadScreen(next);
      pickupSound();
    }, 250);
  }

  function submitCode() {
    if (codeBuffer === SAFE_CODE) {
      safeOpened = true;
      if (SAFE) SAFE.opened = true;
      codeMessage = 'SAFE OPENED!';
      codeMessageTimer = 1.8;
      codeBuffer = '';
      // Big payoff
      const notes = [523, 659, 784, 1046, 1318];
      notes.forEach((n, i) => setTimeout(() => blip(n, 0.18, 'triangle', 0.07), i * 90));
      if (SAFE) {
        spawnParticles(SAFE.x + 4, FLOORS[SAFE.floorIdx].y - 3, {
          count: 60,
          colors: ['#ffd56b','#ffe69a','#ffffff','#ff9a3a'],
          chars: ['★','✦','✧','*','+','·'],
        });
      }
      setTimeout(() => { codeInputMode = false; }, 900);
    } else {
      codeMessage = 'WRONG CODE — TRY AGAIN';
      codeMessageTimer = 1.2;
      codeBuffer = '';
      codeShake = 0.3;
      blip(180, 0.18, 'sawtooth', 0.05, 80);
    }
  }

  function spawnEnemiesForScreen(n) {
    if (n === 0) {
      enemies = [
        { type: 'slime', x: 72, y: FLOORS[2].y - 2, vx: 9, facing: 1, hp: 1, maxHp: 1,
          floorIdx: 2, minX: 48, maxX: 140, hop: 0, hurt: 0, dead: 0,
          w: 5, h: 2, originY: FLOORS[2].y - 2 },
        { type: 'slime', x: 140, y: FLOORS[0].y - 2, vx: -8, facing: -1, hp: 1, maxHp: 1,
          floorIdx: 0, minX: 116, maxX: 180, hop: 0, hurt: 0, dead: 0,
          w: 5, h: 2, originY: FLOORS[0].y - 2 },
        { type: 'skel', x: 112, y: FLOORS[1].y - 3, vx: -12, facing: -1, hp: 2, maxHp: 2,
          floorIdx: 1, minX: 52, maxX: 160, walk: 0, hurt: 0, dead: 0,
          w: 3, h: 3, originY: FLOORS[1].y - 3 },
        { type: 'skel', x: 168, y: FLOORS[2].y - 3, vx: 10, facing: 1, hp: 2, maxHp: 2,
          floorIdx: 2, minX: 148, maxX: 190, walk: 0, hurt: 0, dead: 0,
          w: 3, h: 3, originY: FLOORS[2].y - 3 },
        { type: 'ghost', cx: 100, cy: 26, rx: 28, ry: 8,
          x: 98, y: 26, phase: 0, pSpeed: 0.9, hp: 1, maxHp: 1,
          facing: 1, hurt: 0, dead: 0, w: 3, h: 3 },
      ];
    } else if (n === 1) {
      // River screen: two patrolling slimes on the banks + a ghost over water
      enemies = [
        { type: 'slime', x: 28, y: FLOORS[0].y - 2, vx: 7, facing: 1, hp: 1, maxHp: 1,
          floorIdx: 0, minX: 8, maxX: 44, hop: 0, hurt: 0, dead: 0,
          w: 5, h: 2, originY: FLOORS[0].y - 2 },
        { type: 'slime', x: 164, y: FLOORS[1].y - 2, vx: 7, facing: 1, hp: 1, maxHp: 1,
          floorIdx: 1, minX: 156, maxX: 188, hop: 0, hurt: 0, dead: 0,
          w: 5, h: 2, originY: FLOORS[1].y - 2 },
        { type: 'ghost', cx: 100, cy: 38, rx: 36, ry: 6,
          x: 98, y: 38, phase: 0, pSpeed: 1.1, hp: 1, maxHp: 1,
          facing: 1, hurt: 0, dead: 0, w: 3, h: 3 },
      ];
    } else if (n === 2) {
      // Sky screen: a couple of ghosts patrolling between platforms
      enemies = [
        { type: 'ghost', cx: 70, cy: 44, rx: 20, ry: 6,
          x: 68, y: 44, phase: 0, pSpeed: 1.2, hp: 1, maxHp: 1,
          facing: 1, hurt: 0, dead: 0, w: 3, h: 3 },
        { type: 'ghost', cx: 130, cy: 28, rx: 16, ry: 4,
          x: 128, y: 28, phase: Math.PI, pSpeed: 1.0, hp: 1, maxHp: 1,
          facing: 1, hurt: 0, dead: 0, w: 3, h: 3 },
        { type: 'slime', x: 150, y: FLOORS[5].y - 2, vx: 5, facing: 1, hp: 1, maxHp: 1,
          floorIdx: 5, minX: 148, maxX: 156, hop: 0, hurt: 0, dead: 0,
          w: 5, h: 2, originY: FLOORS[5].y - 2 },
      ];
    } else if (n === 3) {
      // Cave screen: two skeletons + ghost + slime
      enemies = [
        { type: 'skel', x: 100, y: FLOORS[0].y - 3, vx: 10, facing: 1, hp: 2, maxHp: 2,
          floorIdx: 0, minX: 44, maxX: 156, walk: 0, hurt: 0, dead: 0,
          w: 3, h: 3, originY: FLOORS[0].y - 3 },
        { type: 'skel', x: 76, y: FLOORS[1].y - 3, vx: -8, facing: -1, hp: 2, maxHp: 2,
          floorIdx: 1, minX: 48, maxX: 120, walk: 0, hurt: 0, dead: 0,
          w: 3, h: 3, originY: FLOORS[1].y - 3 },
        { type: 'slime', x: 160, y: FLOORS[3].y - 2, vx: 7, facing: 1, hp: 1, maxHp: 1,
          floorIdx: 3, minX: 136, maxX: 184, hop: 0, hurt: 0, dead: 0,
          w: 5, h: 2, originY: FLOORS[3].y - 2 },
        { type: 'ghost', cx: 100, cy: 28, rx: 32, ry: 6,
          x: 98, y: 28, phase: 0, pSpeed: 1.0, hp: 1, maxHp: 1,
          facing: 1, hurt: 0, dead: 0, w: 3, h: 3 },
      ];
    } else if (n === 4) {
      // Snowy boss arena — just the snowman.
      enemies = [
        { type: 'snowman',
          x: 140, y: FLOORS[0].y - 4,
          vx: 0, facing: -1,
          hp: 10, maxHp: 10, hurt: 0, dead: 0,
          w: 5, h: 4,
          floorIdx: 0, floorY: FLOORS[0].y,
          climbing: null,            // null | 'up' | 'down'
          targetFloorIdx: -1,
          targetFloorY: 0,
          walk: 0,
          repath: 0,
        },
      ];
    } else {
      enemies = [];
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  //  STARFIELD + MOON
  // ───────────────────────────────────────────────────────────────────────
  const STAR_CHARS = ['·', '·', '+', '*', '✦', '·'];
  const STARS = [];
  for (let i = 0; i < 70; i++) {
    STARS.push({
      x: Math.random() * COLS,
      y: Math.random() * 11,
      ch: STAR_CHARS[(Math.random() * STAR_CHARS.length) | 0],
      phase: Math.random() * Math.PI * 2,
      speed: 0.5 + Math.random() * 1.5,
    });
  }

  const MOON = { x: 164, y: 2 };
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
      y: 0 + ((Math.random() * 6) | 0),
      speed: 1.2 + Math.random() * 2.8,
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
      cx: 8 + Math.random() * (COLS - 16),
      cy: 16 + Math.random() * 40,
      rx: 4 + Math.random() * 10,
      ry: 2 + Math.random() * 4,
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
    x: 12,
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
    lives: 3,
    maxLives: 3,
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
    walkSpeed: 24,        // cells per second
    climbSpeed: 16,
    jumpV: -56,           // initial vy on jump
    gravity: 130,
    maxFall: 64,
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

  // Snowman boss — 5 wide × 4 rows tall, two-frame bob/blink.
  const SNOWMAN_A = [
    '  ▲  ',
    ' ___ ',
    '(O O)',
    '(═v═)',
  ];
  const SNOWMAN_B = [
    '  ▲  ',
    ' ___ ',
    '(o o)',
    '(═V═)',
  ];
  const SNOWMAN_COLORS = ['#4a5070', '#cad8e8', '#1a1a22', '#cad8e8'];
  const SNOWMAN_HURT_COLORS = ['#4a5070', '#ff5070', '#ff5070', '#ff5070'];

  // Dog companion — 2 rows × 4 wide.  Right-facing; mirror for left.
  const DOG_R = [
    ' ___',
    '(•‿•)>',
  ];
  // Use a stable visual: head + body + tail.  Width 6 to give us room
  // for the tail glyph (`>` or `<`).
  const DOG_R_5 = [
    ' ╭⌒╮  ',
    '(◕‿◕)>',
  ];
  const DOG_L_5 = [
    '  ╭⌒╮ ',
    '<(◕‿◕)',
  ];
  const DOG_COLORS = ['#caa070', '#7a4a22'];

  // Enemy registry — built fresh by loadScreen() so death state resets.
  let enemies = [];

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
  //  ITEM SPRITES (potion + code fragment + safe + cave decor)
  // ───────────────────────────────────────────────────────────────────────
  const POTION_SPRITE = [
    '╭─╮',
    '│♥│',
    '╰─╯',
  ];
  const POTION_COLORS = ['#a04060', '#ff5070', '#a04060'];

  // Fragment shows 2 digits — sprite is a small scroll/tablet 4 wide.
  function makeFragmentSprite(digits) {
    return [
      '┌──┐',
      '│' + digits + '│',
      '└──┘',
    ];
  }
  const FRAGMENT_COLORS = ['#caa070', '#ffd56b', '#caa070'];

  // Safe sprite 10 wide × 5 rows (locked).  The 6-digit window will be
  // overlaid by drawSafe() with the current display state.
  const SAFE_LOCKED = [
    '╔════════╗',
    '║▒▒▒▒▒▒▒▒║',
    '║┌──────┐║',
    '║│DDDDDD│║',
    '║└──◉───┘║',
    '╚════════╝',
  ];
  const SAFE_OPENED = [
    '╔════════╗',
    '║░░░░░░░░║',
    '║┌──────┐║',
    '║│★★★★★★│║',
    '║│  ✓✓  │║',
    '╚════════╝',
  ];
  const SAFE_COLORS = ['#7a7e88', '#5a5d66', '#7a7e88', '#caa070', '#5a5d66', '#7a7e88'];
  const SAFE_OPEN_COLORS = ['#caa070', '#ffd56b', '#caa070', '#ffd56b', '#ffe69a', '#caa070'];

  const STALACTITE = [' ▼ ', ' │ '];
  const STALACTITE_COLORS = ['#5a4a3a', '#3a2c22'];
  const STALAGMITE = [' │ ', ' ▲ '];
  const STALAGMITE_COLORS = ['#3a2c22', '#5a4a3a'];
  const CRYSTAL = [' ◆ '];
  const CRYSTAL_COLORS = { teal: '#6fe8d0', purple: '#c060e0', pink: '#ff80a0' };
  const TORCH = [' ▲ ', ' │ '];
  const TORCH_FIRE_COLORS = ['#ffb45a', '#ff6a30'];
  const TORCH_STICK_COLOR = '#7a4a22';

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
      const s = 8 + Math.random() * 20;
      particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s - 8,
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
      p.vy += dt * 36;        // gravity
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
      if (c.x > COLS + 1) c.x = -shapeW - Math.random() * 20;
    }
  }
  function updateShootingStars(dt) {
    if (Math.random() < dt * 0.35) {
      const fromLeft = Math.random() < 0.5;
      SHOOTING_STARS.push({
        x: fromLeft ? -2 : COLS + 2,
        y: Math.random() * 8,
        vx: fromLeft ? 110 + Math.random() * 50 : -(110 + Math.random() * 50),
        vy: 24 + Math.random() * 36,
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
        y: 2 + Math.random() * 6,
        vx: goingRight ? 18 + Math.random() * 8 : -(18 + Math.random() * 8),
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
  //  MOVING PLATFORMS  (boat on screen 1; oscillating platforms on screen 2)
  // ───────────────────────────────────────────────────────────────────────
  // For each moving floor we record dx/dy from the previous frame so the
  // player riding on it gets carried along.  Player position is updated
  // BEFORE input/gravity so subsequent collision still works cleanly.
  function updatePlatforms(dt) {
    if (BOAT) {
      BOAT.prevX = BOAT.x;
      BOAT.phase += dt * BOAT.speed;
      BOAT.x = BOAT.baseX + Math.sin(BOAT.phase) * BOAT.range;
      // Update the corresponding FLOOR entry so collision uses fresh bounds.
      const f = FLOORS.find(fl => fl.isBoat);
      if (f) {
        f.left = BOAT.x;
        f.right = BOAT.x + BOAT.w - 1;
      }
    }
    for (const f of FLOORS) {
      if (f.oscY) {
        f.prevY = f.y;
        f.oscY.phase += dt * f.oscY.speed;
        f.y = f.baseY + Math.sin(f.oscY.phase) * f.oscY.amp;
      }
    }
    FLOOR_Y = FLOORS.map(f => f.y);
  }

  function carryPlayerOnPlatform() {
    if (player.onLadder || player.dead) return;
    if (player.vy !== 0) return;
    const cur = FLOORS[player.floorIdx];
    if (!cur) return;
    if (cur.isBoat && BOAT) {
      const dx = BOAT.x - BOAT.prevX;
      player.x += dx;
    }
    if (cur.oscY) {
      const dy = cur.y - cur.prevY;
      player.y += dy;
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
    ensureAudio();
    // Code-entry modal eats nearly all input while open.
    if (codeInputMode) {
      e.preventDefault();
      if (k >= '0' && k <= '9') {
        if (codeBuffer.length < 6) {
          codeBuffer += k;
          blip(720, 0.03, 'square', 0.03);
          if (codeBuffer.length === 6) submitCode();
        }
      } else if (k === 'Backspace') {
        codeBuffer = codeBuffer.slice(0, -1);
        blip(360, 0.03, 'square', 0.03);
      } else if (k === 'Enter') {
        if (codeBuffer.length > 0) submitCode();
      } else if (k === 'Escape' || k === 'e' || k === 'E') {
        codeInputMode = false;
        codeBuffer = '';
      }
      return;
    }
    if (['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' ','Spacebar'].includes(k)) e.preventDefault();
    if (k === ' ' && !keys[' ']) jumpQueued = true;
    if (ATTACK_KEYS.has(k) && !keys[k]) attackQueued = true;
    if ((k === 'e' || k === 'E') && !keys[k]) interactQueued = true;
    if (k === 'm' || k === 'M') {
      soundOn = !soundOn;
      sndBtn.textContent = soundOn ? 'ON' : 'OFF';
    }
    keys[k] = true;
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

  function spawnPosFor(n) {
    if (n === 0) return { x: 12,  y: FLOORS[2].y - 3, floorIdx: 2 };
    if (n === 1) return { x: 8,  y: FLOORS[0].y - 3, floorIdx: 0 };
    if (n === 2) return { x: 8,  y: FLOORS[0].y - 3, floorIdx: 0 };
    if (n === 3) return { x: 12,  y: FLOORS[0].y - 3, floorIdx: 0 };
    return            { x: 12,  y: FLOORS[2].y - 3, floorIdx: 2 };
  }

  function respawnPlayer() {
    const sp = spawnPosFor(screen);
    player.x = sp.x; player.y = sp.y; player.floorIdx = sp.floorIdx;
    player.vx = 0; player.vy = 0;
    player.facing = 1;
    player.state = 'stand';
    player.onLadder = false;
    player.ladderIdx = -1;
    player.onBoat = false;
    player.hp = player.maxHp;
    player.invul = PLAYER_INVUL * 2;   // generous post-respawn grace
    player.attack = 0;
    player.attackCool = 0;
    player.hurtFlash = 0;
    player.dead = false;
    // Sparkle to make the respawn visible.
    spawnParticles(player.x + 1, player.y + 1, {
      count: 26, colors: ['#7fc8ff','#ffffff','#a8e0ff'], chars: ['*','+','✦','·'],
    });
    blip(660, 0.10, 'square', 0.05);
    setTimeout(() => blip(880, 0.12, 'triangle', 0.05), 90);
  }

  function resetGame() {
    player.hp = player.maxHp;
    player.lives = player.maxLives;
    player.invul = 0;
    player.attack = 0;
    player.attackCool = 0;
    player.hurtFlash = 0;
    player.dead = false;
    particles.length = 0;
    SHOOTING_STARS.length = 0;
    BATS.length = 0;
    collectedCodes = [null, null, null];
    safeOpened = false;
    codeInputMode = false;
    codeBuffer = '';
    dog = null;
    SNOWFLAKES.length = 0;
    loadScreen(0);
  }
  loadScreen(0);

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
    updatePlatforms(dt);
    updateEnemies(dt);
    updateDog(dt);
    updateSnowflakes(dt);

    if (gameState !== 'playing') {
      updateParticles(dt);
      return;
    }

    // Freeze player physics while the code-entry modal is open.
    if (codeInputMode) {
      if (codeMessageTimer > 0) codeMessageTimer -= dt;
      if (codeShake > 0) codeShake -= dt;
      updateParticles(dt);
      return;
    }

    carryPlayerOnPlatform();

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

      // Walk off the edge of a partial platform → start falling.
      if (player.vy === 0 && !player.onLadder) {
        const cur = FLOORS[player.floorIdx];
        const pcx = player.x + 1;
        if (cur && (pcx < cur.left - 0.5 || pcx > cur.right + 0.5)) {
          player.vy = 0.1;
          player.state = 'jump';
          player.floorIdx = -1;
          player.onBoat = false;
        }
      }

      // Gravity
      if (!onGround) player.vy = clamp(player.vy + PHYS.gravity * dt, -100, PHYS.maxFall);

      // Apply velocity
      const prevY = player.y;
      player.x += player.vx * dt;
      player.y += player.vy * dt;
      player.x = clamp(player.x, -1, COLS - 2);

      // Land on a platform (partial floors must check horizontal range too).
      const footRow = player.y + 3;
      const pcx = player.x + 1;     // player center column
      for (let i = 0; i < FLOORS.length; i++) {
        const f = FLOORS[i];
        const fy = f.y;
        const inX = pcx >= f.left - 0.5 && pcx <= f.right + 0.5;
        const prevFoot = prevY + 3;
        if (inX && prevFoot <= fy && footRow >= fy && player.vy >= 0) {
          player.y = fy - 3;
          player.vy = 0;
          player.floorIdx = i;
          player.onBoat = !!f.isBoat;
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

    // ── KEY PICKUP / SCREEN GOAL ────────────────────────────────────
    if (KEY && !KEY.collected) {
      const keyRow = FLOORS[KEY.floorIdx].y - 2;
      const dx = (player.x + 1) - (KEY.x + 1);
      const dy = (player.y + 1.5) - (keyRow + 0.5);
      if (Math.abs(dx) < 4 && Math.abs(dy) < 5) {
        KEY.collected = true;
        pickupSound();
        spawnParticles(KEY.x + 1, keyRow);
        if (GOAL === 'pickup-key') {
          advanceScreen();
        } else if (GOAL === 'final-key') {
          setTimeout(winSound, 400);
          setTimeout(() => {
            gameState = 'won';
            if (safeOpened) {
              overlayText.textContent = 'PERFECT VICTORY! ★';
              overlaySub.textContent = 'You opened the safe — click to play again';
            } else {
              overlayText.textContent = 'YOU WIN!';
              overlaySub.textContent = 'Click to play again';
            }
            overlay.classList.remove('hidden');
          }, 800);
        }
      }
    }
    if (GOAL === 'reach-right' && player.x >= COLS - 8 && !player.onLadder && player.vy === 0) {
      advanceScreen();
    }
    if (GOAL === 'defeat-snowman' && gameState === 'playing') {
      const alive = enemies.some(e => e.type === 'snowman' && e.hp > 0);
      if (!alive) {
        // Boss down — final win!
        GOAL = 'won';
        setTimeout(winSound, 200);
        setTimeout(() => {
          gameState = 'won';
          if (safeOpened) {
            overlayText.textContent = 'PERFECT VICTORY! ★';
            overlaySub.textContent = 'You befriended a dog and defeated the boss';
          } else {
            overlayText.textContent = 'YOU WIN!';
            overlaySub.textContent = 'The snowman is defeated — click to play again';
          }
          overlay.classList.remove('hidden');
        }, 900);
      }
    }

    // ── POTION PICKUP (heals +1 HP, capped at maxHp) ────────────────
    if (POTION && !POTION.collected) {
      const py = FLOORS[POTION.floorIdx].y - 3;
      const ddx = (player.x + 1) - (POTION.x + 1);
      const ddy = (player.y + 1.5) - (py + 1.5);
      if (Math.abs(ddx) < 4 && Math.abs(ddy) < 5) {
        POTION.collected = true;
        if (player.hp < player.maxHp) player.hp += 1;
        // Sparkle + tone
        blip(660, 0.08, 'square', 0.06);
        setTimeout(() => blip(880, 0.10, 'square', 0.06), 60);
        setTimeout(() => blip(1175, 0.14, 'triangle', 0.07), 130);
        spawnParticles(POTION.x + 1, py + 1.5, { count: 18, colors: ['#ff5070','#ff9aa0','#ffffff'], chars: ['♥','·','*','+'] });
      }
    }

    // ── CODE FRAGMENT PICKUP (records 2 digits) ─────────────────────
    if (FRAGMENT && !FRAGMENT.collected) {
      const fy = FLOORS[FRAGMENT.floorIdx].y - 3;
      const ddx = (player.x + 1) - (FRAGMENT.x + 1);
      const ddy = (player.y + 1.5) - (fy + 1.5);
      if (Math.abs(ddx) < 10 && Math.abs(ddy) < 5) {
        FRAGMENT.collected = true;
        collectedCodes[FRAGMENT.levelIdx] = FRAGMENT.digits;
        blip(523, 0.10, 'square', 0.06);
        setTimeout(() => blip(784, 0.12, 'square', 0.06), 90);
        setTimeout(() => blip(1046, 0.14, 'square', 0.06), 180);
        spawnParticles(FRAGMENT.x + 1, fy + 1.5, { count: 22, colors: ['#ffd56b','#ffe69a','#ffffff'], chars: ['*','+','✦','★'] });
      }
    }

    // ── SAFE INTERACTION (press E near the safe to enter code) ──────
    if (SAFE && interactQueued && !codeInputMode) {
      const sy = FLOORS[SAFE.floorIdx].y - 6;
      const ddx = (player.x + 1) - (SAFE.x + 4);
      const ddy = (player.y + 1.5) - (sy + 2.5);
      if (Math.abs(ddx) < 10 && Math.abs(ddy) < 8 && !SAFE.opened) {
        codeInputMode = true;
        codeBuffer = '';
        codeMessage = 'ENTER 6-DIGIT CODE';
        codeMessageTimer = 0;
        blip(440, 0.10, 'triangle', 0.05);
      }
    }
    interactQueued = false;

    if (codeMessageTimer > 0) codeMessageTimer -= dt;
    if (codeShake > 0) codeShake -= dt;

    // ── OUT-OF-BOUNDS DEATH (fell off the world) ────────────────────
    if (player.y > ROWS + 1 && !player.dead) {
      player.hp = 0;
      hurtSound();
    }
    // Falling into the river on screen 1 → instant death
    if (screen === 1 && RIVER && !player.dead && player.vy > 0 &&
        player.x + 1 >= RIVER.left && player.x + 1 <= RIVER.right &&
        player.y + 3 >= RIVER.top + 1 && !player.onBoat) {
      // Player has hit the water
      player.hp = 0;
      hurtSound();
      spawnParticles(player.x + 1, RIVER.top, { count: 20, colors: ['#7fc8ff', '#a8e0ff', '#ffffff'], chars: ['~','≈','*','·'] });
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
      spawnParticles(player.x + 1, player.y + 1.5, { count: 30, colors: ['#ff6464','#ff9a3a','#ffd56b'] });
      if (player.lives > 0) {
        // Continue — respawn on this same screen after a short pause.
        player.lives -= 1;
        blip(300, 0.18, 'sawtooth', 0.05, 140);
        setTimeout(() => respawnPlayer(), 850);
      } else {
        gameOverSound();
        setTimeout(() => {
          gameState = 'gameover';
          overlayText.textContent = 'GAME OVER';
          overlaySub.textContent = 'Click to start a new game';
          overlay.classList.remove('hidden');
        }, 700);
      }
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
      if (e.hp <= 0) {
        // Dying — count down the fade-out, no AI.
        if (e.dead > 0) e.dead -= dt;
        continue;
      }
      if (e.hurt > 0) e.hurt -= dt;
      if (e.type === 'slime') {
        // Track the platform's current y (it may oscillate).
        if (e.floorIdx >= 0 && FLOORS[e.floorIdx]) e.originY = FLOORS[e.floorIdx].y - 2;
        e.x += e.vx * dt;
        if (e.x <= e.minX) { e.x = e.minX; e.vx = Math.abs(e.vx); e.facing = 1; }
        else if (e.x >= e.maxX) { e.x = e.maxX; e.vx = -Math.abs(e.vx); e.facing = -1; }
        e.hop += dt * 4.5;
        e.y = e.originY - Math.abs(Math.sin(e.hop)) * 1.5;
      } else if (e.type === 'skel') {
        if (e.floorIdx >= 0 && FLOORS[e.floorIdx]) e.originY = FLOORS[e.floorIdx].y - 3;
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
      } else if (e.type === 'snowman') {
        updateSnowman(e, dt);
      }
    }
    // Cull dead enemies whose fade-out finished.
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.hp <= 0 && e.dead <= 0.2) enemies.splice(i, 1);
    }
  }

  function rectOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }

  // ───────────────────────────────────────────────────────────────────────
  //  SNOWMAN BOSS AI  (walks toward player, climbs ladders to follow)
  // ───────────────────────────────────────────────────────────────────────
  const SNOWMAN_WALK = 14;        // cells/sec — slower than the player (12)
  const SNOWMAN_CLIMB = 10;

  function findLadderNear(x, fromFloorIdx, wantTopY) {
    // Find a ladder at this floor whose other end is wantTopY.
    let best = null;
    let bestDx = Infinity;
    const fromFloorY = FLOORS[fromFloorIdx] ? FLOORS[fromFloorIdx].y : null;
    if (fromFloorY === null) return null;
    for (const l of LADDERS) {
      const matches = (l.bottom === fromFloorY && l.top === wantTopY) ||
                      (l.top    === fromFloorY && l.bottom === wantTopY);
      if (!matches) continue;
      const d = Math.abs(l.x - (x + 2));   // snowman center is ~x+2
      if (d < bestDx) { bestDx = d; best = l; }
    }
    return best;
  }

  function updateSnowman(s, dt) {
    // While climbing, just move vertically.
    if (s.climbing) {
      const dir = s.climbing === 'up' ? -1 : 1;
      s.y += dir * SNOWMAN_CLIMB * dt;
      // Done?
      const targetY = s.targetFloorY - 4;
      const reached = (dir < 0 && s.y <= targetY) || (dir > 0 && s.y >= targetY);
      if (reached) {
        s.y = targetY;
        s.floorIdx = s.targetFloorIdx;
        s.floorY = s.targetFloorY;
        s.climbing = null;
      }
      s.walk += dt * 4;
      return;
    }
    // Otherwise: walking on current floor.  Sit on the floor and chase.
    const f = FLOORS[s.floorIdx];
    if (!f) return;
    s.y = f.y - 4;
    s.floorY = f.y;

    const playerFloor = FLOORS[player.floorIdx];
    const playerFloorY = playerFloor ? playerFloor.y : null;

    // Decide whether to look for a ladder.
    s.repath -= dt;
    if (playerFloorY !== null && playerFloorY !== s.floorY && s.repath <= 0) {
      // Want to head to the ladder at the level above/below that leads
      // one step toward the player.  We always step one floor toward
      // the player rather than the destination directly.
      const goUp = playerFloorY < s.floorY;
      // Find a ladder connecting current floor to any adjacent floor in
      // the desired direction.
      let bestLadder = null, bestDx = Infinity;
      for (const l of LADDERS) {
        if (goUp && l.bottom === s.floorY && l.top < s.floorY) {
          const d = Math.abs(l.x - (s.x + 2));
          if (d < bestDx) { bestDx = d; bestLadder = l; }
        } else if (!goUp && l.top === s.floorY && l.bottom > s.floorY) {
          const d = Math.abs(l.x - (s.x + 2));
          if (d < bestDx) { bestDx = d; bestLadder = l; }
        }
      }
      if (bestLadder) {
        s.targetX = bestLadder.x - 2;       // snowman center on ladder
        s.targetLadder = bestLadder;
      } else {
        s.targetX = player.x;
        s.targetLadder = null;
      }
      s.repath = 0.6;
    } else if (playerFloorY === s.floorY) {
      s.targetX = player.x;
      s.targetLadder = null;
    }
    // If we have no target yet (first frame), default to chasing player.
    if (s.targetX === undefined) s.targetX = player.x;

    // Walk toward target x
    const dx = s.targetX - s.x;
    if (Math.abs(dx) > 0.5) {
      s.vx = Math.sign(dx) * SNOWMAN_WALK;
      s.facing = Math.sign(dx);
      s.x += s.vx * dt;
      s.walk += dt * 5;
    } else {
      s.vx = 0;
    }

    // Clamp to platform extents
    s.x = clamp(s.x, f.left, f.right - (s.w - 1));

    // If we've reached the chosen ladder, start climbing.
    if (s.targetLadder) {
      const center = s.x + 2;
      if (Math.abs(center - s.targetLadder.x) < 0.6) {
        const goUp = s.targetLadder.top < s.floorY;
        s.climbing = goUp ? 'up' : 'down';
        s.x = s.targetLadder.x - 2;   // snap
        const destY = goUp ? s.targetLadder.top : s.targetLadder.bottom;
        s.targetFloorY = destY;
        s.targetFloorIdx = FLOORS.findIndex(fl => fl.y === destY);
        s.targetLadder = null;
        s.vx = 0;
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  //  DOG COMPANION AI  (follows the player, charges the snowman, bites)
  // ───────────────────────────────────────────────────────────────────────
  function updateDog(dt) {
    if (!dog) return;
    if (dog.biteCool > 0) dog.biteCool -= dt;
    if (dog.biteFlash > 0) dog.biteFlash -= dt;
    dog.bobPhase += dt * 6;

    // Find a snowman target (any alive snowman).
    const snowman = enemies.find(e => e.type === 'snowman' && e.hp > 0);

    let tx, ty, mood;
    if (snowman && Math.abs(snowman.y - player.y) < 8) {
      // Chase the snowman aggressively when player + snowman are roughly
      // on the same height range (so the dog stays helpful but doesn't
      // teleport across whole map).
      mood = 'chase';
      tx = snowman.x - 1 * (snowman.x > dog.x ? -1 : 1);  // approach from same side
      tx = snowman.x + (snowman.x > player.x ? -2 : snowman.w);  // close in
      ty = snowman.y + 2;
    } else {
      mood = 'follow';
      tx = player.x - 4 * player.facing;
      ty = player.y + 1;
    }
    dog.mood = mood;

    // Smooth follow (lerp).  Faster chase, slower follow.
    const speed = mood === 'chase' ? 14 : 9;
    const dxv = tx - dog.x;
    const dyv = ty - dog.y;
    const step = speed * dt;
    if (Math.abs(dxv) < step) dog.x = tx;
    else dog.x += Math.sign(dxv) * step;
    if (Math.abs(dyv) < step) dog.y = ty;
    else dog.y += Math.sign(dyv) * step;
    dog.facing = (mood === 'chase')
      ? (snowman ? Math.sign(snowman.x - dog.x) || dog.facing : dog.facing)
      : (Math.sign(player.x - dog.x) || dog.facing);
    if (dog.facing === 0) dog.facing = 1;

    // Bite!  When close to snowman and cooldown is up.
    if (snowman && dog.biteCool <= 0) {
      const close =
        Math.abs((dog.x + 2.5) - (snowman.x + snowman.w / 2)) < snowman.w / 2 + 2 &&
        Math.abs(dog.y - snowman.y) < 5;
      if (close) {
        snowman.hp -= 1;
        snowman.hurt = 0.18;
        dog.biteCool = 1.4;
        dog.biteFlash = 0.20;
        enemyHitSound();
        spawnParticles(snowman.x + snowman.w / 2, snowman.y + 1, {
          count: 10, colors: ['#ffd56b','#ff9a3a','#ffffff'], chars: ['*','+','✦'],
        });
        if (snowman.hp <= 0) {
          snowman.dead = 0.35;
          enemyDieSound();
          spawnParticles(snowman.x + snowman.w / 2, snowman.y + 2, {
            count: 60, colors: ['#cad8e8','#7fc8ff','#ffffff','#ffd56b'],
            chars: ['❄','*','✦','·','+'],
          });
        }
      }
    }
  }

  function resolveCombat() {
    // Player attack hitbox (only during middle portion of the swing).
    const inHitFrame = player.attack > ATTACK_DUR * 0.25 && player.attack < ATTACK_DUR * 0.75;
    if (inHitFrame) {
      const hx = player.facing === 1 ? player.x + 3 : player.x - 3;
      const hy = player.y;
      const hw = 6, hh = 6;
      for (const e of enemies) {
        if (e.hp <= 0 || e.hurt > 0) continue;
        if (rectOverlap(hx, hy, hw, hh, e.x, e.y, e.w, e.h)) {
          e.hp -= 1;
          e.hurt = 0.25;
          enemyHitSound();
          spawnParticles(e.x + e.w / 2, e.y + e.h / 2, { count: 8, colors: ['#ffe69a','#ff9a3a','#ffffff'], chars: ['*','+','✦'] });
          if (e.hp <= 0) {
            e.dead = 0.35;
            enemyDieSound();
            const deathColor = e.type === 'ghost' ? ['#9fb8e0','#dfeaff','#ffffff']
                              : e.type === 'slime' ? ['#4ec46f','#3ea65a','#ffd56b','#ffffff']
                              : ['#e6e8ee','#b8bcc4','#ff6464','#ffffff'];
            spawnParticles(e.x + e.w / 2, e.y + e.h / 2, {
              count: 36, colors: deathColor,
              chars: ['*','·','✦','+','✧','×'],
            });
          }
        }
      }
    }
    // Enemy contact damage
    if (player.invul <= 0 && !player.dead) {
      const px = player.x, py = player.y;
      for (const e of enemies) {
        if (e.hp <= 0) continue;
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
    if (screen === 0) {
      // ── Night sky (forest)
      const grad = ctx.createLinearGradient(0, 0, 0, FLOORS[0].y * CHAR_H);
      grad.addColorStop(0, '#0a0e22');
      grad.addColorStop(0.7, '#162244');
      grad.addColorStop(1, '#2a1a3a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, FLOORS[0].y * CHAR_H);

      ctx.fillStyle = '#0c0e18';
      ctx.fillRect(0, FLOORS[0].y * CHAR_H, canvas.width, (FLOORS[1].y - FLOORS[0].y) * CHAR_H);
      ctx.fillStyle = '#0a0d16';
      ctx.fillRect(0, FLOORS[1].y * CHAR_H, canvas.width, (FLOORS[2].y - FLOORS[1].y) * CHAR_H);
      ctx.fillStyle = '#080a12';
      ctx.fillRect(0, FLOORS[2].y * CHAR_H, canvas.width, (ROWS - FLOORS[2].y) * CHAR_H);

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
      putSpriteColored(MOON.x, MOON.y, MOON_SPRITE, '#fff3c4');

    } else if (screen === 1) {
      // ── Dawn sky (river)
      const grad = ctx.createLinearGradient(0, 0, 0, (RIVER ? RIVER.top : 52) * CHAR_H);
      grad.addColorStop(0,    '#1a2050');
      grad.addColorStop(0.45, '#7a5078');
      grad.addColorStop(0.8,  '#ffae6a');
      grad.addColorStop(1,    '#ffd87a');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, (RIVER ? RIVER.top : 52) * CHAR_H);

      // Sun
      const sx = 78, sy = 8;
      const sgx = (sx + 1) * CHAR_W, sgy = (sy + 1) * CHAR_H;
      const sg = ctx.createRadialGradient(sgx, sgy, 0, sgx, sgy, 110);
      sg.addColorStop(0, 'rgba(255,220,140,0.55)');
      sg.addColorStop(1, 'rgba(255,220,140,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(sgx - 110, sgy - 110, 220, 220);
      putString(sx, sy,     ' ╭───╮ ', '#fff5b8');
      putString(sx, sy + 1, '(  ☀  )', '#ffd56b');
      putString(sx, sy + 2, ' ╰───╯ ', '#fff5b8');

      // A few muted stars still visible
      for (const s of STARS) {
        if (s.y > 3) continue;
        const tw = 0.5 + 0.5 * Math.sin(s.phase + time * 2);
        const color = `rgba(255,240,200,${0.15 + tw*0.25})`;
        putChar(s.x | 0, s.y | 0, s.ch, color);
      }

    } else if (screen === 2) {
      // ── Day sky (flying platforms)
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0,    '#3a7ed0');
      grad.addColorStop(0.55, '#7cb8e8');
      grad.addColorStop(1,    '#c8e2f6');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Sun
      const sx = 8, sy = 3;
      const sgx = (sx + 2) * CHAR_W, sgy = (sy + 1) * CHAR_H;
      const sg = ctx.createRadialGradient(sgx, sgy, 0, sgx, sgy, 130);
      sg.addColorStop(0, 'rgba(255,235,170,0.55)');
      sg.addColorStop(1, 'rgba(255,235,170,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(sgx - 130, sgy - 130, 260, 260);
      putString(sx, sy,     ' ╭───╮ ', '#fff5b8');
      putString(sx, sy + 1, '(  ☀  )', '#ffe888');
      putString(sx, sy + 2, ' ╰───╯ ', '#fff5b8');

    } else if (screen === 3) {
      // ── Cave (no real sky, but a deep gradient backdrop)
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0,    '#0c0810');
      grad.addColorStop(0.5,  '#15101c');
      grad.addColorStop(1,    '#1a1422');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

    } else if (screen === 4) {
      // ── Snowy sky with aurora
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0,    '#0e1530');
      grad.addColorStop(0.45, '#26456a');
      grad.addColorStop(0.9,  '#a0c5e0');
      grad.addColorStop(1,    '#e2eef8');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Aurora ribbons — drifting colored bands near the top
      for (let band = 0; band < 3; band++) {
        const baseY = (2 + band) * CHAR_H;
        const g = ctx.createLinearGradient(0, baseY, canvas.width, baseY);
        const phase = time * 0.3 + band * 0.8;
        const c1 = `rgba(120,240,200,${0.10 + 0.05 * Math.sin(phase)})`;
        const c2 = `rgba(200,140,255,${0.10 + 0.05 * Math.cos(phase)})`;
        g.addColorStop(0,   'rgba(0,0,0,0)');
        g.addColorStop(0.3, c1);
        g.addColorStop(0.7, c2);
        g.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, baseY, canvas.width, CHAR_H * 0.9);
      }

      // Faint stars at the top
      for (const s of STARS) {
        if (s.y > 4) continue;
        const tw = 0.5 + 0.5 * Math.sin(s.phase + time * 1.5);
        putChar(s.x | 0, s.y | 0, s.ch, `rgba(220,235,255,${0.25 + tw * 0.4})`);
      }
    }
  }

  // ───────────────────────────────────────────────────────────────────────
  //  SNOWFLAKES (only meaningful on the snow screen)
  // ───────────────────────────────────────────────────────────────────────
  function updateSnowflakes(dt) {
    if (screen !== 4 || SNOWFLAKES.length === 0) return;
    for (const f of SNOWFLAKES) {
      f.phase += dt * 1.2;
      f.x += (f.vx + Math.sin(f.phase) * 0.5) * dt * 4;
      f.y += f.vy * dt;
      if (f.y > ROWS) {
        f.y = -1;
        f.x = Math.random() * COLS;
      }
      if (f.x < 0) f.x = COLS - 1;
      else if (f.x > COLS) f.x = 0;
    }
  }
  function drawSnowflakes() {
    if (screen !== 4) return;
    for (const f of SNOWFLAKES) {
      putChar(f.x | 0, f.y | 0, f.ch, 'rgba(235,245,255,0.85)');
    }
  }

  function drawDog(time) {
    if (!dog) return;
    const sprite = dog.facing >= 0 ? DOG_R_5 : DOG_L_5;
    const px = Math.round(dog.x);
    const bob = Math.sin(dog.bobPhase) * 0.2;
    const py = Math.round(dog.y + bob);
    // Bite flash → red tint briefly
    const colors = dog.biteFlash > 0
      ? ['#ffd56b', '#ff5070']
      : DOG_COLORS;
    putSpriteColored(px, py, sprite, colors);
    // Mood/intent indicator
    if (dog.mood === 'chase' && (((time * 6) | 0) % 2) === 0) {
      putChar(px + 2, py - 1, '!', '#ff8060');
    }
  }

  function drawMountains() {
    // Parallax: as the player moves right, the mountains slide left a bit.
    const shift = (player.x - 96) * 0.07;
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
    const shift = (player.x - 96) * factor;
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
    if (screen === 0) {
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
      // Bottom strip
      drawOrnamentLayer(ORN_MID,  31, 33, 0.10, '#1a1722');
    } else if (screen === 2) {
      // Cloud-and-airy ornaments behind the flying platforms
      drawOrnamentLayer(ORN_FAR,  0, ROWS - 1, 0.04, 'rgba(255,255,255,0.35)');
      drawOrnamentLayer(ORN_MID,  0, ROWS - 1, 0.10, 'rgba(255,255,255,0.18)');
      drawOrnamentLayer(ORN_VINE, 0, ROWS - 1, 0.18, 'rgba(255,255,255,0.12)');
    } else if (screen === 3) {
      // Cave: rock-wall pattern with crystals woven through
      drawOrnamentLayer(ORN_FAR,  0, ROWS - 1, 0.04, 'rgba(80,90,120,0.20)');
      drawOrnamentLayer(ORN_MID,  0, ROWS - 1, 0.10, 'rgba(110,120,150,0.10)');
      drawOrnamentLayer(ORN_VINE, 0, ROWS - 1, 0.16, 'rgba(160,100,200,0.10)');
    }
  }

  function drawFarTrees() {
    // A second parallax layer that shifts more than the mountains.
    const shift = (player.x - 96) * 0.18;
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

  function drawRiver(time) {
    if (!RIVER) return;
    // Water rows from RIVER.top down to bottom of canvas.
    for (let y = RIVER.top; y < ROWS - 1; y++) {
      for (let x = RIVER.left; x <= RIVER.right; x++) {
        const wave = Math.sin((x * 0.35) + time * 2.2 + y * 0.6);
        const n = (x * 13 + y * 7 + Math.floor(time * 8)) & 0x7fffffff;
        const r = (n % 7);
        let ch;
        if (wave > 0.5)      ch = '≈';
        else if (wave > 0.0) ch = '~';
        else if (wave > -0.5) ch = '─';
        else                  ch = (r === 0) ? '·' : ' ';
        if (ch === ' ') continue;
        const depth = (y - RIVER.top) / (ROWS - 1 - RIVER.top);
        const r1 = 90 + Math.floor((1 - depth) * 60);
        const g1 = 140 + Math.floor((1 - depth) * 70);
        const b1 = 200 + Math.floor((1 - depth) * 45);
        const a  = (0.4 + 0.4 * (wave * 0.5 + 0.5)).toFixed(2);
        putChar(x, y, ch, `rgba(${r1},${g1},${b1},${a})`);
      }
    }
    // Foam at the bank edges where land meets water
    for (let y = RIVER.top; y <= RIVER.top + 1; y++) {
      putChar(RIVER.left, y, '░', '#bfe2ff');
      putChar(RIVER.right, y, '░', '#bfe2ff');
    }
  }

  function drawBoat(time) {
    if (!BOAT) return;
    const bx = Math.round(BOAT.x);
    const by = Math.round(BOAT.y);
    const bob = Math.sin(time * 2.5 + BOAT.phase) * 0.2;
    const deckY = by + Math.round(bob);
    // Deck (sits on the water line at by)
    putString(bx, deckY,     '▔▀▀▀▀▀▔', '#caa070');
    putString(bx, deckY + 1, '╲▒▒▒▒▒╱', '#7a4a22');
    // Wake
    if ((BOAT.x - BOAT.prevX) > 0) {
      putChar(bx - 1, deckY + 1, '≈', '#bfe2ff');
    } else if ((BOAT.x - BOAT.prevX) < 0) {
      putChar(bx + 7, deckY + 1, '≈', '#bfe2ff');
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
    } else if (e.type === 'snowman') {
      const a = ((e.walk | 0) % 2) === 0;
      sprite = a ? SNOWMAN_A : SNOWMAN_B;
      colors = SNOWMAN_COLORS;
    }
    // Dead enemies fade and shake (until culled)
    if (e.hp <= 0) {
      if (e.dead > 0) {
        const a = (e.dead / 0.45).toFixed(2);
        const sh = (Math.random() - 0.5) * 1.2;
        ctx.globalAlpha = parseFloat(a);
        for (let r = 0; r < sprite.length; r++) putString(px + Math.round(sh), py + r, sprite[r], colors[r] || colors[colors.length - 1]);
        ctx.globalAlpha = 1;
      }
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
    // HP pips above every enemy.  Boss-sized enemies get a single bar.
    if (e.maxHp >= 10) {
      const w = Math.max(3, e.w);
      const filled = Math.round((e.hp / e.maxHp) * w);
      for (let i = 0; i < w; i++) {
        putChar(px + i, py - 1, i < filled ? '▰' : '▱', i < filled ? '#ff5070' : '#552040');
      }
      // Label "BOSS"
      const lbl = 'BOSS';
      for (let i = 0; i < lbl.length; i++) putChar(px + i, py - 2, lbl[i], '#ffd56b');
      return;   // skip per-pip drawing below
    }
    for (let i = 0; i < e.maxHp; i++) {
      putChar(px + i, py - 1, i < e.hp ? '▮' : '▯', '#ff6464');
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
    // Hearts (current HP).
    for (let i = 0; i < player.maxHp; i++) {
      const filled = i < player.hp;
      putChar(1 + i * 2, 0, filled ? '♥' : '♡', filled ? '#ff5070' : '#552040');
    }
    // Spare lives — small figure icons just after the hearts.
    const baseCol = 2 + player.maxHp * 2;
    putString(baseCol, 0, 'x', '#9aa6b8');
    for (let i = 0; i < player.maxLives; i++) {
      const filled = i < player.lives;
      putChar(baseCol + 2 + i * 2, 0, filled ? '☺' : '·', filled ? '#7fc8ff' : '#3a4256');
    }
  }

  function drawFloors() {
    for (let i = 0; i < FLOORS.length; i++) {
      const f = FLOORS[i];
      if (f.isBoat) continue; // boat drawn separately
      const y = Math.round(f.y);
      const left = Math.round(f.left);
      const right = Math.round(f.right);
      const theme = f.theme || 'wood-light';
      let topColor, shadowColor, capColor;
      if (theme === 'wood-light')  { topColor = '#caa070'; shadowColor = '#704830'; capColor = '#7a5a32'; }
      else if (theme === 'wood-mid')   { topColor = '#b58952'; shadowColor = '#5c3a24'; capColor = '#7a5a32'; }
      else if (theme === 'wood-dark')  { topColor = '#a07a44'; shadowColor = '#4a2e1c'; capColor = '#7a5a32'; }
      else if (theme === 'bank')   { topColor = '#5fa64a'; shadowColor = '#3b6230'; capColor = '#3b6230'; }
      else if (theme === 'cloud')  { topColor = '#e8efff'; shadowColor = '#8a9ec8'; capColor = '#6680b0'; }
      else if (theme === 'stone')  { topColor = '#9aa0aa'; shadowColor = '#4a4e58'; capColor = '#5a5e68'; }
      else if (theme === 'snow')   { topColor = '#ffffff'; shadowColor = '#6d8aad'; capColor = '#9fb4cd'; }
      else                          { topColor = '#caa070'; shadowColor = '#704830'; capColor = '#7a5a32'; }
      // Platform top
      for (let x = left; x <= right; x++) {
        let grain;
        if (theme === 'cloud') {
          grain = ((x * 5 + i * 7) % 4 === 0) ? '▔' : '─';
        } else if (theme === 'bank') {
          grain = ((x * 7 + i * 31) % 5) === 0 ? '▒' : '═';
        } else if (theme === 'stone') {
          grain = ((x * 7 + i * 31) % 11) === 0 ? '╬' : ((x * 7 + i * 31) % 5 === 0 ? '▓' : '▀');
        } else if (theme === 'snow') {
          grain = ((x * 7 + i * 31) % 11) === 0 ? '▓' : ((x + i) % 4 === 0 ? '▒' : '▀');
        } else {
          grain = ((x * 7 + i * 31) % 13) === 0 ? '═' : '━';
        }
        putChar(x, y, grain, topColor);
      }
      // Shadow / hull row
      for (let x = left; x <= right; x++) {
        let ch;
        if (theme === 'cloud') {
          ch = ((x + i) % 3 === 0) ? '░' : ((x + i) % 3 === 1 ? '▒' : ' ');
        } else if (theme === 'bank') {
          ch = ((x + i) % 4 === 0) ? '▓' : ((x + i) % 4 === 2 ? '▒' : '░');
        } else if (theme === 'stone') {
          ch = ((x + i) % 5 === 0) ? '▓' : ((x + i) % 5 === 2 ? '▒' : '░');
        } else if (theme === 'snow') {
          ch = ((x + i) % 5 === 0) ? '▒' : ((x + i) % 5 === 2 ? '░' : ' ');
        } else {
          ch = ((x + i) % 4 === 0) ? '▓' : ((x + i) % 4 === 2 ? '▒' : '░');
        }
        if (ch !== ' ') putChar(x, y + 1, ch, shadowColor);
      }
      // Edge caps — only on partial floors that don't reach the world edge.
      if (left > 0)        putChar(left - 1,  y, theme === 'cloud' ? '╮' : '╞', capColor);
      if (right < COLS - 1) putChar(right + 1, y, theme === 'cloud' ? '╭' : '╡', capColor);
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

  // Snowy pine: same shape, white-ish foliage with hints of green.
  const TREE_SNOW_PINE_COLORS = ['#eaf0f8', '#dbe6f0', '#9ec3ad', '#6f9d7e', '#7a4a22', '#7a4a22'];

  function drawTree(t) {
    const y = FLOORS[t.floorIdx].y - 6;
    const isSnowPine = t.kind === 'snow-pine';
    const sprite = (t.kind === 'pine' || isSnowPine) ? TREE_PINE : TREE_ROUND;
    const colors = isSnowPine ? TREE_SNOW_PINE_COLORS
                              : (t.kind === 'pine' ? TREE_PINE_COLORS : TREE_ROUND_COLORS);
    // Top of the tree sways with the wind; trunk stays put.
    const sway = Math.sin(windPhase + t.x * 0.35) * 0.6;
    for (let r = 0; r < sprite.length; r++) {
      const isCanopy = r < 4;
      const dx = isCanopy ? Math.round(sway * (1 - r * 0.25)) : 0;
      putString(t.x - 3 + dx, y + r, sprite[r], colors[r]);
    }
    // Cap with a little snow if it's a snow pine.
    if (isSnowPine) {
      putChar(t.x, y - 1, '·', '#ffffff');
    }
  }
  function drawBush(b) {
    const y = FLOORS[b.floorIdx].y - 2;
    putSpriteColored(b.x - 2, y, BUSH, BUSH_COLORS);
  }
  function drawRock(r) {
    const y = FLOORS[r.floorIdx].y - 2;
    putSpriteColored(r.x - 2, y, ROCK, ROCK_COLORS);
  }

  function drawChest() {
    if (!CHEST) return;
    const y = FLOORS[CHEST.floorIdx].y - 3;
    putSpriteColored(CHEST.x - 4, y, CHEST_SPRITE, CHEST_COLORS);
  }

  function drawKey(time) {
    if (!KEY || KEY.collected) return;
    const baseY = FLOORS[KEY.floorIdx].y - 2;
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

  function drawPotion(time) {
    if (!POTION || POTION.collected) return;
    const baseY = FLOORS[POTION.floorIdx].y - 3;
    const bob = Math.sin(time * 2.4) * 0.3;
    const drawY = Math.round(baseY + bob);
    putSpriteColored(POTION.x, drawY, POTION_SPRITE, POTION_COLORS);
    if ((((time * 6) | 0) % 4) === 0) {
      putChar(POTION.x + 1, drawY - 1, '·', '#ffaab0');
    }
  }

  function drawFragment(time) {
    if (!FRAGMENT || FRAGMENT.collected) return;
    const baseY = FLOORS[FRAGMENT.floorIdx].y - 3;
    const bob = Math.sin(time * 2.6 + 1.0) * 0.3;
    const drawY = Math.round(baseY + bob);
    const sprite = makeFragmentSprite(FRAGMENT.digits);
    putSpriteColored(FRAGMENT.x, drawY, sprite, FRAGMENT_COLORS);
    if ((((time * 5) | 0) % 3) === 0) {
      putChar(FRAGMENT.x + 1 + ((Math.random() * 3) | 0), drawY - 1, '✦', '#ffe888');
    }
  }

  function drawSafe(time) {
    if (!SAFE) return;
    const baseY = FLOORS[SAFE.floorIdx].y - 6;
    const sprite = SAFE.opened ? SAFE_OPENED : SAFE_LOCKED;
    const colors = SAFE.opened ? SAFE_OPEN_COLORS : SAFE_COLORS;
    // Overlay the actual 6-digit display state ("DDDDDD" placeholder).
    const lines = sprite.slice();
    if (!SAFE.opened) {
      // Show: number of fragments collected so far in the safe window.
      const known = collectedCodes.map(c => c || '··').join('');
      lines[3] = '║│' + known + '│║';
    }
    putSpriteColored(SAFE.x, baseY, lines, colors);
    // Subtle glow on the dial
    if (!SAFE.opened && (((time * 4) | 0) % 2) === 0) {
      putChar(SAFE.x + 4, baseY + 4, '◉', '#ffd56b');
    }
    if (SAFE.opened) {
      // Glow halo
      ctx.fillStyle = 'rgba(255,213,107,0.10)';
      ctx.fillRect((SAFE.x - 1) * CHAR_W, (baseY - 1) * CHAR_H, 12 * CHAR_W, 8 * CHAR_H);
    }
  }

  function drawCaveDecor(time) {
    // Stalactites hang from row 1 down
    for (const s of STALACTITES) {
      putSpriteColored(s.x, 0, STALACTITE, STALACTITE_COLORS);
    }
    // Stalagmites sit on a floor
    for (const s of STALAGMITES) {
      const y = FLOORS[s.floorIdx].y - 2;
      putSpriteColored(s.x, y, STALAGMITE, STALAGMITE_COLORS);
    }
    // Crystals pulse on cave walls
    for (const c of CRYSTALS) {
      const pulse = 0.5 + 0.5 * Math.sin(time * 2 + c.x * 0.4);
      const base = CRYSTAL_COLORS[c.color] || '#c060e0';
      const a = (0.55 + pulse * 0.45).toFixed(2);
      const col = `rgba(${parseInt(base.slice(1,3),16)},${parseInt(base.slice(3,5),16)},${parseInt(base.slice(5,7),16)},${a})`;
      putChar(c.x, c.y, '◆', col);
      if (pulse > 0.7) putChar(c.x, c.y - 1, '·', col);
    }
    // Torches with flickering flame
    for (const t of TORCHES) {
      const y = FLOORS[t.floorIdx].y - 3;
      const flick = (((time * 14 + t.x * 0.3) | 0) % 2) === 0;
      putChar(t.x, y,     flick ? '▲' : '△', flick ? TORCH_FIRE_COLORS[0] : TORCH_FIRE_COLORS[1]);
      putChar(t.x, y + 1, '│', TORCH_STICK_COLOR);
      // Glow halo
      const gx = (t.x + 0.5) * CHAR_W;
      const gy = (y + 0.5) * CHAR_H;
      const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, 60);
      grad.addColorStop(0, 'rgba(255,160,60,0.20)');
      grad.addColorStop(1, 'rgba(255,160,60,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(gx - 60, gy - 60, 120, 120);
    }
  }

  function drawCodeHUD() {
    // Show collected fragments to the right of hearts + lives.
    const labelStart = 2 + player.maxHp * 2 + 2 + player.maxLives * 2 + 2;
    putString(labelStart, 0, 'CODE:', '#9aa6b8');
    for (let i = 0; i < 3; i++) {
      const txt = collectedCodes[i] || '··';
      const col = collectedCodes[i] ? '#ffd56b' : '#3a4256';
      putString(labelStart + 6 + i * 3, 0, txt, col);
    }
    if (safeOpened) putString(labelStart + 16, 0, '★', '#ffd56b');
  }

  function drawCodeModal(time) {
    if (!codeInputMode) {
      // If we have a transient codeMessage left over after modal closed, fade it.
      if (codeMessageTimer > 0 && codeMessage) {
        const col = COLS / 2 - codeMessage.length / 2;
        putString(Math.floor(col), Math.floor(ROWS / 2), codeMessage, '#ffd56b');
      }
      return;
    }
    // Dim the playfield
    ctx.fillStyle = 'rgba(2,4,8,0.75)';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const W = 40;
    const inner = (s) => '║' + s + ' '.repeat(W - 2 - s.length) + '║';
    const center = (s) => {
      const pad = W - 2 - s.length;
      const l = Math.floor(pad / 2), r = pad - l;
      return '║' + ' '.repeat(l) + s + ' '.repeat(r) + '║';
    };
    const slotPlaceholder = '[ _ _ _ _ _ _ ]';
    const box = [
      '╔' + '═'.repeat(W - 2) + '╗',
      inner(''),
      center('ENTER 6-DIGIT SAFE CODE'),
      inner(''),
      center(slotPlaceholder),
      inner(''),
      center('0-9 type · ENTER submit · ESC'),
      inner(''),
      '╚' + '═'.repeat(W - 2) + '╝',
    ];
    const left = Math.floor((COLS - W) / 2);
    const top  = Math.floor((ROWS - box.length) / 2);
    // Shake offset
    const sx = codeShake > 0 ? Math.round((Math.random() - 0.5) * 2) : 0;
    for (let r = 0; r < box.length; r++) {
      putString(left + sx, top + r, box[r], '#dbe2f0');
    }
    // Overlay the live digits on top of the slotPlaceholder row.
    const slotsRow = top + 4;
    const slotStartCol = left + Math.floor((W - slotPlaceholder.length) / 2) + 2;  // after "[ "
    for (let i = 0; i < 6; i++) {
      const ch = codeBuffer[i] || '_';
      const col = codeBuffer[i] ? '#ffd56b' : '#586278';
      putChar(slotStartCol + i * 2 + sx, slotsRow, ch, col);
    }
    // Message
    if (codeMessage && codeMessageTimer > 0) {
      const m = codeMessage;
      const mc = Math.floor((COLS - m.length) / 2) + sx;
      const isErr = m.startsWith('WRONG');
      putString(mc, top + box.length + 1, m, isErr ? '#ff7080' : '#ffd56b');
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
    if (!player.onLadder && FLOORS[player.floorIdx]) {
      const fy = FLOORS[player.floorIdx].y;
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

    // Tier wallpaper (screen 0 + 2 only)
    drawTierOrnaments(time);

    // Background parallax + sky animations (back to front).  Some only
    // make sense on the night-forest screen.
    if (screen === 0) {
      drawMountains();
      drawFarTrees();
    }
    drawClouds();
    if (screen === 0) {
      drawBats();
      drawShootingStars();
    }

    // Screen 1 specific: river water
    if (screen === 1) drawRiver(time);

    // Cave decor (stalactites etc.) sits behind floors but in front of bg
    if (screen === 3) drawCaveDecor(time);

    // Foreground world
    for (const t of TREES) drawTree(t);
    drawFloors();
    drawLadders();
    for (const b of BUSHES) drawBush(b);
    for (const r of ROCKS) drawRock(r);

    if (screen === 1) drawBoat(time);

    if (screen === 0) drawFireflies(time);

    drawChest();
    drawKey(time);
    drawPotion(time);
    drawFragment(time);
    drawSafe(time);

    // Enemies behind player so player passes in front during overlap.
    for (const e of enemies) drawEnemy(e, time);

    drawDog(time);
    drawPlayer(time);
    drawSword(time);

    // Snowflakes float in front of most things, behind the modal.
    if (screen === 4) drawSnowflakes();

    drawParticles();

    if (screen === 0) drawGround();
    drawHP();
    drawCodeHUD();
    drawScreenLabel();
    drawSafeHint();
    drawCodeModal(time);
  }

  function drawSafeHint() {
    if (!SAFE || SAFE.opened || codeInputMode) return;
    const sy = FLOORS[SAFE.floorIdx].y - 6;
    const cx = SAFE.x + 4;
    const dx = (player.x + 1) - cx;
    const dy = (player.y + 1.5) - (sy + 2.5);
    if (Math.abs(dx) < 5 && Math.abs(dy) < 4) {
      const t = 'PRESS [E] TO ENTER CODE';
      putString(Math.floor(cx - t.length / 2), sy - 1, t, '#ffd56b');
    }
  }

  function drawScreenLabel() {
    const labels = ['LV.1  NIGHT FOREST', 'LV.2  RIVER CROSSING', 'LV.3  SKY ISLANDS', 'LV.4  CAVE OF SECRETS', 'LV.5  SNOW BOSS'];
    const label = labels[screen] || '';
    const col = COLS - label.length - 2;
    for (let i = 0; i < label.length; i++) putChar(col + i, 0, label[i], '#8aa0c0');
    // Build marker (lets you confirm cache-busting worked)
    const v = 'b8';
    for (let i = 0; i < v.length; i++) putChar(COLS - v.length - 1 + i, 1, v[i], '#3a4256');
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
