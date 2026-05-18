'use strict';

(function () {

  // ───────────────────────────────────────────────────────────────────────
  //  CANVAS / GRID
  // ───────────────────────────────────────────────────────────────────────
  // The 200×68 logical grid never changes.  Cell pixel size scales with
  // the browser window so the game always fills the viewport while
  // staying crisp (the canvas redraws at whatever resolution fits).
  // CHAR_W/CHAR_H are recomputed in fitToWindow() below.
  let CHAR_W = 7.5;
  let CHAR_H = 13.5;
  const COLS = 200;
  const ROWS = 68;
  // Cells are taller than wide; keep that intrinsic ratio constant.
  const CELL_RATIO = CHAR_H / CHAR_W;
  const FONT_FAMILY = '"Cascadia Mono", "Fira Code", "JetBrains Mono", "Source Code Pro", "Consolas", "Menlo", monospace';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  function applyCtxState() {
    ctx.font = Math.max(6, Math.round(CHAR_H - 1)) + 'px ' + FONT_FAMILY;
    ctx.textBaseline = 'top';
    ctx.textAlign = 'center';
  }

  function fitToWindow() {
    const hudEl = document.getElementById('hud');
    const hudH = hudEl ? hudEl.offsetHeight : 36;
    // Outer chrome (frame border + padding + a couple of px of safety).
    const chromeW = 16, chromeH = 16;
    const availW = Math.max(320, window.innerWidth  - chromeW);
    const availH = Math.max(240, window.innerHeight - hudH - chromeH);
    // Pick the largest cell width that lets both axes fit.
    const scale = Math.min(availW / COLS, availH / (ROWS * CELL_RATIO));
    CHAR_W = scale;
    CHAR_H = scale * CELL_RATIO;
    canvas.width  = Math.floor(COLS * CHAR_W);
    canvas.height = Math.floor(ROWS * CHAR_H);
    applyCtxState();
  }
  fitToWindow();
  window.addEventListener('resize', fitToWindow);

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
  let BOMB_BUTTONS = []; // forest level: pressure plates the player can arm
  let SPAWN_BUTTONS = []; // cave level: buttons that spawn 3-HP guardians
  let ROPE = null;       // river level: high horizontal rope across the gap
  const DROPS = [];      // health-potion drops from killed guardians (any screen)
  let BOAT = null;      // screen 1: { x, y, w, baseY, phase, onBoard }
  let RIVER = null;     // screen 1: { left, right, top }
  let MOV_PLATS = [];   // screen 2: list of moving platforms (also live in FLOORS)
  let GOAL = null;      // win-or-advance objective for the current screen
  let screen = 0;
  const NUM_SCREENS = 10;
  // Per-screen physics overrides (only space tweaks gravity for now).
  const PHYS_OVERRIDES = { 5: { gravityMul: 0.45, jumpVMul: 0.85 } };
  // Space-level mechanics
  let TELEPORTS = [];      // [{x, y, floorIdx, idx}]
  let BLACKHOLE = null;    // { x, y, w, h }
  // Matrix level
  let GLITCH_ITEMS = [];   // [{kind, x, floorIdx, glitch}]
  let RAIN_COLS = [];      // [{x, head, speed, phase}]
  let teleCooldown = 0;    // seconds; prevents instant re-teleport on landing

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
    BOMB_BUTTONS = [];
    SPAWN_BUTTONS = [];
    ROPE = null;
    TELEPORTS = [];
    BLACKHOLE = null;
    teleCooldown = 0;
    PROJECTILES.length = 0;
    GLITCH_ITEMS = [];
    RAIN_COLS = [];
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
      // ───── Screen 0: Forest at night (4 tiers now)
      setFloors([
        { y: 10,  left: 2, right: 196, theme: 'wood-light' },  // 0 top
        { y: 28,  left: 2, right: 196, theme: 'wood-mid'   },  // 1
        { y: 46,  left: 2, right: 196, theme: 'wood-mid'   },  // 2
        { y: 62,  left: 2, right: 196, theme: 'wood-dark'  },  // 3 bottom
      ]);
      LADDERS = [
        { x: 44,  top: 10, bottom: 28 },
        { x: 140, top: 10, bottom: 28 },
        { x: 28,  top: 28, bottom: 46 },
        { x: 110, top: 28, bottom: 46 },
        { x: 170, top: 28, bottom: 46 },
        { x: 56,  top: 46, bottom: 62 },
        { x: 132, top: 46, bottom: 62 },
        { x: 184, top: 46, bottom: 62 },
      ];
      // Bomb-trap buttons (press E nearby to arm).
      BOMB_BUTTONS = [
        { x: 90,  floorIdx: 3, used: false, armed: 0, fuse: 1.6, blastR: 8 },
        { x: 150, floorIdx: 2, used: false, armed: 0, fuse: 1.6, blastR: 8 },
        { x: 70,  floorIdx: 1, used: false, armed: 0, fuse: 1.6, blastR: 8 },
      ];
      TREES = [
        { x: 16,  floorIdx: 3, kind: 'pine' },
        { x: 100, floorIdx: 3, kind: 'round' },
        { x: 184, floorIdx: 3, kind: 'pine' },
        { x: 36,  floorIdx: 2, kind: 'round' },
        { x: 120, floorIdx: 2, kind: 'pine' },
        { x: 30,  floorIdx: 1, kind: 'pine' },
        { x: 112, floorIdx: 1, kind: 'round' },
        { x: 180, floorIdx: 1, kind: 'round' },
        { x: 20,  floorIdx: 0, kind: 'pine' },
        { x: 160, floorIdx: 0, kind: 'round' },
      ];
      BUSHES = [
        { x: 36, floorIdx: 3 }, { x: 60, floorIdx: 3 },
        { x: 120, floorIdx: 3 }, { x: 152, floorIdx: 3 },
        { x: 14, floorIdx: 2 }, { x: 84, floorIdx: 2 }, { x: 170, floorIdx: 2 },
        { x: 52, floorIdx: 1 }, { x: 152, floorIdx: 1 }, { x: 8,  floorIdx: 1 },
        { x: 40, floorIdx: 0 }, { x: 140, floorIdx: 0 },
      ];
      ROCKS = [
        { x: 84, floorIdx: 3 }, { x: 176, floorIdx: 3 },
        { x: 96, floorIdx: 2 }, { x: 60, floorIdx: 0 },
      ];
      CHEST = { x: 88, floorIdx: 0 };
      KEY   = { x: 104, floorIdx: 0, collected: false };
      // Optional code fragment (digits "47") + healing potion
      FRAGMENT = { x: 72, floorIdx: 2, digits: FRAGMENT_DIGITS[0], levelIdx: 0, collected: !!collectedCodes[0] };
      POTION   = { x: 128, floorIdx: 3, collected: false };
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
      // Alternate path: a high rope strung across the river.  Two short
      // climbing posts on the banks lead up to a thin platform at row 22.
      const ROPE_Y = 22;
      FLOORS.push({ y: ROPE_Y, left: 36, right: 164, theme: 'rope' });   // floor idx after boat
      LADDERS = [
        { x: 36,  top: ROPE_Y, bottom: 52 },   // left bank → rope
        { x: 164, top: ROPE_Y, bottom: 52 },   // right bank → rope
      ];
      ROPE = { y: ROPE_Y, left: 36, right: 164 };
      FLOOR_Y = FLOORS.map(f => f.y);
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
        { y: 60, left: 2,   right: 28,  theme: 'cloud' },                                                            // 0 start
        { y: 52, left: 36,  right: 52,  theme: 'cloud', oscY: { phase: 0,        amp: 2.4, speed: 1.0 } },           // 1 osc
        { y: 50, left: 60,  right: 72,  theme: 'cloud', autojump: true },                                            // 2 spring
        { y: 44, left: 80,  right: 96,  theme: 'cloud' },                                                            // 3
        { y: 36, left: 104, right: 120, theme: 'cloud', oscY: { phase: Math.PI/2,amp: 2.8, speed: 0.8 } },           // 4
        { y: 30, left: 128, right: 142, theme: 'cloud' },                                                            // 5
        { y: 26, left: 150, right: 164, theme: 'cloud', autojump: true },                                            // 6 spring
        { y: 18, left: 170, right: 184, theme: 'cloud', oscY: { phase: Math.PI,  amp: 2.0, speed: 1.2 } },           // 7
        { y: 10, left: 186, right: 198, theme: 'cloud' },                                                            // 8 goal
      ]);
      // Stash baseY and originals for oscillation.
      for (const f of FLOORS) {
        if (f.oscY) { f.baseY = f.y; f.prevY = f.y; }
      }
      // No final key here any more — sky goal is now reach-right (advance
      // into the cave).  Fragment + potion live on the path.
      // Place fragment + potion on stable (non-bouncy) platforms.
      FRAGMENT = { x: 88,  floorIdx: 3, digits: FRAGMENT_DIGITS[2], levelIdx: 2, collected: !!collectedCodes[2] };
      POTION   = { x: 134, floorIdx: 5, collected: false };
      BUSHES = [];
      ROCKS  = [];
      TREES  = [];
      LADDERS = [];
      GOAL = 'reach-right';

    } else if (n === 3) {
      // ───── Screen 3: Cave with the safe (5 platforms now)
      setFloors([
        { y: 60, left: 2,   right: 196, theme: 'stone' },  // 0 main bottom
        { y: 48, left: 16,  right: 36,  theme: 'stone' },  // 1 small ledge near left
        { y: 40, left: 44,  right: 156, theme: 'stone' },  // 2 mid (safe here)
        { y: 20, left: 2,   right: 64,  theme: 'stone' },  // 3 upper-left
        { y: 20, left: 132, right: 196, theme: 'stone' },  // 4 upper-right (key here)
      ]);
      LADDERS = [
        { x: 24,  top: 48, bottom: 60 },  // bottom → ledge 1
        { x: 60,  top: 40, bottom: 60 },  // bottom → mid
        { x: 140, top: 40, bottom: 60 },  // bottom → mid
        { x: 52,  top: 20, bottom: 40 },  // mid → upper-left
        { x: 144, top: 20, bottom: 40 },  // mid → upper-right
      ];
      // Decorations: stalactites along ceiling, stalagmites on bottom,
      // crystals embedded in walls, torches for atmosphere.
      STALACTITES = [
        { x: 12 }, { x: 28 }, { x: 44 }, { x: 76 }, { x: 100 },
        { x: 124 }, { x: 152 }, { x: 172 }, { x: 188 },
      ];
      STALAGMITES = [
        { x: 16, floorIdx: 0 }, { x: 32, floorIdx: 0 }, { x: 156, floorIdx: 0 },
        { x: 176, floorIdx: 0 }, { x: 80, floorIdx: 2 }, { x: 120, floorIdx: 2 },
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
        { x: 60, floorIdx: 2 }, { x: 140, floorIdx: 2 },
      ];
      CHEST = { x: 176, floorIdx: 4 };
      KEY   = { x: 184, floorIdx: 4, collected: false };
      POTION = { x: 100, floorIdx: 0, collected: false };
      SAFE = { x: 96, floorIdx: 2, opened: safeOpened };
      // Two spawn buttons summon a 3-HP guardian which drops a potion on death.
      SPAWN_BUTTONS = [
        { x: 60,  floorIdx: 0, used: false, side: -1 },   // spawns near left
        { x: 140, floorIdx: 0, used: false, side:  1 },   // spawns near right
      ];
      // Cave's key now opens the way to the snow boss arena.
      GOAL = 'pickup-key';

    } else if (n === 4) {
      // ───── Screen 4: Snowy boss arena (4 floors + ladders)
      setFloors([
        { y: 12, left: 2, right: 196, theme: 'snow' },   // 0 top (boss starts here)
        { y: 28, left: 2, right: 196, theme: 'snow' },   // 1
        { y: 44, left: 2, right: 196, theme: 'snow' },   // 2
        { y: 60, left: 2, right: 196, theme: 'snow' },   // 3 bottom (player starts)
      ]);
      LADDERS = [
        { x: 48,  top: 12, bottom: 28 },
        { x: 152, top: 12, bottom: 28 },
        { x: 30,  top: 28, bottom: 44 },
        { x: 112, top: 28, bottom: 44 },
        { x: 174, top: 28, bottom: 44 },
        { x: 64,  top: 44, bottom: 60 },
        { x: 138, top: 44, bottom: 60 },
        { x: 186, top: 44, bottom: 60 },
      ];
      TREES = [
        { x: 20,  floorIdx: 3, kind: 'snow-pine' },
        { x: 104, floorIdx: 3, kind: 'snow-pine' },
        { x: 184, floorIdx: 3, kind: 'snow-pine' },
        { x: 28,  floorIdx: 2, kind: 'snow-pine' },
        { x: 116, floorIdx: 2, kind: 'snow-pine' },
        { x: 180, floorIdx: 2, kind: 'snow-pine' },
        { x: 80,  floorIdx: 1, kind: 'snow-pine' },
        { x: 160, floorIdx: 1, kind: 'snow-pine' },
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

    } else if (n === 5) {
      // ───── Screen 5: Space — floating platforms, low gravity, teleports
      // and a black hole at the top-right that ends the game.
      setFloors([
        { y: 60, left: 2,   right: 56,  theme: 'space' },   // 0 start (bottom-left)
        { y: 50, left: 70,  right: 100, theme: 'space' },   // 1 mid-low
        { y: 50, left: 130, right: 160, theme: 'space' },   // 2 mid-low right
        { y: 38, left: 30,  right: 60,  theme: 'space' },   // 3 mid
        { y: 38, left: 100, right: 130, theme: 'space' },   // 4 mid right
        { y: 28, left: 60,  right: 90,  theme: 'space' },   // 5 upper centre
        { y: 28, left: 140, right: 170, theme: 'space' },   // 6 upper right
        { y: 18, left: 10,  right: 40,  theme: 'space' },   // 7 upper left
        { y: 12, left: 150, right: 196, theme: 'space' },   // 8 top right (black hole platform)
      ]);
      LADDERS = [];
      TREES = [];
      BUSHES = [];
      ROCKS = [];
      // Random teleporters scattered on platforms — stepping on one
      // sends you to a different teleporter.
      TELEPORTS = [
        { x: 30,  y: 60, floorIdx: 0 },
        { x: 85,  y: 50, floorIdx: 1 },
        { x: 145, y: 50, floorIdx: 2 },
        { x: 45,  y: 38, floorIdx: 3 },
        { x: 115, y: 38, floorIdx: 4 },
        { x: 75,  y: 28, floorIdx: 5 },
        { x: 25,  y: 18, floorIdx: 7 },
      ];
      // Black hole zone at the top-right corner (8 wide × 8 tall).
      BLACKHOLE = { x: 168, y: 2, w: 14, h: 10 };
      GOAL = 'reach-blackhole';

    } else if (n === 6) {
      // ───── Screen 6: Jungle forest — final stretch.
      setFloors([
        { y: 10, left: 2,  right: 196, theme: 'wood-light' },  // 0 top
        { y: 26, left: 2,  right: 196, theme: 'wood-mid'   },  // 1
        { y: 42, left: 2,  right: 196, theme: 'wood-mid'   },  // 2
        { y: 60, left: 2,  right: 196, theme: 'wood-dark'  },  // 3 bottom (player starts)
      ]);
      // Lianas — same mechanics as ladders but rendered as hanging vines.
      LADDERS = [
        { x: 28,  top: 10, bottom: 26, vine: true },
        { x: 92,  top: 10, bottom: 26, vine: true },
        { x: 162, top: 10, bottom: 26, vine: true },
        { x: 44,  top: 26, bottom: 42, vine: true },
        { x: 116, top: 26, bottom: 42, vine: true },
        { x: 178, top: 26, bottom: 42, vine: true },
        { x: 22,  top: 42, bottom: 60, vine: true },
        { x: 86,  top: 42, bottom: 60, vine: true },
        { x: 150, top: 42, bottom: 60, vine: true },
      ];
      // Dense canopy.
      TREES = [
        { x: 12,  floorIdx: 3, kind: 'round' },
        { x: 60,  floorIdx: 3, kind: 'pine'  },
        { x: 110, floorIdx: 3, kind: 'round' },
        { x: 170, floorIdx: 3, kind: 'pine'  },
        { x: 188, floorIdx: 3, kind: 'round' },
        { x: 14,  floorIdx: 2, kind: 'pine'  },
        { x: 70,  floorIdx: 2, kind: 'round' },
        { x: 138, floorIdx: 2, kind: 'pine'  },
        { x: 190, floorIdx: 2, kind: 'round' },
        { x: 10,  floorIdx: 1, kind: 'round' },
        { x: 76,  floorIdx: 1, kind: 'pine'  },
        { x: 140, floorIdx: 1, kind: 'round' },
        { x: 30,  floorIdx: 0, kind: 'round' },
        { x: 108, floorIdx: 0, kind: 'pine'  },
        { x: 188, floorIdx: 0, kind: 'round' },
      ];
      BUSHES = [
        { x: 32, floorIdx: 3 }, { x: 80, floorIdx: 3 }, { x: 140, floorIdx: 3 }, { x: 184, floorIdx: 3 },
        { x: 38, floorIdx: 2 }, { x: 102, floorIdx: 2 }, { x: 168, floorIdx: 2 },
        { x: 56, floorIdx: 1 }, { x: 156, floorIdx: 1 },
        { x: 70, floorIdx: 0 }, { x: 168, floorIdx: 0 },
      ];
      ROCKS = [
        { x: 92, floorIdx: 3 }, { x: 158, floorIdx: 3 },
        { x: 50, floorIdx: 2 }, { x: 150, floorIdx: 2 },
      ];
      // Chest + key at the top floor (final objective).
      CHEST = { x: 150, floorIdx: 0 };
      KEY   = { x: 160, floorIdx: 0, collected: false };
      // Optional healing potion mid-climb.
      POTION = { x: 100, floorIdx: 2, collected: false };
      // Jungle now advances to the volcano boss arena instead of
      // ending the game.
      GOAL = 'pickup-key';

    } else if (n === 7) {
      // ───── Screen 7: Volcano lair — fire-demon boss, lava floor.
      setFloors([
        { y: 12, left: 2,  right: 196, theme: 'lava' },   // 0 top (demon starts)
        { y: 28, left: 2,  right: 196, theme: 'lava' },   // 1
        { y: 44, left: 2,  right: 196, theme: 'lava' },   // 2
        { y: 60, left: 2,  right: 196, theme: 'lava' },   // 3 bottom (player starts)
      ]);
      LADDERS = [
        { x: 48,  top: 12, bottom: 28 },
        { x: 152, top: 12, bottom: 28 },
        { x: 30,  top: 28, bottom: 44 },
        { x: 112, top: 28, bottom: 44 },
        { x: 174, top: 28, bottom: 44 },
        { x: 64,  top: 44, bottom: 60 },
        { x: 138, top: 44, bottom: 60 },
        { x: 186, top: 44, bottom: 60 },
      ];
      TREES = [];
      BUSHES = [];
      ROCKS = [
        { x: 16, floorIdx: 3 }, { x: 92, floorIdx: 3 }, { x: 180, floorIdx: 3 },
        { x: 60, floorIdx: 2 }, { x: 158, floorIdx: 2 },
        { x: 30, floorIdx: 1 }, { x: 160, floorIdx: 1 },
      ];
      GOAL = 'defeat-demon';

    } else if (n === 8) {
      // ───── Screen 8: Heavens — partial floors with holes; two angels.
      setFloors([
        // Floor y=12 (top), single segment with the goal area.
        { y: 12, left: 20,  right: 180, theme: 'cloud' },                       // 0
        // Floor y=28 split into two with a wide hole at the middle.
        { y: 28, left: 2,   right: 90,  theme: 'cloud' },                       // 1
        { y: 28, left: 110, right: 196, theme: 'cloud' },                       // 2
        // Floor y=44 split into three pieces with two holes.
        { y: 44, left: 2,   right: 80,  theme: 'cloud' },                       // 3
        { y: 44, left: 100, right: 150, theme: 'cloud' },                       // 4
        { y: 44, left: 170, right: 196, theme: 'cloud' },                       // 5
        // Bottom: solid runway.
        { y: 60, left: 2,   right: 196, theme: 'cloud' },                       // 6
      ]);
      LADDERS = [
        { x: 40,  top: 12, bottom: 28 },   // 0  → 1
        { x: 150, top: 12, bottom: 28 },   // 0  → 2
        { x: 50,  top: 28, bottom: 44 },   // 1  → 3
        { x: 130, top: 28, bottom: 44 },   // 2  → 4
        { x: 180, top: 28, bottom: 44 },   // 2  → 5
        { x: 20,  top: 44, bottom: 60 },   // 3  → 6
        { x: 120, top: 44, bottom: 60 },   // 4  → 6
        { x: 185, top: 44, bottom: 60 },   // 5  → 6
      ];
      TREES = [];
      BUSHES = [];
      ROCKS = [];
      POTION = { x: 50, floorIdx: 6, collected: false };
      GOAL = 'defeat-angels';

    } else if (n === 9) {
      // ───── Screen 9: Matrix — final showdown.
      setFloors([
        { y: 12, left: 2,  right: 196, theme: 'matrix' },
        { y: 28, left: 2,  right: 196, theme: 'matrix' },
        { y: 44, left: 2,  right: 196, theme: 'matrix' },
        { y: 60, left: 2,  right: 196, theme: 'matrix' },
      ]);
      LADDERS = [
        { x: 48,  top: 12, bottom: 28 },
        { x: 152, top: 12, bottom: 28 },
        { x: 30,  top: 28, bottom: 44 },
        { x: 112, top: 28, bottom: 44 },
        { x: 174, top: 28, bottom: 44 },
        { x: 64,  top: 44, bottom: 60 },
        { x: 138, top: 44, bottom: 60 },
        { x: 186, top: 44, bottom: 60 },
      ];
      // Glitch decorations: TVs + a small chair/lamp scatter.
      GLITCH_ITEMS = [
        { kind: 'tv',    x: 30,  floorIdx: 3, glitch: 0 },
        { kind: 'tv',    x: 170, floorIdx: 3, glitch: 0 },
        { kind: 'chair', x: 90,  floorIdx: 3, glitch: 0 },
        { kind: 'tv',    x: 60,  floorIdx: 2, glitch: 0 },
        { kind: 'chair', x: 130, floorIdx: 2, glitch: 0 },
        { kind: 'lamp',  x: 22,  floorIdx: 1, glitch: 0 },
        { kind: 'tv',    x: 150, floorIdx: 1, glitch: 0 },
        { kind: 'lamp',  x: 100, floorIdx: 0, glitch: 0 },
      ];
      // Code-rain columns — one every 2 cells.
      RAIN_COLS = [];
      for (let cx = 0; cx < COLS; cx += 2) {
        RAIN_COLS.push({
          x: cx,
          head: Math.random() * ROWS,
          speed: 10 + Math.random() * 22,
          phase: Math.random() * 999,
        });
      }
      TREES = [];
      BUSHES = [];
      ROCKS = [];
      POTION = { x: 90, floorIdx: 3, collected: false };
      GOAL = 'defeat-agents';
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
        vx: 0, vy: 0,
        facing: 1,
        biteCool: 0.6,
        biteFlash: 0,
        mood: 'follow',
        bobPhase: 0,
        floorIdx: player.floorIdx,
        climbing: null,
        targetFloorIdx: -1,
        targetFloorY: 0,
        stunned: 0,
        stunPhase: 0,
        grounded: false,
      };
    }

    spawnEnemiesForScreen(n);
    setMusicForScreen(n);
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

  function detonateBomb(b) {
    const by = FLOORS[b.floorIdx].y - 1;
    const bx = b.x;
    spawnParticles(bx, by, {
      count: 60,
      colors: ['#ffd56b','#ff9a3a','#ff5070','#ffffff'],
      chars: ['*','✦','✧','+','·','×'],
    });
    noiseBurst(0.18, 0.10);
    blip(140, 0.30, 'sawtooth', 0.08, 60);
    const r2 = b.blastR * b.blastR;
    for (const e of enemies) {
      if (e.hp <= 0) continue;
      const ex = e.x + (e.w || 3) / 2;
      const ey = e.y + (e.h || 3) / 2;
      const dx = ex - bx, dy = ey - by;
      if (dx * dx + dy * dy <= r2) {
        e.hp -= 3;        // bombs are nasty
        e.hurt = 0.25;
        if (e.hp <= 0) { e.dead = 0.35; enemyDieSound(); }
      }
    }
    // Bomb damages the player too if too close.
    const dxp = (player.x + 1) - bx;
    const dyp = (player.y + 1.5) - by;
    if (dxp * dxp + dyp * dyp <= r2 && player.invul <= 0 && !player.dead) {
      player.hp -= 1;
      player.invul = PLAYER_INVUL;
      player.hurtFlash = 0.25;
      hurtSound();
    }
  }

  function spawnGuardian(b) {
    const f = FLOORS[b.floorIdx];
    enemies.push({
      type: 'skel',
      x: b.x + b.side * 6,
      y: f.y - 3,
      vx: b.side * 12,
      facing: b.side,
      hp: 3, maxHp: 3,
      hurt: 0, dead: 0,
      w: 3, h: 3,
      floorIdx: b.floorIdx,
      minX: Math.max(f.left, b.x - 30),
      maxX: Math.min(f.right, b.x + 30),
      walk: 0,
      originY: f.y - 3,
      dropsPotion: true,   // flag so combat code knows to drop a heart
    });
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
      // Dog joins immediately, right at the safe (so the safe-cracking
      // payoff is visible on this same screen).
      if (!dog) {
        const sf = SAFE ? FLOORS[SAFE.floorIdx] : FLOORS[player.floorIdx];
        const baseY = sf ? sf.y - 2 : player.y;
        dog = {
          x: Math.max(2, player.x - 5),
          y: baseY,
          vx: 0, vy: 0,
          facing: 1,
          biteCool: 0.6,
          biteFlash: 0,
          mood: 'follow',
          bobPhase: 0,
          floorIdx: SAFE ? SAFE.floorIdx : player.floorIdx,
          onLadder: false,
          climbing: null,
          targetFloorIdx: -1,
          targetFloorY: 0,
          stunned: 0,
          stunPhase: 0,
          grounded: false,
        };
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
        // Bottom floor (3)
        { type: 'slime', x: 72, y: FLOORS[3].y - 2, vx: 9, facing: 1, hp: 1, maxHp: 1,
          floorIdx: 3, minX: 30, maxX: 110, hop: 0, hurt: 0, dead: 0,
          w: 5, h: 2, originY: FLOORS[3].y - 2 },
        { type: 'skel', x: 168, y: FLOORS[3].y - 3, vx: 10, facing: 1, hp: 2, maxHp: 2,
          floorIdx: 3, minX: 140, maxX: 192, walk: 0, hurt: 0, dead: 0,
          w: 3, h: 3, originY: FLOORS[3].y - 3 },
        // Mid lower floor (2)
        { type: 'skel', x: 60, y: FLOORS[2].y - 3, vx: -12, facing: -1, hp: 2, maxHp: 2,
          floorIdx: 2, minX: 30, maxX: 150, walk: 0, hurt: 0, dead: 0,
          w: 3, h: 3, originY: FLOORS[2].y - 3 },
        { type: 'slime', x: 178, y: FLOORS[2].y - 2, vx: -8, facing: -1, hp: 1, maxHp: 1,
          floorIdx: 2, minX: 160, maxX: 192, hop: 0, hurt: 0, dead: 0,
          w: 5, h: 2, originY: FLOORS[2].y - 2 },
        // Mid upper floor (1)
        { type: 'skel', x: 120, y: FLOORS[1].y - 3, vx: -10, facing: -1, hp: 2, maxHp: 2,
          floorIdx: 1, minX: 70, maxX: 178, walk: 0, hurt: 0, dead: 0,
          w: 3, h: 3, originY: FLOORS[1].y - 3 },
        // Top floor (0)
        { type: 'slime', x: 140, y: FLOORS[0].y - 2, vx: -8, facing: -1, hp: 1, maxHp: 1,
          floorIdx: 0, minX: 116, maxX: 180, hop: 0, hurt: 0, dead: 0,
          w: 5, h: 2, originY: FLOORS[0].y - 2 },
        // Ghost roams the mid-tier
        { type: 'ghost', cx: 100, cy: 36, rx: 30, ry: 8,
          x: 98, y: 36, phase: 0, pSpeed: 0.9, hp: 1, maxHp: 1,
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
        { type: 'ghost', cx: 80, cy: 44, rx: 20, ry: 6,
          x: 78, y: 44, phase: 0, pSpeed: 1.2, hp: 1, maxHp: 1,
          facing: 1, hurt: 0, dead: 0, w: 3, h: 3 },
        { type: 'ghost', cx: 140, cy: 28, rx: 18, ry: 4,
          x: 138, y: 28, phase: Math.PI, pSpeed: 1.0, hp: 1, maxHp: 1,
          facing: 1, hurt: 0, dead: 0, w: 3, h: 3 },
        { type: 'slime', x: 132, y: FLOORS[5].y - 2, vx: 5, facing: 1, hp: 1, maxHp: 1,
          floorIdx: 5, minX: 128, maxX: 138, hop: 0, hurt: 0, dead: 0,
          w: 5, h: 2, originY: FLOORS[5].y - 2 },
      ];
    } else if (n === 3) {
      // Cave screen: skeletons + ghost + slime (floor indices for new layout)
      enemies = [
        { type: 'skel', x: 100, y: FLOORS[0].y - 3, vx: 10, facing: 1, hp: 2, maxHp: 2,
          floorIdx: 0, minX: 44, maxX: 156, walk: 0, hurt: 0, dead: 0,
          w: 3, h: 3, originY: FLOORS[0].y - 3 },
        { type: 'skel', x: 76, y: FLOORS[2].y - 3, vx: -8, facing: -1, hp: 2, maxHp: 2,
          floorIdx: 2, minX: 48, maxX: 120, walk: 0, hurt: 0, dead: 0,
          w: 3, h: 3, originY: FLOORS[2].y - 3 },
        { type: 'slime', x: 160, y: FLOORS[4].y - 2, vx: 7, facing: 1, hp: 1, maxHp: 1,
          floorIdx: 4, minX: 136, maxX: 184, hop: 0, hurt: 0, dead: 0,
          w: 5, h: 2, originY: FLOORS[4].y - 2 },
        { type: 'ghost', cx: 100, cy: 28, rx: 32, ry: 6,
          x: 98, y: 28, phase: 0, pSpeed: 1.0, hp: 1, maxHp: 1,
          facing: 1, hurt: 0, dead: 0, w: 3, h: 3 },
      ];
    } else if (n === 4) {
      // Snowy boss arena — the snowman plus a handful of minions to
      // make the climb up to the boss feel populated.
      enemies = [
        // Boss
        { type: 'snowman',
          x: 140, y: FLOORS[0].y - 4,
          vx: 0, facing: -1,
          hp: 10, maxHp: 10, hurt: 0, dead: 0,
          w: 5, h: 4,
          floorIdx: 0, floorY: FLOORS[0].y,
          climbing: null,
          targetFloorIdx: -1,
          targetFloorY: 0,
          walk: 0,
          repath: 0,
        },
        // Bottom-floor patrolling slime
        { type: 'slime', x: 90, y: FLOORS[3].y - 2, vx: 7, facing: 1, hp: 1, maxHp: 1,
          floorIdx: 3, minX: 60, maxX: 150, hop: 0, hurt: 0, dead: 0,
          w: 5, h: 2, originY: FLOORS[3].y - 2 },
        // 2nd-tier skeleton guarding the route up
        { type: 'skel', x: 90, y: FLOORS[2].y - 3, vx: -10, facing: -1, hp: 2, maxHp: 2,
          floorIdx: 2, minX: 50, maxX: 160, walk: 0, hurt: 0, dead: 0,
          w: 3, h: 3, originY: FLOORS[2].y - 3 },
        // 3rd-tier slime just below the boss platform
        { type: 'slime', x: 60, y: FLOORS[1].y - 2, vx: -6, facing: -1, hp: 1, maxHp: 1,
          floorIdx: 1, minX: 30, maxX: 160, hop: 0, hurt: 0, dead: 0,
          w: 5, h: 2, originY: FLOORS[1].y - 2 },
        // A ghost roaming between tiers (avoid in mid-jumps!)
        { type: 'ghost', cx: 100, cy: 36, rx: 40, ry: 8,
          x: 98, y: 36, phase: 0, pSpeed: 1.0, hp: 1, maxHp: 1,
          facing: 1, hurt: 0, dead: 0, w: 3, h: 3 },
      ];
    } else if (n === 5) {
      // Space — UFO drones and a fast alien blob.
      enemies = [
        { type: 'ufo', cx: 70,  cy: 25, rx: 32, ry: 6,
          x: 68, y: 25, phase: 0, pSpeed: 1.6, hp: 2, maxHp: 2,
          facing: 1, hurt: 0, dead: 0, w: 5, h: 2 },
        { type: 'ufo', cx: 130, cy: 22, rx: 22, ry: 5,
          x: 128, y: 22, phase: Math.PI, pSpeed: 1.4, hp: 2, maxHp: 2,
          facing: 1, hurt: 0, dead: 0, w: 5, h: 2 },
        { type: 'ufo', cx: 110, cy: 14, rx: 28, ry: 4,
          x: 108, y: 14, phase: Math.PI / 2, pSpeed: 1.9, hp: 2, maxHp: 2,
          facing: 1, hurt: 0, dead: 0, w: 5, h: 2 },
        // Alien blob (slime sprite, faster, more HP)
        { type: 'slime', x: 80, y: FLOORS[1].y - 2, vx: 11, facing: 1, hp: 2, maxHp: 2,
          floorIdx: 1, minX: 70, maxX: 95, hop: 0, hurt: 0, dead: 0,
          w: 5, h: 2, originY: FLOORS[1].y - 2 },
      ];
    } else if (n === 6) {
      // Jungle — two tigers (chase the player at 85% of player speed,
      // 3 HP each), plus a couple of regular jungle critters.
      enemies = [
        { type: 'tiger',
          x: 40, y: FLOORS[3].y - 3,
          vx: 0, facing: 1,
          hp: 3, maxHp: 3, hurt: 0, dead: 0,
          w: 5, h: 3,
          floorIdx: 3, floorY: FLOORS[3].y,
          climbing: null, targetFloorIdx: -1, targetFloorY: 0,
          walk: 0, repath: 0,
        },
        { type: 'tiger',
          x: 160, y: FLOORS[2].y - 3,
          vx: 0, facing: -1,
          hp: 3, maxHp: 3, hurt: 0, dead: 0,
          w: 5, h: 3,
          floorIdx: 2, floorY: FLOORS[2].y,
          climbing: null, targetFloorIdx: -1, targetFloorY: 0,
          walk: 0, repath: 0,
        },
        // A patrolling snake (skel sprite for lack of a snake one)
        { type: 'skel', x: 80, y: FLOORS[1].y - 3, vx: -9, facing: -1, hp: 2, maxHp: 2,
          floorIdx: 1, minX: 30, maxX: 170, walk: 0, hurt: 0, dead: 0,
          w: 3, h: 3, originY: FLOORS[1].y - 3 },
        // Hopping toad (slime)
        { type: 'slime', x: 100, y: FLOORS[3].y - 2, vx: 6, facing: 1, hp: 1, maxHp: 1,
          floorIdx: 3, minX: 60, maxX: 180, hop: 0, hurt: 0, dead: 0,
          w: 5, h: 2, originY: FLOORS[3].y - 2 },
        // Parrot (ghost-style float)
        { type: 'ghost', cx: 100, cy: 20, rx: 40, ry: 6,
          x: 98, y: 20, phase: 0, pSpeed: 0.8, hp: 1, maxHp: 1,
          facing: 1, hurt: 0, dead: 0, w: 3, h: 3 },
      ];
    } else if (n === 7) {
      // Volcano boss arena — the fire demon and a couple of bat helpers.
      enemies = [
        // Boss
        { type: 'demon',
          x: 140, y: FLOORS[0].y - 4,
          vx: 0, facing: -1,
          hp: 12, maxHp: 12, hurt: 0, dead: 0,
          w: 5, h: 4,
          floorIdx: 0, floorY: FLOORS[0].y,
          climbing: null, targetFloorIdx: -1, targetFloorY: 0,
          walk: 0, repath: 0,
          shootCool: 2.0,
          shootPhase: 0,
        },
        // Helper bat-ghosts patrolling between floors
        { type: 'ghost', cx: 60, cy: 36, rx: 30, ry: 10,
          x: 58, y: 36, phase: 0, pSpeed: 1.2, hp: 1, maxHp: 1,
          facing: 1, hurt: 0, dead: 0, w: 3, h: 3 },
        { type: 'ghost', cx: 140, cy: 22, rx: 30, ry: 8,
          x: 138, y: 22, phase: Math.PI, pSpeed: 1.4, hp: 1, maxHp: 1,
          facing: 1, hurt: 0, dead: 0, w: 3, h: 3 },
      ];
    } else if (n === 8) {
      // Heaven — two angel bosses and a flock of cherubs.
      enemies = [
        { type: 'angel',
          x: 40, y: FLOORS[1].y - 4,
          vx: 0, facing: -1,
          hp: 6, maxHp: 6, hurt: 0, dead: 0,
          w: 5, h: 4,
          floorIdx: 1, floorY: FLOORS[1].y,
          flying: false, targetFloorIdx: -1, targetFloorY: 0,
          flightCool: 0, walk: 0, wing: 0,
        },
        { type: 'angel',
          x: 178, y: FLOORS[5].y - 4,
          vx: 0, facing: 1,
          hp: 6, maxHp: 6, hurt: 0, dead: 0,
          w: 5, h: 4,
          floorIdx: 5, floorY: FLOORS[5].y,
          flying: false, targetFloorIdx: -1, targetFloorY: 0,
          flightCool: 1.0, walk: 0, wing: 0,
        },
        // Cherub helpers (1 HP, ghost-float)
        { type: 'cherub', cx: 80,  cy: 20, rx: 22, ry: 4,
          x: 78, y: 20, phase: 0, pSpeed: 1.1, hp: 1, maxHp: 1,
          facing: 1, hurt: 0, dead: 0, w: 3, h: 2 },
        { type: 'cherub', cx: 130, cy: 36, rx: 26, ry: 4,
          x: 128, y: 36, phase: Math.PI / 2, pSpeed: 1.3, hp: 1, maxHp: 1,
          facing: 1, hurt: 0, dead: 0, w: 3, h: 2 },
        { type: 'cherub', cx: 60,  cy: 50, rx: 30, ry: 3,
          x: 58, y: 50, phase: Math.PI, pSpeed: 0.9, hp: 1, maxHp: 1,
          facing: 1, hurt: 0, dead: 0, w: 3, h: 2 },
      ];
    } else if (n === 9) {
      // Matrix — 3 agents + weak minions.
      enemies = [
        // Three agents on different floors.
        { type: 'agent',
          x: 60, y: FLOORS[2].y - 4,
          vx: 0, facing: -1,
          hp: 5, maxHp: 5, hurt: 0, dead: 0,
          w: 5, h: 4,
          floorIdx: 2, floorY: FLOORS[2].y,
          climbing: null, targetFloorIdx: -1, targetFloorY: 0,
          walk: 0, repath: 0,
          teleportCool: 14 + Math.random() * 10,
          teleportState: 'idle',
          teleportTimer: 0,
        },
        { type: 'agent',
          x: 140, y: FLOORS[1].y - 4,
          vx: 0, facing: 1,
          hp: 5, maxHp: 5, hurt: 0, dead: 0,
          w: 5, h: 4,
          floorIdx: 1, floorY: FLOORS[1].y,
          climbing: null, targetFloorIdx: -1, targetFloorY: 0,
          walk: 0, repath: 0,
          teleportCool: 22 + Math.random() * 10,
          teleportState: 'idle',
          teleportTimer: 0,
        },
        { type: 'agent',
          x: 100, y: FLOORS[0].y - 4,
          vx: 0, facing: -1,
          hp: 5, maxHp: 5, hurt: 0, dead: 0,
          w: 5, h: 4,
          floorIdx: 0, floorY: FLOORS[0].y,
          climbing: null, targetFloorIdx: -1, targetFloorY: 0,
          walk: 0, repath: 0,
          teleportCool: 32 + Math.random() * 10,
          teleportState: 'idle',
          teleportTimer: 0,
        },
        // Weak "sentinel" minions — reuse ghost float with green palette.
        { type: 'sentinel', cx: 80,  cy: 36, rx: 28, ry: 4,
          x: 78, y: 36, phase: 0, pSpeed: 1.2, hp: 1, maxHp: 1,
          facing: 1, hurt: 0, dead: 0, w: 3, h: 2 },
        { type: 'sentinel', cx: 130, cy: 20, rx: 30, ry: 4,
          x: 128, y: 20, phase: Math.PI, pSpeed: 1.0, hp: 1, maxHp: 1,
          facing: 1, hurt: 0, dead: 0, w: 3, h: 2 },
        { type: 'sentinel', cx: 60,  cy: 52, rx: 30, ry: 3,
          x: 58, y: 52, phase: Math.PI / 2, pSpeed: 1.4, hp: 1, maxHp: 1,
          facing: 1, hurt: 0, dead: 0, w: 3, h: 2 },
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
  // Birds — flocks of small flapping shapes that drift across every level.
  const BIRDS = [];
  const BIRD_PALETTE = {
    0: '#2a3340',   // forest: dark silhouettes
    1: '#ffffff',   // river: white seagulls
    2: '#ffd56b',   // sky: yellow finches
    3: '#4a4458',   // cave: faint shadows (rare)
    4: '#1a1a22',   // snow: stark ravens
    5: '#c8a8ff',   // space: faint glowing things
    6: '#ff6a3a',   // jungle: vivid parrots
    7: '#ff8a30',   // volcano: ember-bright cinderbirds
    8: '#ffe888',   // heaven: golden doves
    9: '#60ff60',   // matrix: glitchy code-birds
  };
  const BIRD_FRAMES = ['/V\\', '_v_'];
  // Drifting leaves shed from trees.  Per-tree rate is tied to wind phase.
  const TREE_LEAVES = [];

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

  // UFO — 5 wide × 2 rows tall, two-frame light-blink.
  const UFO_A = [
    ' ╭─╮ ',
    '◢███◣',
  ];
  const UFO_B = [
    ' ╭─╮ ',
    '◣███◢',
  ];
  const UFO_COLORS = ['#a8e0ff', '#7fc8ff'];

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

  // Tiger — 5 wide × 3 rows, two-frame leg shuffle.
  const TIGER_A = [
    ' ʌ ʌ ',
    '(°ω°)',
    '/▓▓▓\\',
  ];
  const TIGER_B = [
    ' ʌ ʌ ',
    '(°ω°)',
    '\\▓▓▓/',
  ];
  const TIGER_COLORS = ['#ffa040', '#ffd56b', '#c87020'];

  // Fire-demon boss — 5×4, two-frame mouth animation.
  const DEMON_A = [
    ' ʌ ʌ ',
    '(◉ ◉)',
    '(─v─)',
    '╱▓▓▓╲',
  ];
  const DEMON_B = [
    ' ʌ ʌ ',
    '(◉ ◉)',
    '(─^─)',
    '╲▓▓▓╱',
  ];
  const DEMON_COLORS = ['#c01020', '#ffd000', '#ff6a30', '#a01020'];

  // Angel boss — 5 wide × 4 rows, wing-flap animation.
  const ANGEL_A = [
    '  ◯  ',
    ' ◔◔  ',
    '╲▓▓▓╱',
    '  ║  ',
  ];
  const ANGEL_B = [
    '  ◯  ',
    ' ◔◔  ',
    '─▓▓▓─',
    '  ║  ',
  ];
  const ANGEL_COLORS = ['#ffe888', '#ffffff', '#ffd56b', '#caa040'];

  // Cherub — small floating angel, 2 rows × 3.
  const CHERUB_A = [' ◯ ', 'ʕoʔ'];
  const CHERUB_B = [' ◯ ', 'ʕoʔ'];
  const CHERUB_COLORS = ['#ffe888', '#ffd56b'];

  // Matrix agent — 5×4 sharp suit silhouette.
  const AGENT_A = [
    ' ▄▄▄ ',
    '(▬█▬)',
    ' ▓▓▓ ',
    ' ╱ ╲ ',
  ];
  const AGENT_B = [
    ' ▄▄▄ ',
    '(▬█▬)',
    ' ▓▓▓ ',
    ' ╲ ╱ ',
  ];
  const AGENT_COLORS = ['#222a22', '#101410', '#1a2418', '#0a0e0a'];

  // Sentinel minion — small mechanical scout.
  const SENTINEL_A = [' ◓◒', '╳▒╳'];
  const SENTINEL_B = [' ◒◓', '╳▒╳'];
  const SENTINEL_COLORS = ['#60ff60', '#207020'];

  // Projectiles fired by the demon (and any future ranged enemy).
  const PROJECTILES = [];

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

  // Tree sprites — taller (10 rows) for the high-res grid.
  // Last 3 rows are trunk and never sway.
  const TREE_PINE = [
    '    ▲    ',
    '   ▲▲▲   ',
    '  ▲▲▲▲▲  ',
    '   ▲▲▲   ',
    '  ▲▲▲▲▲  ',
    ' ▲▲▲▲▲▲▲ ',
    '▲▲▲▲▲▲▲▲▲',
    '   ║║║   ',
    '   ║║║   ',
    '   ║║║   ',
  ];
  const TREE_PINE_COLORS = [
    '#5fbf7a', '#4eb070', '#3ea65a',
    '#4eb070', '#3ea65a', '#2f8e4a', '#256f3a',
    '#7a4a22', '#7a4a22', '#5a3a18',
  ];

  const TREE_ROUND = [
    '   ╭▒▓╮  ',
    '  ▓▓▓▓▓▓ ',
    ' ▓▒▓▓▓▒▓ ',
    '▓▓▒▓▓▓▒▓▓',
    ' ▓▓▒▓▓▓▒ ',
    '  ▓▓▓▓▓  ',
    '   ▓▓▓   ',
    '   ║║║   ',
    '   ║║║   ',
    '   ║║║   ',
  ];
  const TREE_ROUND_COLORS = [
    '#5fd47e', '#4ec46f', '#3ea65a', '#3ea65a',
    '#3ea65a', '#2f8e4a', '#256f3a',
    '#7a4a22', '#7a4a22', '#5a3a18',
  ];

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
  function updateTreeLeaves(dt) {
    if (!TREES || !TREES.length) return;
    // Spawn rate scales with wind; capped to keep CPU happy.
    if (TREE_LEAVES.length < 60 && Math.random() < dt * (1.8 + Math.abs(Math.sin(windPhase)) * 1.4)) {
      const t = TREES[Math.floor(Math.random() * TREES.length)];
      const f = FLOORS[t.floorIdx];
      if (!f) return;
      const treeH = 10;
      const topY = f.y - treeH;
      const isSnow = t.kind === 'snow-pine';
      const palette = isSnow ? ['#ffffff', '#dbe6f0', '#a0c0d0']
                              : (t.kind === 'pine'
                                 ? ['#5fbf7a', '#4ea35a', '#256f3a', '#caa040']
                                 : ['#6fd47e', '#3ea65a', '#ffd56b', '#ff9a3a']);
      const glyphs = isSnow ? ['*','·','˖','∗'] : ['·','\'','‧','˖','•'];
      TREE_LEAVES.push({
        x: t.x + (Math.random() - 0.5) * 7,
        y: topY + Math.random() * (treeH - 3),
        vx: (Math.random() - 0.5) * 1.6,
        vy: 0.8 + Math.random() * 1.4,
        phase: Math.random() * Math.PI * 2,
        ch: glyphs[Math.floor(Math.random() * glyphs.length)],
        color: palette[Math.floor(Math.random() * palette.length)],
        life: 4 + Math.random() * 3,
        age: 0,
      });
    }
    for (let i = TREE_LEAVES.length - 1; i >= 0; i--) {
      const l = TREE_LEAVES[i];
      l.age += dt;
      l.phase += dt * 3;
      l.x += (l.vx + Math.sin(l.phase) * 1.2) * dt;
      l.y += l.vy * dt;
      // Settle once they touch a floor.
      const f = FLOORS.find(fl => l.x >= fl.left && l.x <= fl.right && l.y + 1 >= fl.y);
      if (f) { l.y = f.y - 1; l.vy = 0; l.vx = 0; }
      if (l.age >= l.life) TREE_LEAVES.splice(i, 1);
    }
  }
  function drawTreeLeaves() {
    for (const l of TREE_LEAVES) {
      const a = 1 - l.age / l.life;
      if (a < 0.08) continue;
      const ax = Math.floor(l.x), ay = Math.floor(l.y);
      if (ax < 0 || ax >= COLS || ay < 0 || ay >= ROWS) continue;
      putChar(ax, ay, l.ch, l.color);
    }
  }

  function updateBirds(dt) {
    // Cave is mostly bat territory and snow is sparse — fewer birds.
    const cap = screen === 3 ? 0 : (screen === 4 ? 2 : 4);
    const rate = (screen === 1 || screen === 2) ? 0.55 : 0.25;
    if (BIRDS.length < cap && Math.random() < dt * rate) {
      const goingRight = Math.random() < 0.5;
      const altitude = (screen === 2) ? (4 + Math.random() * 12)
                                       : (3 + Math.random() * 8);
      BIRDS.push({
        x: goingRight ? -4 : COLS + 4,
        y: altitude,
        vx: goingRight ? 22 + Math.random() * 16 : -(22 + Math.random() * 16),
        yPhase: Math.random() * Math.PI * 2,
        anim: 0,
        size: Math.random() < 0.5 ? 1 : 2,   // small or normal
      });
    }
    for (let i = BIRDS.length - 1; i >= 0; i--) {
      const b = BIRDS[i];
      b.x += b.vx * dt;
      b.yPhase += dt * 4;
      b.anim += dt * 11;
      if (b.x < -6 || b.x > COLS + 6) BIRDS.splice(i, 1);
    }
  }

  function updateBackground(dt) {
    windPhase += dt * 0.9;
    updateClouds(dt);
    updateShootingStars(dt);
    updateFireflies(dt);
    updateBats(dt);
    updateBirds(dt);
    updateTreeLeaves(dt);
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
  //  MUSIC  (per-level looping melody + bass)
  // ───────────────────────────────────────────────────────────────────────
  const NOTES = {
    A1: 55.00,  C2: 65.41,  D2: 73.42,  E2: 82.41,  F2: 87.31,  G2: 98.00,  A2: 110.00, B2: 123.47,
    C3: 130.81, D3: 146.83, Eb3:155.56, E3: 164.81, F3: 174.61, Fs3:185.00, G3: 196.00, Ab3:207.65, A3: 220.00, Bb3:233.08, B3: 246.94,
    C4: 261.63, D4: 293.66, Eb4:311.13, E4: 329.63, F4: 349.23, Fs4:369.99, G4: 392.00, Ab4:415.30, A4: 440.00, Bb4:466.16, B4: 493.88,
    C5: 523.25, D5: 587.33, Eb5:622.25, E5: 659.25, F5: 698.46, G5: 783.99, A5: 880.00, B5: 987.77,
    REST: 0,
  };
  // 8-step melodies + 4-step bass per screen, repeating forever.
  const MUSIC_TRACKS = {
    0: { tempo: 88,  notes: ['A3','C4','E4','D4','C4','A3','E4','G4','F4','E4','D4','C4','A3','G3','C4','E4'],
                     bass:  ['A2','A2','E2','E2','F2','F2','C3','C3'] },
    1: { tempo: 78,  notes: ['D4','F4','A4','D5','C5','A4','F4','D4','A3','C4','E4','A4','G4','E4','C4','A3'],
                     bass:  ['D2','D2','A2','A2','F2','F2','C3','C3'] },
    2: { tempo: 112, notes: ['C5','E5','G5','E5','C5','E5','G5','C5','D5','F5','A5','F5','D5','F5','A5','D5'],
                     bass:  ['C3','C3','F2','F2','G2','G2','C3','C3'] },
    3: { tempo: 58,  notes: ['A2','REST','C3','E3','A3','REST','G3','E3','F3','REST','A3','C4','E4','REST','D4','C4'],
                     bass:  ['A1','A1','F2','F2','C3','C3','E3','E3'] },
    4: { tempo: 132, notes: ['E4','G4','B4','E5','D5','B4','G4','E4','F4','A4','C5','F5','E5','C5','A4','F4'],
                     bass:  ['E2','E2','G2','G2','A2','A2','D3','D3'] },
    // Deep Space — slow, drifting fifths with sparse high triangle notes.
    5: { tempo: 64,  notes: ['REST','E4','REST','G4','REST','B4','REST','D5','REST','C5','REST','A4','REST','G4','REST','E4'],
                     bass:  ['E2','E2','G2','G2','A2','A2','C3','C3'] },
    // Jungle — rhythmic minor groove (tribal vibe).
    6: { tempo: 116, notes: ['A3','REST','C4','E4','A3','REST','G3','E4','D4','REST','F4','A4','D4','REST','C4','A3'],
                     bass:  ['A2','A2','D3','D3','F2','F2','E2','E2'] },
    // Volcano — relentless minor-key boss theme.
    7: { tempo: 144, notes: ['D4','F4','A4','D5','C5','A4','F4','D4','Eb4','G4','Bb4','Eb5','D5','Bb4','G4','Eb4'],
                     bass:  ['D2','D2','F2','F2','G2','G2','A2','A2'] },
    // Heavens — slow choral major triads with airy bass.
    8: { tempo: 72,  notes: ['C5','E5','G5','C5','D5','F5','A5','D5','E5','G5','B5','E5','D5','F5','A5','D5'],
                     bass:  ['C3','C3','D3','D3','E3','E3','D3','D3'] },
    // Matrix — tense modal loop with rests for digital feel.
    9: { tempo: 128, notes: ['E3','REST','G3','B3','E4','REST','D4','B3','C4','REST','E3','G3','B3','REST','A3','G3'],
                     bass:  ['E2','E2','E2','E2','A2','A2','D3','D3'] },
  };
  let musicTrack = null;
  let musicStep = 0, musicBassStep = 0;
  let musicNextTime = 0, musicNextBassTime = 0;
  let musicOn = true;          // separate from soundOn (effects)
  const MELODY_VOL = 0.022;
  const BASS_VOL   = 0.018;

  function setMusicForScreen(n) {
    musicTrack = MUSIC_TRACKS[n] || null;
    musicStep = 0;
    musicBassStep = 0;
    musicNextTime = 0;
    musicNextBassTime = 0;
  }

  function playMusicNote(freq, dur, vol, type) {
    if (!freq) return;
    const t = audioCtx.currentTime;
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.04);
    g.gain.linearRampToValueAtTime(vol * 0.65, t + dur * 0.4);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(t);
    osc.stop(t + dur + 0.05);
  }

  function tickMusic() {
    if (!musicTrack || !audioCtx) return;
    if (!musicOn || !soundOn) return;
    if (gameState !== 'playing' || codeInputMode) return;
    const t = audioCtx.currentTime;
    const beat = 60 / musicTrack.tempo;
    if (t >= musicNextTime) {
      playMusicNote(NOTES[musicTrack.notes[musicStep]], beat * 0.95, MELODY_VOL, 'triangle');
      musicStep = (musicStep + 1) % musicTrack.notes.length;
      musicNextTime = (musicNextTime === 0 ? t : musicNextTime) + beat;
    }
    if (musicTrack.bass && t >= musicNextBassTime) {
      const bassBeat = beat * 2;
      playMusicNote(NOTES[musicTrack.bass[musicBassStep]], bassBeat * 0.95, BASS_VOL, 'sine');
      musicBassStep = (musicBassStep + 1) % musicTrack.bass.length;
      musicNextBassTime = (musicNextBassTime === 0 ? t : musicNextBassTime) + bassBeat;
    }
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
    if (k === 'n' || k === 'N') {
      musicOn = !musicOn;
      if (musBtn) musBtn.textContent = musicOn ? 'ON' : 'OFF';
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
  const musBtn = document.getElementById('musBtn');
  if (musBtn) {
    musBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      musicOn = !musicOn;
      musBtn.textContent = musicOn ? 'ON' : 'OFF';
    });
  }

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
    if (n === 0) return { x: 12, y: FLOORS[3].y - 3, floorIdx: 3 };
    if (n === 1) return { x: 8,  y: FLOORS[0].y - 3, floorIdx: 0 };
    if (n === 2) return { x: 8,  y: FLOORS[0].y - 3, floorIdx: 0 };
    if (n === 3) return { x: 12, y: FLOORS[0].y - 3, floorIdx: 0 };
    if (n === 4) return { x: 12, y: FLOORS[3].y - 3, floorIdx: 3 };
    if (n === 5) return { x: 8,  y: FLOORS[0].y - 3, floorIdx: 0 };
    if (n === 6) return { x: 12, y: FLOORS[3].y - 3, floorIdx: 3 };
    if (n === 7) return { x: 12, y: FLOORS[3].y - 3, floorIdx: 3 };
    if (n === 8) return { x: 12, y: FLOORS[6].y - 3, floorIdx: 6 };
    // n === 9 (matrix): bottom floor.
    return            { x: 12, y: FLOORS[3].y - 3, floorIdx: 3 };
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
    DROPS.length = 0;
    BIRDS.length = 0;
    TREE_LEAVES.length = 0;
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
    updateProjectiles(dt);
    updateDog(dt);
    updateSnowflakes(dt);
    updateRain(dt);
    updateGlitches(dt);

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
      function pickFloorAt(y) {
        // Prefer the floor at row y whose horizontal range contains the
        // player; falls back to the first match.
        const pcx = player.x + 1;
        let first = -1;
        for (let i = 0; i < FLOORS.length; i++) {
          if (FLOORS[i].y !== y) continue;
          if (first < 0) first = i;
          if (pcx >= FLOORS[i].left - 0.5 && pcx <= FLOORS[i].right + 0.5) return i;
        }
        return first;
      }
      if (player.vy < 0 && footRow <= L.top) {
        player.y = L.top - 3;
        player.onLadder = false;
        player.state = 'stand';
        player.vy = 0;
        player.floorIdx = pickFloorAt(L.top);
      } else if (player.vy > 0 && footRow >= L.bottom) {
        player.y = L.bottom - 3;
        player.onLadder = false;
        player.state = 'stand';
        player.vy = 0;
        player.floorIdx = pickFloorAt(L.bottom);
      }
    } else {
      // ── HORIZONTAL MOVEMENT ───────────────────────────────────────
      let moving = false;
      if (left  && !right) { player.vx = -PHYS.walkSpeed; player.facing = -1; moving = true; }
      else if (right && !left) { player.vx =  PHYS.walkSpeed; player.facing =  1; moving = true; }
      else { player.vx = 0; }

      // Sitting / jumping
      if (jump && onGround) {
        const jMul = PHYS_OVERRIDES[screen] ? PHYS_OVERRIDES[screen].jumpVMul : 1;
        player.vy = PHYS.jumpV * jMul;
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

      // Gravity (some screens have reduced gravity for floaty movement).
      const gMul = PHYS_OVERRIDES[screen] ? PHYS_OVERRIDES[screen].gravityMul : 1;
      if (!onGround) player.vy = clamp(player.vy + PHYS.gravity * gMul * dt, -100, PHYS.maxFall);

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
          // Autojump pad: bounce the player upward immediately on landing.
          if (f.autojump) {
            player.vy = PHYS.jumpV * 1.5;
            player.state = 'jump';
            // Springy sound
            blip(420, 0.05, 'square', 0.05, 880);
            spawnParticles(player.x + 1, fy - 0.5, {
              count: 12, colors: ['#ffd56b','#ffffff','#7fc8ff'], chars: ['↑','*','·'],
            });
          }
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
        // Boss down — onward to the space level.
        GOAL = 'transit';
        setTimeout(winSound, 200);
        setTimeout(() => advanceScreen(), 900);
      }
    }
    if (GOAL === 'defeat-demon' && gameState === 'playing') {
      const alive = enemies.some(e => e.type === 'demon' && e.hp > 0);
      if (!alive) {
        // Demon down — ascend to the heavens.
        GOAL = 'transit';
        setTimeout(winSound, 200);
        setTimeout(() => advanceScreen(), 900);
      }
    }
    if (GOAL === 'defeat-angels' && gameState === 'playing') {
      const alive = enemies.some(e => e.type === 'angel' && e.hp > 0);
      if (!alive) {
        // Angels down — descend into the Matrix.
        GOAL = 'transit';
        setTimeout(winSound, 200);
        setTimeout(() => advanceScreen(), 900);
      }
    }
    if (GOAL === 'defeat-agents' && gameState === 'playing') {
      const alive = enemies.some(e => e.type === 'agent' && e.hp > 0);
      if (!alive) {
        // All three agents down — game complete.
        GOAL = 'won';
        setTimeout(winSound, 200);
        setTimeout(() => {
          gameState = 'won';
          if (safeOpened) {
            overlayText.textContent = 'PERFECT VICTORY! ★';
            overlaySub.textContent = 'You broke free of the Matrix — click to play again';
          } else {
            overlayText.textContent = 'YOU WIN!';
            overlaySub.textContent = 'The agents fall — click to play again';
          }
          overlay.classList.remove('hidden');
        }, 900);
      }
    }
    // Black-hole goal (space level): walking into the hole's bounding
    // box ends the game.
    if (GOAL === 'reach-blackhole' && BLACKHOLE && gameState === 'playing') {
      const pcx = player.x + 1, pcy = player.y + 1.5;
      if (pcx >= BLACKHOLE.x && pcx <= BLACKHOLE.x + BLACKHOLE.w &&
          pcy >= BLACKHOLE.y && pcy <= BLACKHOLE.y + BLACKHOLE.h) {
        // Cross the event horizon → drop into the jungle (next screen).
        GOAL = 'transit';
        spawnParticles(player.x + 1, player.y + 1, {
          count: 60, colors: ['#ffd56b','#c060e0','#7fc8ff','#ffffff'],
          chars: ['✦','★','✧','·','+','*'],
        });
        setTimeout(() => advanceScreen(), 700);
      }
    }
    // Teleporters (space level): stepping onto a portal whisks you off.
    if (TELEPORTS.length) {
      if (teleCooldown > 0) teleCooldown -= dt;
      if (teleCooldown <= 0) {
        for (const t of TELEPORTS) {
          if (player.floorIdx !== t.floorIdx) continue;
          if (Math.abs((player.x + 1) - t.x) < 2) {
            // Pick a random different teleporter and warp to it.
            const others = TELEPORTS.filter(o => o !== t);
            const dest = others[(Math.random() * others.length) | 0];
            if (dest) {
              const dFloor = FLOORS[dest.floorIdx];
              if (dFloor) {
                spawnParticles(player.x + 1, player.y + 1, {
                  count: 30, colors: ['#7fc8ff','#c060e0','#ffffff'],
                  chars: ['*','·','✦','+'],
                });
                player.x = dest.x - 1;
                player.y = dFloor.y - 3;
                player.floorIdx = dest.floorIdx;
                player.vx = 0; player.vy = 0;
                blip(900, 0.10, 'square', 0.06, 1400);
                setTimeout(() => blip(1320, 0.12, 'triangle', 0.05), 90);
                spawnParticles(player.x + 1, player.y + 1, {
                  count: 30, colors: ['#7fc8ff','#c060e0','#ffffff'],
                  chars: ['*','·','✦','+'],
                });
                teleCooldown = 0.6;     // brief grace so we don't ping-pong
              }
            }
            break;
          }
        }
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
    // ── BOMB BUTTONS (press E nearby to arm; explodes after fuse) ──
    if (BOMB_BUTTONS.length) {
      for (const b of BOMB_BUTTONS) {
        if (b.used) continue;
        if (interactQueued && !codeInputMode) {
          // Button visual centre is at b.x; allow a generous activation
          // box so the player just has to be standing on / near it.
          const ddx = (player.x + 1) - b.x;
          const sameFloor = player.floorIdx === b.floorIdx;
          if (sameFloor && Math.abs(ddx) < 5) {
            b.armed = b.fuse;
            b.used = true;
            blip(700, 0.05, 'square', 0.05);
            interactQueued = false;          // consumed
            break;
          }
        }
      }
      // Tick down armed bombs and detonate when fuse hits zero.
      for (const b of BOMB_BUTTONS) {
        if (!b.used || b.armed <= 0) continue;
        b.armed -= dt;
        if (b.armed <= 0) detonateBomb(b);
      }
    }
    // ── SPAWN BUTTONS (cave): summon a guardian (3 HP, drops potion) ─
    if (SPAWN_BUTTONS.length && interactQueued && !codeInputMode) {
      for (const b of SPAWN_BUTTONS) {
        if (b.used) continue;
        const ddx = (player.x + 1) - b.x;
        const sameFloor = player.floorIdx === b.floorIdx;
        if (sameFloor && Math.abs(ddx) < 5) {
          b.used = true;
          spawnGuardian(b);
          blip(330, 0.10, 'sawtooth', 0.05, 660);
          interactQueued = false;
          break;
        }
      }
    }
    interactQueued = false;

    // ── DROPPED POTIONS (from killed guardians) ─────────────────────
    if (DROPS.length) {
      for (let i = DROPS.length - 1; i >= 0; i--) {
        const d = DROPS[i];
        // Pull toward closest floor (gravity-style)
        d.vy = Math.min(d.vy + 80 * dt, 30);
        d.y += d.vy * dt;
        for (const f of FLOORS) {
          if (d.x + 1 >= f.left && d.x + 1 <= f.right + 1 && d.y >= f.y - 1) {
            d.y = f.y - 1; d.vy = 0; break;
          }
        }
        const ddx = (player.x + 1) - (d.x + 1);
        const ddy = (player.y + 1.5) - (d.y + 0.5);
        if (Math.abs(ddx) < 4 && Math.abs(ddy) < 5) {
          if (player.hp < player.maxHp) player.hp += 1;
          DROPS.splice(i, 1);
          blip(660, 0.08, 'square', 0.06);
          setTimeout(() => blip(880, 0.10, 'square', 0.06), 60);
          spawnParticles(d.x + 1, d.y, { count: 14, colors: ['#ff5070','#ff9aa0','#ffffff'], chars: ['♥','*','+'] });
        }
      }
    }

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
      } else if (e.type === 'ufo') {
        // Drifts on a stretched elliptic path, gently bobbing.
        e.phase += dt * e.pSpeed;
        e.x = e.cx + Math.cos(e.phase) * e.rx - 2;
        e.y = e.cy + Math.sin(e.phase * 1.8) * e.ry;
        e.facing = Math.cos(e.phase) >= 0 ? 1 : -1;
      } else if (e.type === 'snowman') {
        updateSnowman(e, dt);
      } else if (e.type === 'tiger') {
        updateSnowman(e, dt);
      } else if (e.type === 'demon') {
        updateSnowman(e, dt);
        updateDemonShooting(e, dt);
      } else if (e.type === 'angel') {
        updateAngel(e, dt);
      } else if (e.type === 'cherub' || e.type === 'sentinel') {
        // Same float behaviour as a ghost.
        e.phase += dt * e.pSpeed;
        e.x = e.cx + Math.cos(e.phase) * e.rx - 1;
        e.y = e.cy + Math.sin(e.phase * 1.4) * e.ry;
        e.facing = Math.cos(e.phase) >= 0 ? 1 : -1;
      } else if (e.type === 'agent') {
        updateAgent(e, dt);
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
  const SNOWMAN_WALK = 14;        // cells/sec — slower than the player (24)
  const SNOWMAN_CLIMB = 10;
  // Tiger speeds: 85% of the player's 24 cells/sec walk = 20.4.
  const TIGER_WALK = 20.4;
  const TIGER_CLIMB = 16;

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

  const ANGEL_WALK = 19.2;     // 80% of player walk (24)
  const ANGEL_FLY = 24;
  const ANGEL_FLIGHT_COOLDOWN = 3.0;   // grace window for the player to escape

  // Matrix agent — 90% of player walk, climbs ladders, teleports.
  const AGENT_WALK = 21.6;
  const AGENT_CLIMB = 16;
  const AGENT_TELEPORT_COOLDOWN = 40.0;
  const AGENT_FADE_TIME = 2.4;
  const AGENT_ASSEMBLE_TIME = 2.4;

  function updateAgent(a, dt) {
    a.teleportCool = (a.teleportCool ?? AGENT_TELEPORT_COOLDOWN) - dt;
    if (a.teleportState === 'wind-up') {
      a.teleportTimer -= dt;
      if (a.teleportTimer <= 0) {
        a.teleportState = 'fading';
        a.teleportTimer = AGENT_FADE_TIME;
        blip(180, 0.20, 'sawtooth', 0.06, 60);
      }
      return;
    }
    if (a.teleportState === 'fading') {
      a.teleportTimer -= dt;
      // Trail of glitch particles while fading.
      if ((Math.random() < dt * 12)) {
        spawnParticles(a.x + a.w / 2, a.y + a.h / 2, {
          count: 1,
          colors: ['#60ff60','#a0ffa0','#ffffff','#0a3010'],
          chars: ['1','0','▓','░','▒'],
        });
      }
      if (a.teleportTimer <= 0) {
        // Teleport to a point 3-4 cells from the player.
        const dir = Math.random() < 0.5 ? -1 : 1;
        const offset = 3 + Math.random() * 2;
        let tx = player.x + dir * offset;
        const pf = FLOORS[player.floorIdx];
        if (pf) {
          tx = Math.max(pf.left, Math.min(pf.right - a.w, tx));
          a.x = tx;
          a.y = pf.y - a.h;
          a.floorIdx = player.floorIdx;
          a.floorY = pf.y;
        }
        a.teleportState = 'assembling';
        a.teleportTimer = AGENT_ASSEMBLE_TIME;
        spawnParticles(a.x + a.w / 2, a.y + a.h / 2, {
          count: 40,
          colors: ['#60ff60','#a0ffa0','#ffffff'],
          chars: ['*','+','░','▒','1','0'],
        });
        blip(720, 0.15, 'square', 0.06, 220);
      }
      return;
    }
    if (a.teleportState === 'assembling') {
      a.teleportTimer -= dt;
      // Sparkles popping in around the agent.
      if (Math.random() < dt * 14) {
        const ox = (Math.random() - 0.5) * 6;
        const oy = (Math.random() - 0.5) * 4;
        spawnParticles(a.x + a.w / 2 + ox, a.y + a.h / 2 + oy, {
          count: 1,
          colors: ['#60ff60','#a0ffa0','#ffffff'],
          chars: ['*','·','+','1','0'],
        });
      }
      if (a.teleportTimer <= 0) {
        a.teleportState = 'idle';
        a.teleportCool = AGENT_TELEPORT_COOLDOWN;
      }
      return;
    }
    // Idle: ladder-routed chase, then check whether to teleport.
    updateSnowman(a, dt);
    if (a.teleportCool <= 0 && !a.climbing) {
      a.teleportState = 'wind-up';
      a.teleportTimer = 0.8;
      blip(240, 0.10, 'square', 0.04);
    }
  }

  function updateAngel(a, dt) {
    if (a.flightCool > 0) a.flightCool -= dt;
    a.wing = (a.wing || 0) + dt * 7;

    // Mid-flight: only move vertically, ignore everything else.
    if (a.flying) {
      const dir = a.targetFloorY < a.y ? -1 : 1;
      a.y += dir * ANGEL_FLY * dt;
      const target = a.targetFloorY - (a.h || 4);
      if ((dir < 0 && a.y <= target) || (dir > 0 && a.y >= target)) {
        a.y = target;
        a.floorIdx = a.targetFloorIdx;
        a.floorY = a.targetFloorY;
        a.flying = false;
        a.flightCool = ANGEL_FLIGHT_COOLDOWN;
      }
      return;
    }

    // Snap to whichever floor segment is under the angel right now,
    // so we always have a sensible floorY to compare against.
    const fxc = a.x + a.w / 2;
    let f = FLOORS[a.floorIdx];
    if (!f || f.y !== a.floorY) {
      const fb = FLOORS.find(fl => fl.y === a.floorY && fxc >= fl.left && fxc <= fl.right);
      if (fb) { a.floorIdx = FLOORS.indexOf(fb); f = fb; }
    }
    a.y = (f ? f.y : a.floorY) - (a.h || 4);

    // Initiate vertical flight if the player has slipped onto a
    // different y, but only once the cooldown is up (so the player can
    // dive through a hole and have a real escape window).
    const playerFloor = FLOORS[player.floorIdx];
    if (playerFloor && playerFloor.y !== a.floorY && a.flightCool <= 0) {
      a.flying = true;
      a.targetFloorIdx = player.floorIdx;
      a.targetFloorY = playerFloor.y;
      return;
    }

    // Otherwise chase the player horizontally at 80% of player speed.
    const dxp = (player.x + 1.5) - (a.x + a.w / 2);
    if (Math.abs(dxp) > 0.5) {
      a.facing = Math.sign(dxp);
      a.x += a.facing * ANGEL_WALK * dt;
      a.walk += dt * 4;
    }
    a.x = Math.max(0, Math.min(COLS - a.w, a.x));
  }

  function updateDemonShooting(d, dt) {
    if (d.climbing) return;
    d.shootCool -= dt;
    d.shootPhase = (d.shootPhase || 0) + dt;
    if (d.shootCool <= 0) {
      // Fire a homing-ish fireball toward where the player is right now.
      const fromX = d.x + d.w / 2;
      const fromY = d.y + d.h / 2;
      const tx = player.x + 1.5;
      const ty = player.y + 1.5;
      const dxp = tx - fromX, dyp = ty - fromY;
      const dist = Math.sqrt(dxp * dxp + dyp * dyp) || 1;
      const speed = 36;
      PROJECTILES.push({
        x: fromX, y: fromY,
        vx: (dxp / dist) * speed,
        vy: (dyp / dist) * speed - 4,    // small upward arc
        life: 2.6, age: 0,
        spinPhase: 0,
        owner: 'demon',
      });
      d.facing = Math.sign(dxp) || d.facing;
      d.shootCool = 2.2 + Math.random() * 1.2;
      // Sound: deep whoosh
      blip(140, 0.18, 'sawtooth', 0.06, 60);
      noiseBurst(0.06, 0.04);
    }
  }

  function updateProjectiles(dt) {
    for (let i = PROJECTILES.length - 1; i >= 0; i--) {
      const p = PROJECTILES[i];
      p.age += dt;
      p.spinPhase += dt * 10;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 14 * dt;                  // mild gravity (fireball arcs)
      // Player collision (sphere around player centre)
      if (player.invul <= 0 && !player.dead) {
        const cdx = (player.x + 1.5) - p.x;
        const cdy = (player.y + 1.5) - p.y;
        if (cdx * cdx + cdy * cdy < 4.5) {
          player.hp -= 1;
          player.invul = PLAYER_INVUL;
          player.hurtFlash = 0.25;
          hurtSound();
          spawnParticles(p.x, p.y, { count: 16,
            colors: ['#ff6a30','#ffd56b','#ffffff'], chars: ['*','+','✦','×'] });
          PROJECTILES.splice(i, 1);
          continue;
        }
      }
      // Floor collision → splash and disappear
      let hitFloor = false;
      for (const f of FLOORS) {
        if (p.x + 1 >= f.left && p.x + 1 <= f.right + 1 && p.y >= f.y - 0.5 && p.y <= f.y + 1) {
          hitFloor = true; break;
        }
      }
      if (hitFloor || p.age > p.life || p.x < -2 || p.x > COLS + 2 || p.y > ROWS) {
        spawnParticles(p.x, p.y, { count: 8,
          colors: ['#ff6a30','#ffd56b'], chars: ['*','+','·'] });
        PROJECTILES.splice(i, 1);
      }
    }
  }

  function drawProjectiles(time) {
    for (const p of PROJECTILES) {
      const spin = (p.spinPhase | 0) % 4;
      const ch = ['◉','●','◎','◍'][spin];
      const px = Math.floor(p.x), py = Math.floor(p.y);
      // Brief trail behind it
      const tx = Math.floor(p.x - Math.sign(p.vx));
      putChar(tx, py, '·', '#ff9a3a');
      putChar(px, py, ch, '#ffd56b');
      // Outer flame ring sparkle
      if (((p.spinPhase | 0) % 2) === 0) putChar(px, py - 1, '✦', '#ff6a30');
    }
  }

  function updateSnowman(s, dt) {
    // Tigers + Agents reuse this routine with their own speeds.
    const WALK_SPEED  = s.type === 'tiger' ? TIGER_WALK
                       : s.type === 'agent' ? AGENT_WALK
                       : SNOWMAN_WALK;
    const CLIMB_SPEED = s.type === 'tiger' ? TIGER_CLIMB
                       : s.type === 'agent' ? AGENT_CLIMB
                       : SNOWMAN_CLIMB;
    // While climbing, just move vertically.
    if (s.climbing) {
      const dir = s.climbing === 'up' ? -1 : 1;
      s.y += dir * CLIMB_SPEED * dt;
      // Done?
      const targetY = s.targetFloorY - (s.h || 4);
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
    s.y = f.y - (s.h || 4);
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
      s.vx = Math.sign(dx) * WALK_SPEED;
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
  const DOG_WALK = 22;     // cells/sec on flat ground
  const DOG_CLIMB = 14;
  const DOG_STUN_DURATION = 10.0;   // seconds

  function updateDog(dt) {
    if (!dog) return;
    if (dog.biteCool > 0) dog.biteCool -= dt;
    if (dog.biteFlash > 0) dog.biteFlash -= dt;
    dog.bobPhase += dt * 6;

    // ── Stunned: dog is knocked off, can't move for DOG_STUN_DURATION s
    // (with a brief falling-arc animation while it settles on a floor).
    if (dog.stunned > 0) {
      dog.stunned -= dt;
      dog.stunPhase = (dog.stunPhase || 0) + dt * 5;
      // Physics on the dog while it falls back to a floor.
      if (!dog.grounded) {
        dog.vy = (dog.vy || 0) + PHYS.gravity * dt;
        dog.vx = (dog.vx || 0) * 0.92;
        dog.x += dog.vx * dt;
        dog.y += dog.vy * dt;
        // Snap to the first floor whose top we cross while falling.
        for (let i = 0; i < FLOORS.length; i++) {
          const f = FLOORS[i];
          if (f.isBoat) continue;
          const pcx = dog.x + 2;
          if (pcx < f.left - 0.5 || pcx > f.right + 0.5) continue;
          if ((dog.y + 2) >= f.y && dog.vy > 0) {
            dog.y = f.y - 2;
            dog.vy = 0; dog.vx = 0;
            dog.floorIdx = i;
            dog.grounded = true;
            break;
          }
        }
        if (dog.y > ROWS) { dog.y = ROWS - 2; dog.vy = 0; dog.grounded = true; }
      }
      return;
    }
    dog.grounded = false;  // re-enter normal AI; floor tracked by AI now.

    // Find a snowman target (any alive snowman).
    const snowman = enemies.find(e => e.type === 'snowman' && e.hp > 0);
    const mood = (snowman && Math.abs(snowman.y - player.y) < 16) ? 'chase' : 'follow';
    dog.mood = mood;

    // Pick a desired x for "follow" or "chase" on the dog's current
    // floor.  When the player is on a different floor the dog instead
    // routes to a ladder leading toward the player's floor.
    function pickFollowTx() {
      if (mood === 'chase' && snowman) {
        return snowman.x + (snowman.x > player.x ? -2 : snowman.w);
      }
      return player.x - 5 * (player.facing || 1);
    }

    // Use ladder-routing AI on screens that have ladders (snow boss arena,
    // cave when the safe just popped, etc.).  Falls back to a smooth lerp
    // anywhere that has no ladders to climb (sky, river, space).
    const hasLadders = LADDERS && LADDERS.length > 0;

    if (hasLadders) {
      // ── Climb-aware follow (same routing the snowman/tiger use) ─
      if (dog.climbing) {
        const dir = dog.climbing === 'up' ? -1 : 1;
        dog.y += dir * DOG_CLIMB * dt;
        const targetY = dog.targetFloorY - 2;
        const reached = (dir < 0 && dog.y <= targetY) || (dir > 0 && dog.y >= targetY);
        if (reached) {
          dog.y = targetY;
          dog.floorIdx = dog.targetFloorIdx;
          dog.climbing = null;
        }
        return;
      }
      const f = FLOORS[dog.floorIdx];
      if (!f) {
        // Lost — snap to player's floor as a recovery so the dog never
        // ends up in the void.
        dog.floorIdx = player.floorIdx;
      } else {
        dog.y = f.y - 2;
        const playerFloor = FLOORS[player.floorIdx];
        const playerFloorY = playerFloor ? playerFloor.y : f.y;
        if (playerFloorY !== f.y) {
          // Find a ladder going one step toward the player's floor.
          const goUp = playerFloorY < f.y;
          let best = null, bestDx = Infinity;
          for (const l of LADDERS) {
            if (goUp && l.bottom === f.y && l.top < f.y) {
              const dx = Math.abs(l.x - (dog.x + 2));
              if (dx < bestDx) { bestDx = dx; best = l; }
            } else if (!goUp && l.top === f.y && l.bottom > f.y) {
              const dx = Math.abs(l.x - (dog.x + 2));
              if (dx < bestDx) { bestDx = dx; best = l; }
            }
          }
          if (best) { dog.targetX = best.x - 2; dog.targetLadder = best; }
          else      { dog.targetX = player.x;   dog.targetLadder = null; }
        } else {
          dog.targetX = pickFollowTx();
          dog.targetLadder = null;
        }

        const dxv = (dog.targetX !== undefined ? dog.targetX : player.x) - dog.x;
        if (Math.abs(dxv) > 0.5) {
          dog.vx = Math.sign(dxv) * DOG_WALK * (mood === 'chase' ? 1.2 : 1);
          dog.facing = Math.sign(dxv);
          dog.x += dog.vx * dt;
        } else {
          dog.vx = 0;
        }
        dog.x = Math.max(f.left, Math.min(f.right - 4, dog.x));

        // Reached the chosen ladder → start climbing.
        if (dog.targetLadder) {
          const centre = dog.x + 2;
          if (Math.abs(centre - dog.targetLadder.x) < 0.6) {
            const goUp = dog.targetLadder.top < f.y;
            dog.climbing = goUp ? 'up' : 'down';
            dog.x = dog.targetLadder.x - 2;
            const destY = goUp ? dog.targetLadder.top : dog.targetLadder.bottom;
            dog.targetFloorY = destY;
            dog.targetFloorIdx = FLOORS.findIndex(fl => fl.y === destY);
            dog.targetLadder = null;
            dog.vx = 0;
          }
        }
      }
    } else {
      // ── Free-floating smooth follow (anywhere with no ladders).
      let tx, ty;
      if (mood === 'chase' && snowman) {
        tx = snowman.x + (snowman.x > player.x ? -2 : snowman.w);
        ty = snowman.y + 2;
      } else {
        tx = pickFollowTx();
        ty = player.y + 1;
      }
      const speed = mood === 'chase' ? 24 : 16;
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
    }

    // ── Bite!  Close to snowman and cooldown up.  Even successful bites
    // get countered by the snowman — the dog is kicked off and stunned
    // for DOG_STUN_DURATION seconds (unless the bite was the killing blow).
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
        } else {
          // Counter-punch — knock the dog away and stun it.
          dog.stunned = DOG_STUN_DURATION;
          dog.stunPhase = 0;
          dog.climbing = null;
          dog.targetLadder = null;
          const dir = (dog.x + 2.5) < (snowman.x + snowman.w / 2) ? -1 : 1;
          dog.vx = dir * 40;
          dog.vy = -22;
          dog.grounded = false;
          blip(120, 0.30, 'sawtooth', 0.07, 60);
          noiseBurst(0.10, 0.06);
          spawnParticles(dog.x + 2, dog.y, {
            count: 18, colors: ['#ff5070','#ffd56b','#ffffff'], chars: ['*','×','!','?'],
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
        if (e.type === 'agent' && e.teleportState && e.teleportState !== 'idle') continue;
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
            if (e.dropsPotion) {
              DROPS.push({ x: e.x + e.w / 2 - 1, y: e.y, vy: 0 });
            }
          }
        }
      }
    }
    // Enemy contact damage
    if (player.invul <= 0 && !player.dead) {
      const px = player.x, py = player.y;
      for (const e of enemies) {
        if (e.hp <= 0) continue;
        if (e.type === 'agent' && e.teleportState && e.teleportState !== 'idle') continue;
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
      const mr = CHAR_W * 12;
      const mg = ctx.createRadialGradient(mgx, mgy, 0, mgx, mgy, mr);
      mg.addColorStop(0, 'rgba(255,230,160,0.20)');
      mg.addColorStop(1, 'rgba(255,230,160,0)');
      ctx.fillStyle = mg;
      ctx.fillRect(mgx - mr, mgy - mr, mr * 2, mr * 2);

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
      const sr = CHAR_W * 15;
      const sg = ctx.createRadialGradient(sgx, sgy, 0, sgx, sgy, sr);
      sg.addColorStop(0, 'rgba(255,220,140,0.55)');
      sg.addColorStop(1, 'rgba(255,220,140,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(sgx - sr, sgy - sr, sr * 2, sr * 2);
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
      const sr = CHAR_W * 17;
      const sg = ctx.createRadialGradient(sgx, sgy, 0, sgx, sgy, sr);
      sg.addColorStop(0, 'rgba(255,235,170,0.55)');
      sg.addColorStop(1, 'rgba(255,235,170,0)');
      ctx.fillStyle = sg;
      ctx.fillRect(sgx - sr, sgy - sr, sr * 2, sr * 2);
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

    } else if (screen === 5) {
      // ── Outer space: deep gradient + drifting nebula clouds.
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0,    '#03050d');
      grad.addColorStop(0.4,  '#0d0a26');
      grad.addColorStop(0.75, '#1c0e3a');
      grad.addColorStop(1,    '#040810');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Two soft nebula clouds
      const neb = (cx, cy, r, c1, c2) => {
        const gx = cx * CHAR_W, gy = cy * CHAR_H;
        const rPx = r * CHAR_W;
        const g = ctx.createRadialGradient(gx, gy, 0, gx, gy, rPx);
        g.addColorStop(0, c1);
        g.addColorStop(1, c2);
        ctx.fillStyle = g;
        ctx.fillRect(gx - rPx, gy - rPx, rPx * 2, rPx * 2);
      };
      neb( 50 + Math.sin(time * 0.1) * 4, 25, 40, 'rgba(120, 60,200,0.28)', 'rgba(0,0,0,0)');
      neb(150 + Math.cos(time * 0.08) * 3, 40, 36, 'rgba( 60,120,200,0.22)', 'rgba(0,0,0,0)');
      neb(110, 14, 28, 'rgba(200,80,160,0.18)', 'rgba(0,0,0,0)');

      // All the stars twinkle out here.
      for (const s of STARS) {
        const tw = 0.5 + 0.5 * Math.sin(s.phase + time * 2);
        const r = 200 + Math.floor(tw * 55);
        const g = 220 + Math.floor(tw * 35);
        putChar(s.x | 0, s.y | 0, s.ch, `rgba(${r},${g},255,${0.4 + tw * 0.6})`);
      }
      // Extra cluster down low
      for (let i = 0; i < STARS.length; i++) {
        const s = STARS[i];
        const ly = (s.y + 30) | 0;
        if (ly < ROWS - 2) {
          const tw = 0.5 + 0.5 * Math.sin(s.phase + time * 1.3 + i);
          putChar(s.x | 0, ly, s.ch, `rgba(255,240,220,${0.20 + tw * 0.35})`);
        }
      }

    } else if (screen === 6) {
      // ── Jungle: lush greens with a misty top canopy.
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0,    '#10301a');
      grad.addColorStop(0.5,  '#1a4828');
      grad.addColorStop(1,    '#0a200f');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Light shafts piercing the canopy from above.
      for (let i = 0; i < 6; i++) {
        const x = ((i * 33 + Math.floor(time * 4)) % 200);
        const gx = x * CHAR_W;
        const lg = ctx.createLinearGradient(gx, 0, gx, canvas.height);
        lg.addColorStop(0,   'rgba(220,255,180,0.10)');
        lg.addColorStop(0.6, 'rgba(160,210,140,0.05)');
        lg.addColorStop(1,   'rgba(0,0,0,0)');
        ctx.fillStyle = lg;
        ctx.fillRect(gx - 6, 0, 12, canvas.height);
      }

    } else if (screen === 7) {
      // ── Volcano lair: dark sky with rising heat glow at the bottom.
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0,    '#1a0a08');
      grad.addColorStop(0.5,  '#3a1208');
      grad.addColorStop(0.85, '#a02808');
      grad.addColorStop(1,    '#ffaa30');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Heat shimmer band near the bottom — animated by alpha sin.
      const heat = ctx.createLinearGradient(0, (ROWS - 6) * CHAR_H, 0, canvas.height);
      const a = 0.18 + 0.10 * Math.sin(time * 4);
      heat.addColorStop(0, 'rgba(255,140,40,0)');
      heat.addColorStop(1, `rgba(255,200,80,${a.toFixed(3)})`);
      ctx.fillStyle = heat;
      ctx.fillRect(0, (ROWS - 6) * CHAR_H, canvas.width, 6 * CHAR_H);

      // Embers rising — derived from STARS so we don't keep another pool.
      for (let i = 0; i < STARS.length; i++) {
        const s = STARS[i];
        const ey = ROWS - 2 - ((s.phase * 6 + time * 8) % (ROWS - 2));
        const ex = (s.x + Math.sin(time * 2 + i * 0.7) * 1.2) | 0;
        const a2 = 0.4 + 0.3 * Math.sin(time * 3 + i);
        putChar(ex, ey | 0, i % 2 === 0 ? '·' : '*', `rgba(255,200,80,${a2.toFixed(2)})`);
      }

    } else if (screen === 8) {
      // ── Heavens: pearl-and-gold gradient with soft light rays.
      const grad = ctx.createLinearGradient(0, 0, 0, canvas.height);
      grad.addColorStop(0,    '#fff7d0');
      grad.addColorStop(0.5,  '#dfeefb');
      grad.addColorStop(1,    '#b8d4ee');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Sun-burst rays from above
      const cxp = (COLS / 2) * CHAR_W;
      for (let i = 0; i < 12; i++) {
        const ang = (i / 12) * Math.PI * 2 + time * 0.15;
        const rayLen = canvas.height * 1.2;
        const ex = cxp + Math.cos(ang) * rayLen;
        const ey = 0 + Math.sin(ang) * rayLen;
        const lg = ctx.createLinearGradient(cxp, 0, ex, ey);
        lg.addColorStop(0,   'rgba(255,245,200,0.10)');
        lg.addColorStop(0.6, 'rgba(255,245,200,0.04)');
        lg.addColorStop(1,   'rgba(255,245,200,0)');
        ctx.fillStyle = lg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }
      // Sparkles drifting upward — repurposed STARS.
      for (let i = 0; i < STARS.length; i++) {
        const s = STARS[i];
        const ey = ROWS - 4 - ((s.phase * 4 + time * 5) % (ROWS - 4));
        const ex = (s.x + Math.sin(time * 1.5 + i * 0.5) * 1.0) | 0;
        const a2 = 0.4 + 0.4 * Math.sin(time * 2 + i);
        putChar(ex, ey | 0, i % 2 === 0 ? '✦' : '·', `rgba(255,240,150,${a2.toFixed(2)})`);
      }

    } else if (screen === 9) {
      // ── Matrix: pure black backdrop, the code rain handles all the
      // ambient colour (drawRain runs from drawScreenParallax / draw).
      ctx.fillStyle = '#020602';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
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
  // ── Matrix code-rain ────────────────────────────────────────────
  const RAIN_GLYPHS = '01ｱｲｳｴｵｶｷｸｹｺｻｼｽｾｿﾀﾁﾂﾃﾅﾆﾇﾈﾉﾊﾋﾌﾍﾎﾏﾐﾑﾒﾓﾔﾕﾖﾗﾘﾙﾚﾛﾜｦﾝ▒▓░';
  function updateRain(dt) {
    if (screen !== 9 || RAIN_COLS.length === 0) return;
    for (const c of RAIN_COLS) {
      c.head += c.speed * dt;
      c.phase += dt * 8;
      if (c.head > ROWS + 14) {
        c.head = -Math.random() * 14;
        c.speed = 10 + Math.random() * 22;
      }
    }
  }
  function drawRain(time) {
    if (screen !== 9 || RAIN_COLS.length === 0) return;
    const len = RAIN_GLYPHS.length;
    for (const c of RAIN_COLS) {
      for (let i = 0; i < 14; i++) {
        const y = Math.floor(c.head - i);
        if (y < 0 || y >= ROWS) continue;
        const k = ((c.phase + c.x * 7 + y * 3) | 0) % len;
        const ch = RAIN_GLYPHS[Math.abs(k)];
        let col;
        if (i === 0)      col = 'rgba(220,255,200,0.95)';
        else if (i < 3)   col = `rgba(120,255,120,${(0.8 - i * 0.15).toFixed(2)})`;
        else if (i < 8)   col = `rgba(40,200,60,${(0.6 - i * 0.06).toFixed(2)})`;
        else              col = `rgba(20,120,40,${(0.4 - i * 0.04).toFixed(2)})`;
        putChar(c.x, y, ch, col);
      }
    }
  }

  // ── Glitchy decorations (TVs / lamps / chairs) ──────────────────
  const TV_BODY = ['┌───┐', '│░▒░│', '└─┬─┘'];
  const TV_LEGS = '╱   ╲';
  const TV_GLITCH = ['┘├─┐', '│#@%│', '╲┘─┌'];   // sometimes substituted for body rows
  const CHAIR = [' ╔═╗', ' ║ ║', ' ╨ ╨'];
  const LAMP  = ['  ▓', '  ║', ' ═╧'];
  function updateGlitches(dt) {
    for (const g of GLITCH_ITEMS) {
      g.glitch -= dt;
      if (g.glitch <= 0) {
        // Roughly every 3–8 seconds, glitch out briefly.
        if (Math.random() < dt * 0.6) g.glitch = 0.4 + Math.random() * 0.4;
        else g.glitch = 0;
      }
    }
  }
  function drawGlitches(time) {
    for (const g of GLITCH_ITEMS) {
      const f = FLOORS[g.floorIdx];
      if (!f) continue;
      const yTop = f.y - 3;
      const isGlitching = g.glitch > 0;
      let sprite;
      if (g.kind === 'tv') {
        sprite = isGlitching && Math.random() < 0.7 ? TV_GLITCH : TV_BODY;
      } else if (g.kind === 'chair') {
        sprite = CHAIR;
      } else {
        sprite = LAMP;
      }
      const shake = isGlitching ? Math.round((Math.random() - 0.5) * 2) : 0;
      const flicker = isGlitching && (((time * 30) | 0) % 2) === 0;
      for (let r = 0; r < sprite.length; r++) {
        const line = sprite[r];
        const col = flicker
          ? (Math.random() < 0.4 ? '#ff60a0' : '#80ff80')
          : (g.kind === 'tv' ? (r === 1 ? '#a0ffa0' : '#406040') : '#80c080');
        putString(g.x - 2 + shake, yTop + r, line, col);
      }
      if (g.kind === 'tv') {
        // Two short legs below the TV
        putString(g.x - 2 + shake, yTop + 3, TV_LEGS, '#406040');
      }
    }
  }

  function drawSnowflakes() {
    if (screen !== 4) return;
    for (const f of SNOWFLAKES) {
      putChar(f.x | 0, f.y | 0, f.ch, 'rgba(235,245,255,0.85)');
    }
  }

  // Knocked-out dog — lying on its side, dizzy stars circling.
  const DOG_STUN = [
    ' ╴⌒╴  ',
    '(✕‿✕) ',
  ];
  const DOG_STUN_COLORS = ['#7a4a22', '#caa070'];

  function drawDog(time) {
    if (!dog) return;
    const px = Math.round(dog.x);
    const bob = Math.sin(dog.bobPhase) * 0.2;
    const py = Math.round(dog.y + bob);

    if (dog.stunned > 0) {
      // Show "felt off" pose with x-eyes and circling stars.
      putSpriteColored(px, py, DOG_STUN, DOG_STUN_COLORS);
      // Three little stars orbiting above the head.
      const t = (time * 3 + (dog.stunPhase || 0));
      for (let i = 0; i < 3; i++) {
        const a = t + i * (Math.PI * 2 / 3);
        const sx = px + 2 + Math.round(Math.cos(a) * 2);
        const sy = py - 1 + Math.round(Math.sin(a) * 0.7);
        putChar(sx, sy, '✦', i % 2 === 0 ? '#ffd56b' : '#ffffff');
      }
      // Countdown number above the dog so the player knows how long.
      const secs = Math.max(0, Math.ceil(dog.stunned));
      const lbl = String(secs);
      putString(px + 2 - ((lbl.length - 1) >> 1), py - 2, lbl, '#ff8060');
      return;
    }

    const sprite = dog.facing >= 0 ? DOG_R_5 : DOG_L_5;
    const colors = dog.biteFlash > 0
      ? ['#ffd56b', '#ff5070']
      : DOG_COLORS;
    putSpriteColored(px, py, sprite, colors);
    if (dog.mood === 'chase' && (((time * 6) | 0) % 2) === 0) {
      putChar(px + 2, py - 1, '!', '#ff8060');
    }
  }

  function drawMountains(rowTop, rowBot, factor, topCol, botCol) {
    // Parallax: as the player moves right, the mountains slide left a bit.
    const shift = (player.x - 96) * factor;
    const len = MOUNTAIN_TOP.length;
    for (let col = 0; col < COLS; col++) {
      const src = (((col + Math.round(shift)) % len) + len) % len;
      const c1 = MOUNTAIN_TOP[src];
      const c2 = MOUNTAIN_BOT[src];
      if (c1 && c1 !== ' ') putChar(col, rowTop, c1, topCol);
      if (c2 && c2 !== ' ') putChar(col, rowBot, c2, botCol);
    }
  }
  function drawFarTreesAt(row, factor, color) {
    const shift = (player.x - 96) * factor;
    const len = FAR_TREES.length;
    for (let col = 0; col < COLS; col++) {
      const src = (((col + Math.round(shift)) % len) + len) % len;
      const ch = FAR_TREES[src];
      if (ch && ch !== ' ') putChar(col, row, ch, color);
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
      // Forest now has 4 tiers; ornament wallpaper between each pair.
      const fy = FLOORS.map(f => f.y);
      for (let i = 0; i < fy.length - 1; i++) {
        const yStart = fy[i] + 2;
        const yEnd   = fy[i + 1] - 1;
        if (yEnd <= yStart) continue;
        drawOrnamentLayer(ORN_FAR,  yStart, yEnd, 0.03, '#171a2e');
        drawOrnamentLayer(ORN_MID,  yStart, yEnd, 0.10, '#1d2742');
        drawOrnamentLayer(ORN_VINE, yStart, yEnd, 0.16, '#22324a');
        drawOrnamentLayer(ORN_NEAR, yStart, yEnd, 0.22, '#2a2240');
      }
      drawOrnamentLayer(ORN_MID,  fy[fy.length - 1] + 2, ROWS - 1, 0.10, '#1a1722');
    } else if (screen === 1) {
      // River: faint ornament strip under the water for depth.
      const riverTop = (RIVER ? RIVER.top : 52) + 2;
      drawOrnamentLayer(ORN_FAR,  riverTop, ROWS - 1, 0.04, 'rgba(180,210,255,0.10)');
      drawOrnamentLayer(ORN_VINE, riverTop, ROWS - 1, 0.10, 'rgba(140,180,220,0.08)');
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
    } else if (screen === 4) {
      // Snow: crystalline parallax pattern between floors.
      const fy = FLOORS.map(f => f.y);
      for (let i = 0; i < fy.length - 1; i++) {
        const yStart = fy[i] + 2;
        const yEnd   = fy[i + 1] - 1;
        if (yEnd <= yStart) continue;
        drawOrnamentLayer(ORN_FAR,  yStart, yEnd, 0.03, 'rgba(180,200,230,0.18)');
        drawOrnamentLayer(ORN_MID,  yStart, yEnd, 0.10, 'rgba(150,180,210,0.12)');
        drawOrnamentLayer(ORN_VINE, yStart, yEnd, 0.16, 'rgba(120,160,200,0.08)');
      }
    } else if (screen === 6) {
      // Jungle: dense foliage parallax tier wallpaper.
      const fy = FLOORS.map(f => f.y);
      for (let i = 0; i < fy.length - 1; i++) {
        const yStart = fy[i] + 2;
        const yEnd   = fy[i + 1] - 1;
        if (yEnd <= yStart) continue;
        drawOrnamentLayer(ORN_FAR,  yStart, yEnd, 0.03, 'rgba(50,110,60,0.30)');
        drawOrnamentLayer(ORN_VINE, yStart, yEnd, 0.10, 'rgba(40, 90,50,0.22)');
        drawOrnamentLayer(ORN_MID,  yStart, yEnd, 0.18, 'rgba(20, 70,40,0.18)');
      }
    } else if (screen === 7) {
      // Volcano: jagged cracked-rock pattern in warm tones between floors.
      const fy = FLOORS.map(f => f.y);
      for (let i = 0; i < fy.length - 1; i++) {
        const yStart = fy[i] + 2;
        const yEnd   = fy[i + 1] - 1;
        if (yEnd <= yStart) continue;
        drawOrnamentLayer(ORN_FAR,  yStart, yEnd, 0.03, 'rgba(80, 30, 20,0.30)');
        drawOrnamentLayer(ORN_VINE, yStart, yEnd, 0.10, 'rgba(120,40, 10,0.20)');
        drawOrnamentLayer(ORN_MID,  yStart, yEnd, 0.18, 'rgba(180,80, 30,0.18)');
      }
    } else if (screen === 8) {
      // Heaven: pearly white-gold sparkle pattern fills the whole scene.
      drawOrnamentLayer(ORN_FAR,  0, ROWS - 1, 0.04, 'rgba(255,255,255,0.55)');
      drawOrnamentLayer(ORN_MID,  0, ROWS - 1, 0.10, 'rgba(255,235,180,0.40)');
      drawOrnamentLayer(ORN_VINE, 0, ROWS - 1, 0.18, 'rgba(255,255,255,0.25)');
    }
  }

  function drawScreenParallax(time) {
    // Per-screen back-to-front parallax layers — runs on every level.
    if (screen === 0) {
      drawMountains(8, 10, 0.07, '#2c3656', '#1d2540');
      drawFarTreesAt(11, 0.18, '#1f3b2c');
    } else if (screen === 1) {
      drawMountains(14, 16, 0.05, '#8b4f6a', '#5a2840');
      drawFarTreesAt(20, 0.14, '#2c1a30');
    } else if (screen === 2) {
      drawFarTreesAt(20, 0.05, 'rgba(255,255,255,0.18)');
      drawFarTreesAt(34, 0.12, 'rgba(255,255,255,0.12)');
    } else if (screen === 3) {
      drawMountains(2, 4, 0.04, '#2a2238', '#1a1422');
      drawFarTreesAt(58, 0.10, '#1a1018');
    } else if (screen === 4) {
      drawMountains(6, 8, 0.06, '#6a7a9a', '#4a5878');
      drawFarTreesAt(11, 0.15, '#3a4458');
    } else if (screen === 5) {
      // Space — only a faint mountain-shaped silhouette for very distant
      // asteroid belts.  Real backdrop is the nebula in drawSky().
      drawMountains(54, 56, 0.04, 'rgba(120, 90,180,0.18)', 'rgba(60, 40,120,0.18)');
      drawFarTreesAt(65, 0.10, 'rgba(80, 60,120,0.20)');
    } else if (screen === 6) {
      // Jungle — distant misty hill silhouettes + lush near treeline.
      drawMountains(6, 8, 0.05, '#2a4a30', '#163020');
      drawFarTreesAt(15, 0.15, '#0f3018');
    } else if (screen === 7) {
      // Volcano — distant volcano cones + a closer ridge.
      drawMountains(8, 10, 0.05, '#5a1a08', '#2a0a04');
      drawFarTreesAt(15, 0.14, '#1a0604');
    } else if (screen === 8) {
      // Heaven — faraway pearl cloud ridges + a closer pillar treeline.
      drawMountains(8, 10, 0.04, 'rgba(255,255,255,0.55)', 'rgba(220,235,255,0.40)');
      drawFarTreesAt(15, 0.10, 'rgba(255,235,180,0.40)');
    } else if (screen === 9) {
      // Matrix — the parallax IS the code rain.
      drawRain(time);
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

  function drawBirds(time) {
    const col = BIRD_PALETTE[screen] || '#444';
    for (const b of BIRDS) {
      const y = b.y + Math.sin(b.yPhase) * 0.6;
      const wing = (b.anim | 0) % 2;
      const px = Math.floor(b.x);
      const py = Math.floor(y);
      // Facing depends on direction of travel.
      let frame = BIRD_FRAMES[wing];
      if (b.vx < 0) {
        // Mirror so the bird "looks" the right way (visually symmetric anyway).
        frame = wing === 0 ? '\\V/' : '_v_';
      }
      if (b.size === 1) {
        // Small bird — just one char.
        putChar(px, py, wing === 0 ? 'v' : '^', col);
      } else {
        putString(px, py, frame, col);
      }
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
    } else if (e.type === 'ufo') {
      const a = (((time * 6) | 0) % 2) === 0;
      sprite = a ? UFO_A : UFO_B;
      colors = UFO_COLORS;
    } else if (e.type === 'snowman') {
      const a = ((e.walk | 0) % 2) === 0;
      sprite = a ? SNOWMAN_A : SNOWMAN_B;
      colors = SNOWMAN_COLORS;
    } else if (e.type === 'tiger') {
      const a = ((e.walk | 0) % 2) === 0;
      sprite = a ? TIGER_A : TIGER_B;
      if (e.facing === -1) sprite = mirror(sprite);
      colors = TIGER_COLORS;
    } else if (e.type === 'demon') {
      const a = (((time * 3) | 0) % 2) === 0;
      sprite = a ? DEMON_A : DEMON_B;
      colors = DEMON_COLORS;
    } else if (e.type === 'angel') {
      const a = (((e.wing || 0) | 0) % 2) === 0;
      sprite = a ? ANGEL_A : ANGEL_B;
      colors = ANGEL_COLORS;
    } else if (e.type === 'cherub') {
      const a = (((time * 5) | 0) % 2) === 0;
      sprite = a ? CHERUB_A : CHERUB_B;
      colors = CHERUB_COLORS;
    } else if (e.type === 'sentinel') {
      const a = (((time * 5) | 0) % 2) === 0;
      sprite = a ? SENTINEL_A : SENTINEL_B;
      colors = SENTINEL_COLORS;
    } else if (e.type === 'agent') {
      const a = ((e.walk | 0) % 2) === 0;
      sprite = a ? AGENT_A : AGENT_B;
      colors = AGENT_COLORS;
      // Mid-teleport: fade out / assemble in.
      if (e.teleportState === 'fading') {
        const fadeA = (e.teleportTimer / AGENT_FADE_TIME);
        ctx.globalAlpha = Math.max(0, fadeA);
      } else if (e.teleportState === 'assembling') {
        const asmA = 1 - (e.teleportTimer / AGENT_ASSEMBLE_TIME);
        ctx.globalAlpha = Math.max(0, asmA);
      } else if (e.teleportState === 'wind-up') {
        // Flickering warning
        if ((((time * 12) | 0) % 2) === 0) ctx.globalAlpha = 0.4;
      }
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
      if (f.theme === 'rope') continue; // rope drawn separately
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
      else if (theme === 'space')  { topColor = '#a8b6e0'; shadowColor = '#3a3858'; capColor = '#6a78a8'; }
      else if (theme === 'lava')   { topColor = '#3a1a10'; shadowColor = '#180806'; capColor = '#5a1a08'; }
      else if (theme === 'matrix') { topColor = '#60ff60'; shadowColor = '#0a3010'; capColor = '#207040'; }
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
        } else if (theme === 'space') {
          grain = ((x * 7 + i * 31) % 13) === 0 ? '╳' : ((x + i) % 3 === 0 ? '▰' : '━');
        } else if (theme === 'lava') {
          grain = ((x * 7 + i * 31) % 11) === 0 ? '╳' : ((x + i) % 3 === 0 ? '▓' : '━');
        } else if (theme === 'matrix') {
          grain = ((x * 7 + i * 31) % 7) === 0 ? '═' : '━';
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
        } else if (theme === 'space') {
          ch = ((x + i) % 5 === 0) ? '▒' : ((x + i) % 5 === 2 ? '░' : ' ');
        } else if (theme === 'lava') {
          ch = ((x + i) % 4 === 0) ? '▓' : ((x + i) % 4 === 2 ? '▒' : '░');
        } else if (theme === 'matrix') {
          ch = ((x + i) % 4 === 0) ? '░' : ' ';
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
      if (L.vine) {
        // Hanging liana — twisted rope with sparse leaf clusters.
        const sway = Math.round(Math.sin(windPhase + L.x * 0.4) * 0.5);
        for (let r = L.top; r < L.bottom; r++) {
          const wob = Math.round(Math.sin(windPhase * 1.2 + r * 0.3) * 0.6);
          const xL = L.x - 1 + wob;
          const xR = L.x + 1 + wob;
          putChar(xL, r, '╲', '#3a7a32');
          putChar(xR, r, '╱', '#3a7a32');
          if ((r - L.top) % 3 === 1) putChar(L.x + wob, r, '╳', '#5fa64a');
          else if ((r - L.top) % 5 === 2) putChar(L.x + wob, r, '♣', '#4ec46f');
        }
        // Anchor knot at the top
        putChar(L.x + sway, L.top, '◯', '#3a7a32');
        continue;
      }
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
  // 10 colour entries to match the taller pine sprite (7 canopy + 3 trunk).
  const TREE_SNOW_PINE_COLORS = [
    '#ffffff', '#eaf0f8', '#dbe6f0',
    '#eaf0f8', '#dbe6f0', '#9ec3ad', '#6f9d7e',
    '#7a4a22', '#7a4a22', '#5a3a18',
  ];

  function drawTree(t) {
    const isSnowPine = t.kind === 'snow-pine';
    const sprite = (t.kind === 'pine' || isSnowPine) ? TREE_PINE : TREE_ROUND;
    const colors = isSnowPine ? TREE_SNOW_PINE_COLORS
                              : (t.kind === 'pine' ? TREE_PINE_COLORS : TREE_ROUND_COLORS);
    const height = sprite.length;
    const y = FLOORS[t.floorIdx].y - height;
    // Wind sway — top of the canopy moves further than the bottom; trunk
    // stays put.  Layer-specific phase offset adds a "leafy shimmer" feel.
    const trunkRows = 3;
    const canopyH = height - trunkRows;
    const swayBase = Math.sin(windPhase + t.x * 0.35);
    for (let r = 0; r < height; r++) {
      const canopyDepth = canopyH - r;       // positive in canopy
      const dx = canopyDepth > 0
        ? Math.round((swayBase + Math.sin(windPhase * 1.4 + r * 0.5) * 0.3)
                     * (canopyDepth / canopyH) * 1.2)
        : 0;
      // Width of the sprite is sprite[r].length; centre it around t.x.
      const left = t.x - ((sprite[r].length - 1) >> 1);
      putString(left + dx, y + r, sprite[r], colors[r] || colors[colors.length - 1]);
    }
    // Snow cap on the snow-pine's tip.
    if (isSnowPine) putChar(t.x, y - 1, '·', '#ffffff');
    // Occasional birds perch in the canopy of larger trees.
    if (t.bird) {
      const lit = (((windPhase * 2 + t.x) | 0) % 4) === 0;
      putChar(t.x + 1, y + 1, lit ? 'v' : '^', '#ffd56b');
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

  function drawBombs(time) {
    for (const b of BOMB_BUTTONS) {
      const f = FLOORS[b.floorIdx];
      if (!f) continue;
      const y = f.y - 1;
      if (!b.used) {
        const near = player.floorIdx === b.floorIdx && Math.abs((player.x + 1) - b.x) < 5;
        const pulse = (((time * 3) | 0) % 2) === 0;
        putString(b.x - 1, y, '[!]', pulse ? '#ffd56b' : '#caa040');
        if (near) {
          const hint = 'E:BOMB';
          putString(Math.round(b.x - hint.length / 2), y - 2, hint, '#ffd56b');
        }
      } else if (b.armed > 0) {
        // Armed bomb — blink faster as the fuse runs down.
        const rate = 6 + (1.6 - b.armed) * 30;
        const lit = (((time * rate) | 0) % 2) === 0;
        putString(b.x - 1, y, '[!]', lit ? '#ff5070' : '#552040');
        putChar(b.x, y - 1, lit ? '●' : '○', lit ? '#ff5070' : '#3a2030');
      }
    }
  }
  function drawSpawnButtons(time) {
    for (const b of SPAWN_BUTTONS) {
      const f = FLOORS[b.floorIdx];
      if (!f) continue;
      const y = f.y - 1;
      const lit = !b.used && (((time * 3) | 0) % 2) === 0;
      putString(b.x - 1, y, '[?]', b.used ? '#3a4256' : (lit ? '#c060e0' : '#7a48a0'));
      if (!b.used) {
        const near = player.floorIdx === b.floorIdx && Math.abs((player.x + 1) - b.x) < 5;
        if (near) {
          const hint = 'E:SUMMON';
          putString(Math.round(b.x - hint.length / 2), y - 2, hint, '#c060e0');
        }
      }
    }
  }
  function drawDrops(time) {
    for (const d of DROPS) {
      const y = Math.round(d.y);
      const bob = ((time * 6) | 0) % 2 === 0 ? -1 : 0;
      putChar(d.x + 1, y + bob, '♥', '#ff5070');
    }
  }
  function drawRope(time) {
    if (!ROPE) return;
    for (let x = ROPE.left; x <= ROPE.right; x++) {
      const slack = Math.round(Math.sin((x - ROPE.left) * 0.15 + time * 1.4) * 0.4);
      putChar(x, ROPE.y + slack, x % 3 === 0 ? '═' : '─', '#caa070');
    }
    // Knots at the posts
    putChar(ROPE.left, ROPE.y, '╕', '#7a4a22');
    putChar(ROPE.right, ROPE.y, '╒', '#7a4a22');
  }
  function drawAutojumpHints(time) {
    for (const f of FLOORS) {
      if (!f.autojump) continue;
      // Bouncing arrow above the platform centre.
      const cx = (f.left + f.right) / 2 | 0;
      const bob = Math.sin(time * 4) * 0.6;
      putChar(cx,     f.y - 2 + Math.round(bob), '↑', '#ffd56b');
      putChar(cx - 1, f.y - 1, '∧', '#ffd56b');
      putChar(cx + 1, f.y - 1, '∧', '#ffd56b');
    }
  }

  function drawTeleports(time) {
    for (const t of TELEPORTS) {
      const yTop = t.y - 3;
      const swirl = ['◇','◈','◆','◈'][((time * 6) | 0) % 4];
      const colors = ['#7fc8ff','#c060e0','#ffd56b','#7fc8ff'];
      const col = colors[((time * 4) | 0) % 4];
      putString(t.x - 1, yTop,     '╔═╗', '#7fc8ff');
      putString(t.x - 1, yTop + 1, '║' + swirl + '║', col);
      putString(t.x - 1, yTop + 2, '╚═╝', '#7fc8ff');
      // Sparkles above
      if ((((time * 5) | 0) % 3) === 0) putChar(t.x + ((Math.random() * 3) | 0) - 1, yTop - 1, '·', '#c060e0');
    }
  }

  function drawBlackHole(time) {
    if (!BLACKHOLE) return;
    const cx = BLACKHOLE.x + BLACKHOLE.w / 2;
    const cy = BLACKHOLE.y + BLACKHOLE.h / 2;
    // Wide soft glow
    const gx = cx * CHAR_W, gy = cy * CHAR_H;
    const r1 = CHAR_W * 16;
    const halo = ctx.createRadialGradient(gx, gy, 0, gx, gy, r1);
    halo.addColorStop(0,   'rgba(180,100,220,0.55)');
    halo.addColorStop(0.4, 'rgba( 80, 40,160,0.35)');
    halo.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = halo;
    ctx.fillRect(gx - r1, gy - r1, r1 * 2, r1 * 2);
    // Black core
    const r2 = CHAR_W * 4;
    const core = ctx.createRadialGradient(gx, gy, 0, gx, gy, r2);
    core.addColorStop(0,   '#000000');
    core.addColorStop(0.7, '#0a0210');
    core.addColorStop(1,   'rgba(0,0,0,0)');
    ctx.fillStyle = core;
    ctx.fillRect(gx - r2, gy - r2, r2 * 2, r2 * 2);
    // Swirling accretion ring (rotating chars on a circle)
    const ringR = 5;
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + time * 1.5;
      const px = Math.round(cx + Math.cos(a) * ringR * 1.4);
      const py = Math.round(cy + Math.sin(a) * ringR * 0.9);
      const ch = ['·','*','✦','✧','+'][i % 5];
      const cc = i % 3 === 0 ? '#ffd56b' : (i % 3 === 1 ? '#c060e0' : '#7fc8ff');
      putChar(px, py, ch, cc);
    }
    // Centre eye
    putChar(Math.round(cx), Math.round(cy), '●', '#000');
    // Caption
    const caption = '◀ BLACK HOLE';
    putString(BLACKHOLE.x - 1, BLACKHOLE.y - 1, caption, '#c060e0');
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
      const tr = CHAR_W * 8;
      const grad = ctx.createRadialGradient(gx, gy, 0, gx, gy, tr);
      grad.addColorStop(0, 'rgba(255,160,60,0.20)');
      grad.addColorStop(1, 'rgba(255,160,60,0)');
      ctx.fillStyle = grad;
      ctx.fillRect(gx - tr, gy - tr, tr * 2, tr * 2);
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
      ctx.fillRect((px) * CHAR_W, (fy - 0.2) * CHAR_H, 3 * CHAR_W, Math.max(2, CHAR_H * 0.25));
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

    // Per-screen parallax horizon (mountains + far trees), runs on
    // every level with screen-specific palette/positions.
    drawScreenParallax(time);

    drawClouds();
    drawBirds(time);
    if (screen === 0) {
      drawBats();
      drawShootingStars();
    }

    // Screen 1 specific: river water
    if (screen === 1) drawRiver(time);

    // Cave decor (stalactites etc.) sits behind floors but in front of bg
    if (screen === 3) drawCaveDecor(time);
    if (screen === 9) drawGlitches(time);

    // Foreground world
    for (const t of TREES) drawTree(t);
    drawTreeLeaves();
    drawFloors();
    drawLadders();
    if (screen === 1) drawRope(time);
    for (const b of BUSHES) drawBush(b);
    for (const r of ROCKS) drawRock(r);

    if (screen === 1) drawBoat(time);

    if (screen === 0) drawFireflies(time);
    if (screen === 2) drawAutojumpHints(time);
    if (screen === 5) {
      drawBlackHole(time);
      drawTeleports(time);
    }

    drawChest();
    drawKey(time);
    drawPotion(time);
    drawFragment(time);
    drawSafe(time);
    drawBombs(time);
    drawSpawnButtons(time);
    drawDrops(time);

    // Enemies behind player so player passes in front during overlap.
    for (const e of enemies) drawEnemy(e, time);
    drawProjectiles(time);

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
    const labels = ['LV.1  NIGHT FOREST', 'LV.2  RIVER CROSSING', 'LV.3  SKY ISLANDS', 'LV.4  CAVE OF SECRETS', 'LV.5  SNOW BOSS', 'LV.6  DEEP SPACE', 'LV.7  JUNGLE', 'LV.8  VOLCANO LAIR', 'LV.9  HEAVENS', 'LV.10 THE MATRIX'];
    const label = labels[screen] || '';
    const col = COLS - label.length - 2;
    for (let i = 0; i < label.length; i++) putChar(col + i, 0, label[i], '#8aa0c0');
    // Build marker (lets you confirm cache-busting worked)
    const v = 'd0';
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
    tickMusic();
    draw(now / 1000);
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

})();
