// Monster Bash — voxel pinball.
//
// Top-down 2D physics on the XZ plane (y is "up off the table"); a tilted
// perspective camera turns it into a classic pinball-cabinet view. Gravity is a
// constant force toward +z (down the table, toward the flippers + drain).
// Tap the LEFT half of the screen → left flipper; RIGHT half → right flipper.
// Each ball auto-plunges up the right launch lane. Three balls per game.
//
// Three.js v0.160 ES module, single file. CDN importmap (see index.html).
// Reuses the shared low-poly library: lib/prims.js + builders/monsters.js.

import * as THREE from 'three';
import { P, M, box, cyl, cone } from './lib/prims.js';
import { MONSTERS } from './builders/monsters.js';
import { MECHS } from './builders/mechs.js';
import { VILLAINS } from './builders/villains.js';
import { MYTHIC } from './builders/mythic.js';
import { createAudio } from './lib/audio.js';

// whole creature roster, shared rig contract (userData.rig = {legL,legR,armL,armR})
const ROSTER = { ...MONSTERS, ...MECHS, ...VILLAINS, ...MYTHIC };

// ─── table layout constants (XZ plane, all tunable) ──────────────────────────
const HW       = 3.5;     // playfield half-width: x ∈ [-HW, HW]
const TOP      = -8.6;    // far end of the table
const BOTTOM   = 3.4;     // near end / drain plane
const BALL_R   = 0.34;    // ball Ø = 0.68 → EVERY channel the ball travels must be > 0.68
const LANE_X1  = HW + 0.9;    // launch lane = channel between HW and LANE_X1 (≈0.9 wide)
const LANE_CX  = (HW + LANE_X1) / 2;
const GRAV     = 13.0;    // table gravity (toward +z) — strong enough the ball flows down
const WALL_E   = 0.40;    // wall restitution
const FLIP_LEN = 1.6;
const FLIP_R   = 0.20;
const DRAIN_Z  = BOTTOM;  // past this z = ball lost

// per-creature personality: idle stance + how it reacts when bashed
const STYLE = {
  vampire:   { idle: 'menace',  hit: 'stagger' },
  werewolf:  { idle: 'breathe', hit: 'flail'   },
  zombie:    { idle: 'lurch',   hit: 'flail'   },
  skeleton:  { idle: 'sway',    hit: 'spin'    },
  mummy:     { idle: 'lurch',   hit: 'stagger' },
  ghost:     { idle: 'float',   hit: 'spin'    },
  combatMech:{ idle: 'breathe', hit: 'stagger' },
  swat:      { idle: 'breathe', hit: 'flail'   },
  viking:    { idle: 'sway',    hit: 'flail'   },
  minotaur:  { idle: 'menace',  hit: 'stagger' },
};

// LEVELS — fixed bottom (flippers/lanes/drain) is shared; each level swaps the
// UPPER playfield: monster cast + formation + pop-bumper layout + palette.
// `m(key,x,z,face,hp,scale?)` builds a monster spec. Positions use z relative to TOP.
const m = (key, x, z, face = 0, hp = 2, scale = 0.62) => ({ key, x, z, face, hp, scale });
const LEVELS = [
  { name: 'Crypt', pal: { fog: 0x140a26, hemiSky: 0x9a7bd6, hemiGround: 0x241433, key: 0xfff0d8, floor: 0x231244, inlay: 0x5a2fae },
    cast: [ m('vampire', -2.2, 1.6, 0.5), m('werewolf', 0, 1.4, 0), m('zombie', 2.2, 1.6, -0.5), m('skeleton', -1.7, 6.2, 0.8), m('skeleton', 1.7, 6.2, -0.8) ],
    pops: [ [-1.3, 3.6, 0x2fd0ff], [1.3, 3.6, 0xffd23f], [0, 5.2, 0x8bff5a] ] },
  { name: 'Catacomb', pal: { fog: 0x0a1f1a, hemiSky: 0x6fd0c0, hemiGround: 0x10302a, key: 0xe8fff4, floor: 0x123830, inlay: 0x2fae8b },
    cast: [ m('mummy', 0, 1.2, 0), m('ghost', -2.3, 3.4, 0.5), m('mummy', 2.3, 3.4, -0.5), m('skeleton', 0, 5.8, 0) ],
    pops: [ [-1.5, 4.4, 0x9bff5a], [1.5, 4.4, 0x2fd0ff], [0, 2.9, 0xffd23f] ] },
  { name: 'Blood Moon', pal: { fog: 0x2a0a0e, hemiSky: 0xd68a7b, hemiGround: 0x33130f, key: 0xffe0d0, floor: 0x3a1418, inlay: 0xc24b3b },
    cast: [ m('werewolf', -1.5, 1.6, 0.3), m('werewolf', 1.5, 1.6, -0.3), m('vampire', 0, 2.9, 0), m('zombie', -2.4, 4.2, 0.6), m('zombie', 2.4, 4.2, -0.6) ],
    pops: [ [-1.6, 5.8, 0xffd23f], [0, 6.2, 0xff5a8a], [1.6, 5.8, 0x2fd0ff] ] },
  { name: 'Machine', pal: { fog: 0x0a1428, hemiSky: 0x7bb0e0, hemiGround: 0x14243a, key: 0xe0f0ff, floor: 0x142844, inlay: 0x2f6eae },
    cast: [ m('combatMech', -2.0, 1.6, 0.4, 3), m('combatMech', 0, 1.4, 0, 3), m('combatMech', 2.0, 1.6, -0.4, 3), m('skeleton', -1.6, 6.0, 0.8), m('skeleton', 1.6, 6.0, -0.8) ],
    pops: [ [-1.3, 3.8, 0x2fd0ff], [1.3, 3.8, 0x8bff5a], [0, 5.4, 0xffd23f] ] },
  { name: 'Raid', pal: { fog: 0x281a0a, hemiSky: 0xe0b87b, hemiGround: 0x33260f, key: 0xfff0d0, floor: 0x3a2e14, inlay: 0xffa320 },
    cast: [ m('swat', -2.2, 2.0, 0.5, 3), m('viking', 2.2, 2.0, -0.5, 3), m('minotaur', 0, 1.3, 0, 6, 0.86) ],
    pops: [ [-1.5, 4.6, 0xff5a8a], [1.5, 4.6, 0x2fd0ff], [0, 6.0, 0xffd23f] ] },
];

export function startGame({ canvas, hud }) {
  // ── renderer ───────────────────────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.setClearColor(0x140a26);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x140a26, 16, 44);

  // ── camera — front-above, table recedes upward (portrait cabinet view) ──────
  const camera = new THREE.PerspectiveCamera(52, 1, 0.1, 120);
  function placeCamera() {
    const portrait = (canvas.clientHeight || 1) >= (canvas.clientWidth || 1);
    // pull back + flatten a touch on wide screens so the whole table stays framed
    camera.position.set(0, portrait ? 9.4 : 11.0, BOTTOM + (portrait ? 5.2 : 7.0));
    camera.lookAt(0, -0.4, (TOP + BOTTOM) / 2 - 0.6);
  }
  placeCamera();

  // ── lighting — moody purple ambient + warm key + cool rim ───────────────────
  const hemi = new THREE.HemisphereLight(0x9a7bd6, 0x241433, 0.85);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xfff0d8, 1.15);
  key.position.set(-6, 16, BOTTOM + 2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.near = 2; key.shadow.camera.far = 40;
  key.shadow.camera.left = -7; key.shadow.camera.right = 7;
  key.shadow.camera.top = 12; key.shadow.camera.bottom = -12;
  key.shadow.bias = -0.0005;
  key.shadow.radius = 4;
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6be0ff, 0.4);
  rim.position.set(7, 6, TOP);
  scene.add(rim);

  // ── table root (everything sits in XZ, y up) ────────────────────────────────
  const table = new THREE.Group();
  scene.add(table);

  // playfield floor — slab spanning field + launch lane (own material → recolour per level)
  const floor = box((LANE_X1 + HW) + 0.4, 0.5, BOTTOM - TOP + 0.4, 0x231244,
    (LANE_X1 - HW) / 2, -0.25, (TOP + BOTTOM) / 2);
  floor.material = new THREE.MeshStandardMaterial({ color: 0x231244, roughness: 0.92, metalness: 0, flatShading: true });
  floor.receiveShadow = true;
  table.add(floor);
  // glowing center inlay (own material → recolour per level)
  const inlay = box(HW * 1.4, 0.02, (BOTTOM - TOP) * 0.62, 0x3a1f6e,
    0, 0.02, (TOP + BOTTOM) / 2 - 0.4);
  inlay.material = new THREE.MeshStandardMaterial({ color: 0x3a1f6e, roughness: 0.9, metalness: 0, flatShading: true, emissive: new THREE.Color(0x5a2fae), emissiveIntensity: 0.35 });
  table.add(inlay);

  // ── collision data ───────────────────────────────────────────────────────
  const segs   = [];   // walls: {ax,az,bx,bz,e,kick,score,flash}
  const circles = [];  // {x,z,r,e,kick,score,mesh,kind,light}
  const flippers = []; // {side,px,pz,len,r,ang,target,rest,active,omega,group}

  // build a visual rail box along a segment + register collision
  function wall(ax, az, bx, bz, opt = {}) {
    const e = opt.e ?? WALL_E;
    segs.push({ ax, az, bx, bz, e, kick: opt.kick || 0, score: opt.score || 0, flash: opt.flash || null });
    if (opt.invisible) return;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    const h = opt.h ?? 0.62;
    const w = opt.w ?? 0.22;
    const m = box(len, h, w, opt.color ?? 0x6a3fb0, 0, 0, 0,
      opt.glow ? { e: opt.glow, ei: 0.5 } : undefined);
    const g = new THREE.Group();
    g.position.set((ax + bx) / 2, h / 2, (az + bz) / 2);
    g.rotation.y = -Math.atan2(dz, dx);
    g.add(m);
    table.add(g);
    return g;
  }

  // ── bottom-region geometry anchors (real "Italian bottom", scaled) ────────
  // Order each side, centre→edge:  DRAIN | FLIPPER | INLANE | SLINGSHOT | OUTLANE | WALL
  // Every channel the ball travels is ≥ ~0.8 (> ball Ø 0.68) so it can pass through.
  // pivots wide enough that the centre gap CLEAR of flipper thickness still
  // passes the ball: tip gap ≈1.4, minus 2×FLIP_R(0.4) = 1.0 clear > ball Ø 0.68
  const PIVOT_X    = 2.1;    // flipper pivot x (±)
  const PIVOT_Z    = 2.2;    // flipper pivot z (flippers low, near the drain)
  const OUTLANE_IN = 2.7;    // inner wall of the outlane channel (outer wall = HW)
  const DIVIDER_TOP_Z = TOP + 2.9;   // launch-lane divider stops here so the served ball spills in
  const SPLIT_Z    = 1.25;   // the lane-divider "post" where inlane & outlane fork
  const DROP_Z     = 3.0;    // outlane/flipper walls stop here; below = open drain

  // ── top + side outer walls ────────────────────────────────────────────────
  wall(-HW, TOP + 1.1, -HW + 1.1, TOP);                 // top-left chamfer
  wall(-HW + 1.1, TOP, LANE_X1, TOP);                   // top span (covers field + lane)
  // LEFT outer wall (also the left outlane's outer wall) down to the drop
  wall(-HW, TOP + 1.1, -HW, DROP_Z);
  // RIGHT: launch-lane outer wall + divider (divider also = right outlane outer wall)
  wall(LANE_X1, TOP, LANE_X1, BOTTOM - 0.4);            // lane outer wall
  wall(HW, DIVIDER_TOP_Z, HW, DROP_Z);                  // divider / right outlane outer

  // ── per-side bottom: outlane channel + slingshot(=inlane outer wall) ───────
  // The slingshot is the angled wall that BOTH bounds the inlane (inner side,
  // feeds the flipper) AND kicks the ball; the outlane is the channel outside it.
  function bottomSide(side) {
    const s = side;
    // outlane inner wall (channel = [s*HW .. s*OUTLANE_IN], ~0.85 wide, drains below DROP_Z)
    wall(s * OUTLANE_IN, SPLIT_Z, s * OUTLANE_IN, DROP_Z, { glow: 0x3a1f6e });
    // slingshot / inlane-outer wall: from the fork post down-inward to the flipper,
    // kicks the ball up-and-toward-centre when struck
    const ax = s * OUTLANE_IN, az = SPLIT_Z;            // fork post (top, shared with outlane)
    const bx = s * 2.25,       bz = PIVOT_Z;            // just outboard of the flipper pivot
    wall(ax, az, bx, bz, { e: 0.5, kick: 4.0, score: 50, color: 0x8b2fc0, glow: 0xc24be8, h: 0.66 });
    segs[segs.length - 1].sling = { light: makeSlingLight((ax + bx) / 2, (az + bz) / 2) };
  }
  function makeSlingLight(x, z) {
    const l = new THREE.PointLight(0xff4bd0, 0, 4, 2);
    l.position.set(x, 1.0, z); table.add(l); return l;
  }
  bottomSide(-1);
  bottomSide(1);

  // ── per-level playfield content (pop bumpers + monsters) ──────────────────
  // circles holds ONLY per-level content (pops + monsters); the bottom kickers
  // are walls (segs). So a level swap = clear circles + their meshes, rebuild.
  const levelMeshes = [];   // meshes to dispose on level change

  function spawnPop(x, z, color) {
    const r = 0.62;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.add(cyl(r, r + 0.06, 0.18, 16, 0x1a0e36, 0, 0.09, 0));
    const cap = cyl(r - 0.12, r - 0.02, 0.42, 16, color, 0, 0.4, 0, { e: color, ei: 0.55 });
    g.add(cap);
    g.add(cyl(0.14, 0.14, 0.18, 10, 0xfff6cf, 0, 0.66, 0, { e: 0xfff6cf, ei: 0.9 }));
    table.add(g);
    const light = new THREE.PointLight(color, 0.5, 5, 2);
    light.position.set(x, 1.4, z); table.add(light);
    levelMeshes.push(g, light);
    circles.push({ x, z, r, e: 0.5, kick: 5.0, score: 100, mesh: g, cap, light, kind: 'pop', punch: 0 });
  }

  function spawnMonster(spec) {
    const fig = ROSTER[spec.key]();
    const SCALE = spec.scale || 0.62;
    fig.scale.setScalar(SCALE);
    fig.position.set(spec.x, 0, spec.z);
    fig.rotation.y = spec.face || 0;
    table.add(fig);
    const post = cyl(0.6 * (SCALE / 0.62), 0.7 * (SCALE / 0.62), 0.16, 14, 0x40206e, spec.x, 0.08, spec.z, { e: 0x6a2fae, ei: 0.4 });
    table.add(post);
    const light = new THREE.PointLight(0xff5a8a, 0, 4, 2);
    light.position.set(spec.x, 1.6, spec.z); table.add(light);
    levelMeshes.push(fig, post, light);
    const st = STYLE[spec.key] || { idle: 'breathe', hit: 'flail' };
    circles.push({
      x: spec.x, z: spec.z, r: 0.62 * (SCALE / 0.62) + 0.05, e: 0.28, kick: 0,
      score: 250, mesh: fig, post, light, kind: 'monster', punch: 0, cool: 0,
      base: SCALE, face: spec.face || 0, rig: fig.userData.rig || null, armBase: fig.userData.armBase || 0,
      hp: spec.hp, maxhp: spec.hp, alive: true, defeatT: 0,
      idle: st.idle, hitStyle: st.hit, ph: Math.random() * 6.28, spd: 0.85 + Math.random() * 0.5,
    });
  }

  function applyPalette(p) {
    scene.fog.color.setHex(p.fog);
    renderer.setClearColor(p.fog);
    hemi.color.setHex(p.hemiSky); hemi.groundColor.setHex(p.hemiGround);
    key.color.setHex(p.key);
    floor.material.color.setHex(p.floor);
    inlay.material.color.setHex(p.inlay); inlay.material.emissive.setHex(p.inlay);
  }

  // build / rebuild the upper playfield for a level index
  function buildLevel(i) {
    // tear down previous content
    for (const mesh of levelMeshes) table.remove(mesh);
    levelMeshes.length = 0;
    for (let k = circles.length - 1; k >= 0; k--) circles.splice(k, 1);
    const L = LEVELS[i % LEVELS.length];
    applyPalette(L.pal);
    for (const [x, z, c] of L.pops) spawnPop(x, TOP + z, c);
    for (const sp of L.cast) spawnMonster({ ...sp, z: TOP + sp.z });
    hud.setLevel && hud.setLevel(i + 1, L.name);
  }

  // ── flippers ────────────────────────────────────────────────────────────
  function makeFlipper(side) {
    const s = side;
    const px = s * PIVOT_X, pz = PIVOT_Z;
    // rest: tip points inward + gently down (leaves a ~1.1 centre gap); active: swings up
    const rest   = s < 0 ? 0.50 : (Math.PI - 0.50);   // ~29° below horizontal, tips toward drain
    const active = s < 0 ? -0.50 : (Math.PI + 0.50);  // strong upward flip
    const group = new THREE.Group();
    group.position.set(px, 0.34, pz);
    const bar = box(FLIP_LEN, 0.34, FLIP_R * 2, 0xffd23f, FLIP_LEN / 2 - 0.1, 0, 0, { e: 0xffa320, ei: 0.25 });
    group.add(bar);
    group.add(cyl(0.26, 0.26, 0.4, 12, 0xe04898, 0, 0, 0));   // pivot knuckle
    table.add(group);
    const f = { side: s, px, pz, len: FLIP_LEN, r: FLIP_R, ang: rest, target: rest, rest, active, omega: 0, group, held: false };
    flippers.push(f);
    return f;
  }
  const flipL = makeFlipper(-1);
  const flipR = makeFlipper(1);

  // ── ball ─────────────────────────────────────────────────────────────────
  const ballMeshGeo = new THREE.IcosahedronGeometry(BALL_R, 1);
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0xdfe6ee, roughness: 0.25, metalness: 0.8, flatShading: true,
    emissive: 0x223044, emissiveIntensity: 0.3,
  });
  const ballMesh = new THREE.Mesh(ballMeshGeo, ballMat);
  ballMesh.castShadow = true;
  ballMesh.position.y = BALL_R;
  table.add(ballMesh);
  const ballLight = new THREE.PointLight(0xbfe6ff, 0.7, 5, 2);
  table.add(ballLight);

  const ball = { x: LANE_CX, z: BOTTOM - 0.6, vx: 0, vz: 0, live: false, gated: false };
  const LANE_EXIT_Z = TOP + 2.6;   // plunged ball clears the lane top here → inject into field

  // ── procedural Web Audio (primed on first user gesture) ─────────────────────
  const audio = createAudio();

  // ── game state ────────────────────────────────────────────────────────────
  const BEST_KEY = 'monsterBash.best';
  const state = {
    mode: 'preroll',     // preroll | play | dead
    score: 0,
    best: Number(localStorage.getItem(BEST_KEY) || 0),
    balls: 3,
    mult: 1,
    comboT: 0,
    launchT: 0,          // countdown before auto-plunge
    level: 0,            // current level index
    clearT: 0,           // brief pause/banner when a level is cleared
  };
  hud.setBest && hud.setBest(state.best);
  hud.setPhase('preroll');

  function resetBall() {
    // ball waits in the launch lane (right channel), then auto-plunges up
    ball.x = LANE_CX; ball.z = BOTTOM - 0.6;
    ball.vx = 0; ball.vz = 0; ball.live = false; ball.gated = false;
    state.launchT = 0.7;
  }
  function plunge() {
    ball.live = true;
    ball.vx = (Math.random() - 0.5) * 0.3;
    ball.vz = -25;         // rocket up the launch lane
    audio.launch();
  }

  function startGameRun() {
    state.mode = 'play';
    state.score = 0; state.balls = 3; state.mult = 1; state.comboT = 0;
    state.level = 0; state.clearT = 0;
    hud.setScore(0); hud.setBalls(3); hud.setMult(1);
    hud.setPhase('play');
    audio.prime(); audio.hum(true);
    buildLevel(0);
    resetBall();
  }

  // all monsters in the current level defeated → clear, bonus, next level
  function checkLevelClear() {
    const alive = circles.some(c => c.kind === 'monster' && c.alive);
    if (alive) return;
    const bonus = 2000 * (state.level + 1);
    addScore(bonus);
    flashMsg('LEVEL CLEAR  +' + bonus);
    audio.over && audio.pop();
    state.level++;
    state.clearT = 1.4;
    buildLevel(state.level);
  }

  function defeatMonster(c) {
    c.alive = false;
    c.defeatT = 1;                     // drives the topple-and-sink animation
    addScore(c.score * 2);             // defeat bonus
    if (c.light) c.light.intensity = 4;
    audio.monster();
  }

  function loseBall() {
    ball.live = false;
    audio.drain();
    state.balls--;
    state.mult = 1; hud.setMult(1);
    hud.setBalls(Math.max(0, state.balls));
    if (state.balls <= 0) {
      gameOver();
    } else {
      flashMsg('BALL LOST');
      resetBall();
    }
  }

  function gameOver() {
    state.mode = 'dead';
    audio.over(); audio.hum(false);
    if (state.score > state.best) {
      state.best = state.score;
      localStorage.setItem(BEST_KEY, String(state.best));
    }
    hud.setDeath({ score: state.score, best: state.best });
  }

  function addScore(n) {
    state.score += n * state.mult;
    hud.setScore(state.score);
  }
  function bump() {
    state.comboT = 2.4;
    if (state.mult < 8) { state.mult++; hud.setMult(state.mult); }
  }

  function flashMsg(t) { hud.setMsg && hud.setMsg(t); }

  // ── reset() exposed for the "play again" button ────────────────────────────
  function reset() {
    if (state.mode === 'dead' || state.mode === 'preroll') startGameRun();
  }

  // ── input — left/right screen halves drive the flippers ─────────────────────
  const activePointers = new Map();  // pointerId -> side
  function pressSide(side) {
    audio.prime();
    if (state.mode === 'preroll') startGameRun();
    const f = side < 0 ? flipL : flipR;
    if (!f.held) audio.flip();
    f.held = true; f.target = f.active;
  }
  function releaseSide(side) {
    const f = side < 0 ? flipL : flipR;
    f.held = false; f.target = f.rest;
  }
  canvas.addEventListener('pointerdown', (e) => {
    const side = (e.clientX < (canvas.clientWidth || window.innerWidth) / 2) ? -1 : 1;
    activePointers.set(e.pointerId, side);
    pressSide(side);
  }, { passive: true });
  canvas.addEventListener('pointerup', (e) => {
    const side = activePointers.get(e.pointerId);
    if (side !== undefined) { activePointers.delete(e.pointerId); if (![...activePointers.values()].includes(side)) releaseSide(side); }
  }, { passive: true });
  canvas.addEventListener('pointercancel', (e) => {
    const side = activePointers.get(e.pointerId);
    if (side !== undefined) { activePointers.delete(e.pointerId); if (![...activePointers.values()].includes(side)) releaseSide(side); }
  }, { passive: true });
  // keyboard for desktop testing
  window.addEventListener('keydown', (e) => {
    if (e.repeat) return;
    if (e.key === 'ArrowLeft') pressSide(-1);
    else if (e.key === 'ArrowRight') pressSide(1);
  });
  window.addEventListener('keyup', (e) => {
    if (e.key === 'ArrowLeft') releaseSide(-1);
    else if (e.key === 'ArrowRight') releaseSide(1);
  });

  // ── collision helpers ──────────────────────────────────────────────────────
  function collideSeg(s) {
    const abx = s.bx - s.ax, abz = s.bz - s.az;
    const L2 = abx * abx + abz * abz || 1e-6;
    let t = ((ball.x - s.ax) * abx + (ball.z - s.az) * abz) / L2;
    t = Math.max(0, Math.min(1, t));
    const cx = s.ax + abx * t, cz = s.az + abz * t;
    const dx = ball.x - cx, dz = ball.z - cz;
    const d2 = dx * dx + dz * dz;
    if (d2 >= BALL_R * BALL_R) return;
    const d = Math.sqrt(d2) || 1e-6;
    const nx = dx / d, nz = dz / d;
    ball.x += nx * (BALL_R - d); ball.z += nz * (BALL_R - d);
    const vn = ball.vx * nx + ball.vz * nz;
    if (vn < 0) { ball.vx -= (1 + s.e) * vn * nx; ball.vz -= (1 + s.e) * vn * nz; }
    if (s.kick) { ball.vx += nx * s.kick; ball.vz += nz * s.kick; }
    if (s.score) { addScore(s.score); bump(); audio.sling(); if (s.sling) { s.sling.t = 0.18; s.sling.light.intensity = 3; } }
  }
  function collideCircle(c) {
    if (c.kind === 'monster' && !c.alive) return;   // defeated → ball passes through
    const dx = ball.x - c.x, dz = ball.z - c.z;
    const d2 = dx * dx + dz * dz; const R = BALL_R + c.r;
    if (d2 >= R * R) return;
    const d = Math.sqrt(d2) || 1e-6;
    const nx = dx / d, nz = dz / d;
    ball.x += nx * (R - d); ball.z += nz * (R - d);
    const vn = ball.vx * nx + ball.vz * nz;
    if (vn < 0) { ball.vx -= (1 + c.e) * vn * nx; ball.vz -= (1 + c.e) * vn * nz; }
    if (c.kick) { ball.vx += nx * c.kick; ball.vz += nz * c.kick; }
    // monsters DON'T kick (ball flows past); they take HP and get defeated.
    // A cooldown stops a resting ball from chipping HP every frame.
    if (c.kind === 'monster') {
      if (c.cool > 0) return;
      c.cool = 0.4;
      c.hp--;
      c.punch = 1;                       // triggers the hit reaction
      bump(); addScore(c.score);
      if (c.light) c.light.intensity = 3.2;
      audio.monster();
      if (c.hp <= 0) { defeatMonster(c); checkLevelClear(); }
      return;
    }
    addScore(c.score); bump();
    c.punch = 1;
    if (c.light) c.light.intensity = 3.2;
    if (c.kind === 'sling') audio.sling(); else audio.pop();
  }
  function collideFlipper(f) {
    const ax = f.px, az = f.pz;
    const bx = f.px + Math.cos(f.ang) * f.len, bz = f.pz + Math.sin(f.ang) * f.len;
    const abx = bx - ax, abz = bz - az; const L2 = abx * abx + abz * abz || 1e-6;
    let t = ((ball.x - ax) * abx + (ball.z - az) * abz) / L2;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + abx * t, cz = az + abz * t;
    const dx = ball.x - cx, dz = ball.z - cz;
    const d2 = dx * dx + dz * dz; const R = BALL_R + f.r;
    if (d2 >= R * R) return;
    const d = Math.sqrt(d2) || 1e-6;
    const nx = dx / d, nz = dz / d;
    ball.x += nx * (R - d); ball.z += nz * (R - d);
    // surface velocity from rotation: v = omega × r (2D), r = contact - pivot
    const rx = cx - ax, rz = cz - az;
    const svx = -f.omega * rz, svz = f.omega * rx;
    let rvx = ball.vx - svx, rvz = ball.vz - svz;
    const vn = rvx * nx + rvz * nz;
    if (vn < 0) { rvx -= 1.35 * vn * nx; rvz -= 1.35 * vn * nz; }
    ball.vx = rvx + svx; ball.vz = rvz + svz;
    if (Math.abs(f.omega) > 3.5) { ball.vx += nx * 1.6; ball.vz += nz * 1.6; }
  }

  // ── physics step (fixed substeps for stable fast-ball collisions) ───────────
  const SUB = 1 / 240;
  let acc = 0;
  function physics(dt) {
    acc += dt;
    let steps = 0;
    while (acc >= SUB && steps < 12) {
      acc -= SUB; steps++;
      // flipper integration
      for (const f of flippers) {
        const prev = f.ang;
        const speed = f.held ? 26 : 16;     // up fast, return a touch slower
        const diff = f.target - f.ang;
        const step = Math.sign(diff) * Math.min(Math.abs(diff), speed * SUB);
        f.ang += step;
        f.omega = (f.ang - prev) / SUB;
      }
      if (!ball.live) continue;
      // rolling friction — bleeds energy so the ball escapes bumper clusters and
      // trickles down to drain instead of pinballing forever (sim has no real
      // friction). Flips/bumpers re-energise it, so saves still feel snappy.
      ball.vx *= 0.9982; ball.vz *= 0.9982;
      // gravity
      ball.vz += GRAV * SUB;
      // integrate
      ball.x += ball.vx * SUB; ball.z += ball.vz * SUB;
      // clamp absurd speeds
      const sp = Math.hypot(ball.vx, ball.vz);
      if (sp > 34) { const k = 34 / sp; ball.vx *= k; ball.vz *= k; }
      // collisions
      for (const s of segs) collideSeg(s);
      for (const c of circles) collideCircle(c);
      collideFlipper(flipL); collideFlipper(flipR);
      // launch-lane exit: the moment the plunged ball clears the lane top, inject
      // it into the playfield near the top so it falls back DOWN through the
      // bumpers/monsters to the flippers (proper pinball flow). Fires once/ball.
      if (!ball.gated && ball.x > HW && ball.z < LANE_EXIT_Z) {
        ball.gated = true;
        ball.x = HW - 0.8;                  // top-right of the play area
        ball.vx = -2 - Math.random() * 2;   // drift in toward the field
        ball.vz = 4;                         // start descending
      }
      // drain
      if (ball.z > DRAIN_Z) loseBall();
    }
  }

  // ── resize ─────────────────────────────────────────────────────────────────
  function onResize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    placeCamera();
  }
  window.addEventListener('resize', onResize);
  onResize();

  // ── render-side animation + main loop ───────────────────────────────────────
  const clock = new THREE.Clock();
  let t = 0;
  function loop() {
    const dt = Math.min(0.05, clock.getDelta());
    t += dt;

    // auto-plunge countdown between balls
    if (state.mode === 'play' && !ball.live) {
      if (state.launchT > 0) { state.launchT -= dt; if (state.launchT <= 0) plunge(); }
    }

    physics(dt);

    // combo decay
    if (state.comboT > 0) { state.comboT -= dt; if (state.comboT <= 0 && state.mult > 1) { state.mult = 1; hud.setMult(1); } }

    // ball mesh follow + spin + light
    ballMesh.position.set(ball.x, BALL_R, ball.z);
    ballMesh.rotation.x += ball.vz * dt * 1.4;
    ballMesh.rotation.z -= ball.vx * dt * 1.4;
    ballLight.position.set(ball.x, BALL_R + 0.6, ball.z);
    ballLight.intensity = ball.live ? 0.8 : 0.0;

    // flipper visuals
    for (const f of flippers) f.group.rotation.y = -f.ang;

    // bumper / monster animation — state machine: defeat > hit(style) > idle
    for (const c of circles) {
      if (c.cool > 0) c.cool -= dt;
      if (c.kind === 'pop') {
        if (c.punch > 0) { c.punch = Math.max(0, c.punch - dt * 5); c.mesh.scale.setScalar(1 + c.punch * 0.18); }
        if (c.light) c.light.intensity = Math.max(0.5, c.light.intensity - dt * 7);
        continue;
      }
      const rig = c.rig;
      if (!c.alive) {
        // DEFEAT — topple onto its back, sink into the floor, shrink away
        if (c.defeatT > 0) {
          c.defeatT = Math.max(0, c.defeatT - dt * 1.3);
          const d = 1 - c.defeatT;
          c.mesh.rotation.set(-d * 1.5, c.face + d * 0.8, 0);
          c.mesh.position.y = -d * 0.9;
          c.mesh.scale.setScalar(Math.max(0.001, c.base * (1 - d * 0.5)));
          if (c.defeatT <= 0) { c.mesh.visible = false; if (c.post) c.post.visible = false; }
        }
        if (c.light) c.light.intensity = Math.max(0, c.light.intensity - dt * 4);
        continue;
      }
      if (c.punch > 0) {
        // HIT — varied reaction
        c.punch = Math.max(0, c.punch - dt * 3.2);
        const p = c.punch, w = Math.sin(p * 30);
        c.mesh.scale.setScalar(c.base);
        c.mesh.position.y = Math.sin(p * Math.PI) * 0.15;
        if (c.hitStyle === 'stagger') {
          c.mesh.rotation.set(-0.55 * p, c.face, 0);
          if (rig) { rig.armL.rotation.set(c.armBase - 1.8 * p, 0, 0.6 * p); rig.armR.rotation.set(c.armBase - 1.8 * p, 0, -0.6 * p); rig.legL.rotation.set(0.5 * p, 0, 0); rig.legR.rotation.set(0.3 * p, 0, 0); }
        } else if (c.hitStyle === 'spin') {
          c.mesh.rotation.set(0, c.face + p * 6.0, 0);
          if (rig) { rig.armL.rotation.set(c.armBase, 0, 1.2 * p); rig.armR.rotation.set(c.armBase, 0, -1.2 * p); rig.legL.rotation.set(0, 0, 0); rig.legR.rotation.set(0, 0, 0); }
        } else if (c.hitStyle === 'jump') {
          c.mesh.rotation.set(0, c.face, 0);
          c.mesh.position.y = Math.sin(p * Math.PI) * 0.5;
          if (rig) { rig.armL.rotation.set(c.armBase - 1.5 * p, 0, 0); rig.armR.rotation.set(c.armBase - 1.5 * p, 0, 0); rig.legL.rotation.set(-0.8 * p, 0, 0); rig.legR.rotation.set(-0.8 * p, 0, 0); }
        } else { // flail
          c.mesh.rotation.set(0, c.face, w * 0.12 * p);
          if (rig) { rig.armL.rotation.set(c.armBase - 2.3 * p + w * 0.6 * p, 0, 1.3 * p); rig.armR.rotation.set(c.armBase - 2.3 * p - w * 0.6 * p, 0, -1.3 * p); rig.legL.rotation.set(w * 0.9 * p, 0, 0); rig.legR.rotation.set(-w * 0.9 * p, 0, 0); }
        }
      } else {
        // IDLE — alive + varied per creature, so nobody stands frozen
        const ph = t * c.spd + c.ph;
        c.mesh.rotation.set(0, c.face, 0); c.mesh.position.y = 0; c.mesh.scale.setScalar(c.base);
        if (rig) { rig.armL.rotation.set(c.armBase, 0, 0); rig.armR.rotation.set(c.armBase, 0, 0); rig.legL.rotation.set(0, 0, 0); rig.legR.rotation.set(0, 0, 0); }
        if (c.idle === 'breathe') {
          c.mesh.position.y = Math.sin(ph * 1.6) * 0.04;
          if (rig) { const a = Math.sin(ph * 1.6) * 0.12; rig.armL.rotation.z = a; rig.armR.rotation.z = -a; }
        } else if (c.idle === 'sway') {
          c.mesh.rotation.z = Math.sin(ph * 1.3) * 0.09;
        } else if (c.idle === 'lurch') {
          c.mesh.rotation.x = Math.sin(ph * 1.1) * 0.12 + 0.05;
          if (rig) rig.armL.rotation.x = rig.armR.rotation.x = c.armBase + 0.1 + Math.sin(ph * 1.1) * 0.1;
        } else if (c.idle === 'menace') {
          const a = Math.sin(ph * 0.9) * 0.5 + 0.5;
          if (rig) { rig.armL.rotation.x = c.armBase - a * 0.8; rig.armR.rotation.x = c.armBase - a * 0.8; }
          c.mesh.position.y = Math.sin(ph * 0.9) * 0.03;
        } else if (c.idle === 'float') {
          c.mesh.position.y = Math.sin(ph * 1.4) * 0.12 + 0.1;
          c.mesh.rotation.z = Math.sin(ph * 0.8) * 0.06;
        }
      }
      if (c.light) c.light.intensity = Math.max(0, c.light.intensity - dt * 7);
    }
    // slingshot light decay
    for (const s of segs) {
      if (s.sling && s.sling.t > 0) { s.sling.t -= dt; s.sling.light.intensity = Math.max(0, s.sling.t * 16); }
    }

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  loop();

  // expose for debug / screenshots / "play again"
  window.__mb = {
    scene, camera, renderer, ball, flippers, circles, segs, state, audio,
    gameplay: { reset },
    plunge, startGameRun, buildLevel, checkLevelClear, defeatMonster, ROSTER,
  };
}
