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
import { Reflector } from 'three/addons/objects/Reflector.js';
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
const TOP      = -13.0;   // far end — long table; the camera follows the ball up/down it
const BOTTOM   = 3.4;     // near end / drain plane
const BALL_R   = 0.34;    // ball Ø = 0.68 → EVERY channel the ball travels must be > 0.68
const LANE_X1  = HW + 0.9;    // launch lane = channel between HW and LANE_X1 (≈0.9 wide)
const LANE_CX  = (HW + LANE_X1) / 2;
const GRAV     = 13.0;    // table gravity (toward +z) — strong enough the ball flows down
const WALL_E   = 0.40;    // wall restitution
const FLIP_LEN = 1.6;
const FLIP_R   = 0.20;
const DRAIN_Z  = BOTTOM;  // past this z = ball lost
const CONTENT_DZ = 3.0;   // push all monsters/bumpers DOWN this far below TOP, so the
                          // curved top leaves a clear band for the ball to come over + flow in
const CONTENT_SPREAD = 1.5; // spread the cast/bumpers further apart down the long table
const MAX_BALLS = 5;        // ball-counter cap (extra balls stack up to here)
// Free-ball milestones ESCALATE: the first comes at BASE, each next one costs
// GROWTH× more — so free balls can't keep pace with a high score forever and the
// run eventually ends (was a flat 5000 → game never ended).
const EXTRA_BALL_BASE = 8000;
const EXTRA_BALL_GROWTH = 1.7;

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
// UPPER playfield: monster cast + formation + pop-bumper layout + obstacles + palette.
// `m(key,x,z,face,hp,scale?,mv?)` builds a monster spec. Positions use z relative to TOP.
// mv = patrol rule {t:'h'|'v'|'orbit', a:amplitude(world units), s:speed, p?:phase}.
// `obs` = bouncy guard pins [x,z,color] that narrow the path to the cast (keep the
//   ball pinging up top → more bashing, more score) and add visual complexity.
// Difficulty curve: L1 static intro → movement introduced → pins + paced packs →
//   patrolling mech line → boss arena. Free-ball milestones offset the ramp.
const m = (key, x, z, face = 0, hp = 3, scale = 0.62, mv = null) => ({ key, x, z, face, hp, scale, mv });
const LEVELS = [
  // L1 Crypt — gentle intro: static cast, just learn the flippers
  { name: 'Crypt', pal: { fog: 0x140a26, hemiSky: 0x9a7bd6, hemiGround: 0x241433, key: 0xfff0d8, floor: 0x231244, inlay: 0x5a2fae },
    cast: [ m('vampire', -2.2, 1.6, 0.5), m('werewolf', 0, 1.4, 0), m('zombie', 2.2, 1.6, -0.5), m('skeleton', -1.7, 6.2, 0.8), m('skeleton', 1.7, 6.2, -0.8) ],
    pops: [ [-1.3, 3.6, 0x2fd0ff], [1.3, 3.6, 0xffd23f], [0, 5.2, 0x8bff5a] ] },
  // L2 Catacomb — movement debut: the lead mummy slides side to side
  { name: 'Catacomb', pal: { fog: 0x0a1f1a, hemiSky: 0x6fd0c0, hemiGround: 0x10302a, key: 0xe8fff4, floor: 0x123830, inlay: 0x2fae8b },
    cast: [ m('mummy', 0, 1.2, 0, 3, 0.62, { t: 'h', a: 1.7, s: 0.85 }), m('ghost', -2.3, 3.4, 0.5), m('mummy', 2.3, 3.4, -0.5), m('skeleton', 0, 5.8, 0) ],
    pops: [ [-1.5, 4.4, 0x9bff5a], [1.5, 4.4, 0x2fd0ff], [0, 2.9, 0xffd23f] ] },
  // L3 Blood Moon — two werewolves pace in opposition + guard pins pinch the lanes
  { name: 'Blood Moon', pal: { fog: 0x2a0a0e, hemiSky: 0xd68a7b, hemiGround: 0x33130f, key: 0xffe0d0, floor: 0x3a1418, inlay: 0xc24b3b },
    cast: [ m('werewolf', -1.6, 1.6, 0.3, 3, 0.62, { t: 'h', a: 1.1, s: 1.1 }), m('werewolf', 1.6, 1.6, -0.3, 3, 0.62, { t: 'h', a: 1.1, s: 1.1, p: 3.14 }), m('vampire', 0, 3.0, 0), m('zombie', -2.4, 4.4, 0.6), m('zombie', 2.4, 4.4, -0.6) ],
    obs: [ [-1.5, 2.5, 0xff5a8a], [1.5, 2.5, 0xff5a8a] ],
    pops: [ [0, 5.6, 0xffd23f], [-1.7, 6.0, 0x2fd0ff], [1.7, 6.0, 0x2fd0ff] ] },
  // L4 Machine — patrolling mech line + bobbing rear guard + a central pin gauntlet
  { name: 'Machine', pal: { fog: 0x0a1428, hemiSky: 0x7bb0e0, hemiGround: 0x14243a, key: 0xe0f0ff, floor: 0x142844, inlay: 0x2f6eae },
    cast: [ m('combatMech', -1.9, 1.5, 0.4, 3, 0.62, { t: 'h', a: 0.7, s: 1.3 }), m('combatMech', 1.9, 1.5, -0.4, 3, 0.62, { t: 'h', a: 0.7, s: 1.3, p: 3.14 }), m('combatMech', 0, 2.6, 0, 4), m('skeleton', -1.7, 6.0, 0.8, 3, 0.62, { t: 'v', a: 1.0, s: 1.0 }), m('skeleton', 1.7, 6.0, -0.8, 3, 0.62, { t: 'v', a: 1.0, s: 1.0, p: 3.14 }) ],
    obs: [ [-0.95, 4.3, 0x2fd0ff], [0.95, 4.3, 0x8bff5a], [0, 5.3, 0xffd23f] ],
    pops: [ [-1.8, 4.0, 0x2fd0ff], [1.8, 4.0, 0x8bff5a] ] },
  // L5 Raid — boss arena: the minotaur orbits, flanking guards pace, pins everywhere
  { name: 'Raid', pal: { fog: 0x281a0a, hemiSky: 0xe0b87b, hemiGround: 0x33260f, key: 0xfff0d0, floor: 0x3a2e14, inlay: 0xffa320 },
    cast: [ m('minotaur', 0, 2.6, 0, 6, 0.86, { t: 'orbit', a: 0.85, s: 0.9 }), m('swat', -1.9, 1.4, 0.5, 3, 0.62, { t: 'h', a: 0.7, s: 1.4 }), m('viking', 1.9, 1.4, -0.5, 3, 0.62, { t: 'h', a: 0.7, s: 1.4, p: 3.14 }) ],
    obs: [ [-1.5, 4.2, 0xffa320], [1.5, 4.2, 0xffa320], [0, 6.0, 0xff5a8a] ],
    pops: [ [-1.7, 6.4, 0x2fd0ff], [1.7, 6.4, 0xffd23f] ] },
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
  scene.fog = new THREE.Fog(0x140a26, 14, 40);

  // ── follow camera — tracks the ball up/down the long table; clamps keep the
  //    flippers in view when the ball is low and the top in view when it's high ─
  const camera = new THREE.PerspectiveCamera(58, 1, 0.1, 120);
  const FOLLOW = {
    dy: 9.5, dz: 7.2,            // camera height + offset toward the viewer (base, for a tall phone)
    lookDy: -0.6, lookDz: -3.2,  // lookAt offset (into the screen) from focus
    focusMin: TOP + 4.5,         // ball at top → camera looks high
    focusMax: BOTTOM - 1.4,      // ball at bottom → flippers stay visible
    preroll: BOTTOM - 1.4,       // BEFORE launch the view sits at the BOTTOM (flippers);
    lerp: 4,                     // following only kicks in once the ball is live (plunged)
    zoom: 1,                     // aspect-adaptive: <1 pulls the camera in on wider/shorter screens
  };
  let camFocusZ = FOLLOW.preroll;
  function applyCamera() {
    const z = FOLLOW.zoom;
    camera.position.set(0, FOLLOW.dy * z, camFocusZ + FOLLOW.dz * z);
    camera.lookAt(0, FOLLOW.lookDy, camFocusZ + FOLLOW.lookDz);
  }
  function placeCamera() { applyCamera(); }  // resize just re-applies; aspect set in onResize
  applyCamera();

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
  // glowing center inlay — CAPSULE / racetrack shape (rounded ends) echoing the
  // curved top, own material so it recolours per level
  const inlayMat = new THREE.MeshStandardMaterial({ color: 0x3a1f6e, roughness: 0.9, metalness: 0, flatShading: true, emissive: new THREE.Color(0x5a2fae), emissiveIntensity: 0.35 });
  const inlayCZ = (TOP + BOTTOM) / 2 - 0.4;
  // capsule (rounded-rect) Shape centred at origin, in the XY plane
  function capsuleShape(w, len) {
    const r = w / 2, x0 = -w / 2, y0 = -len / 2;
    const sh = new THREE.Shape();
    sh.moveTo(x0 + r, y0);
    sh.lineTo(x0 + w - r, y0);
    sh.quadraticCurveTo(x0 + w, y0, x0 + w, y0 + r);
    sh.lineTo(x0 + w, y0 + len - r);
    sh.quadraticCurveTo(x0 + w, y0 + len, x0 + w - r, y0 + len);
    sh.lineTo(x0 + r, y0 + len);
    sh.quadraticCurveTo(x0, y0 + len, x0, y0 + len - r);
    sh.lineTo(x0, y0 + r);
    sh.quadraticCurveTo(x0, y0, x0 + r, y0);
    return sh;
  }
  const INLAY_W = HW * 1.5, INLAY_LEN = (BOTTOM - TOP) * 0.66;
  // glowing capsule (level-colour identity) — sits low so a lit rim peeks around
  // the polished mirror lane laid just above it
  const inlay = new THREE.Mesh(new THREE.ShapeGeometry(capsuleShape(INLAY_W, INLAY_LEN)), inlayMat);
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.set(0, 0.015, inlayCZ);
  inlay.receiveShadow = true;
  table.add(inlay);
  // ── polished reflective centre lane (real planar reflection for "倒影" / sheen) ──
  // A Reflector inset inside the glow capsule mirrors the ball + monsters that
  // pass over the middle. Tinted per level. Guarded: if it fails (WebGL quirk),
  // we just keep the matte glow capsule and the game is unaffected.
  let reflector = null;
  try {
    reflector = new Reflector(new THREE.ShapeGeometry(capsuleShape(INLAY_W - 0.5, INLAY_LEN - 0.5)), {
      textureWidth: 1024, textureHeight: 1024, color: 0x4a2f7a, clipBias: 0.003,
    });
    reflector.rotation.x = -Math.PI / 2;
    reflector.position.set(0, 0.028, inlayCZ);
    table.add(reflector);
  } catch (e) { reflector = null; }

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

  // ── CURVED top arc (rounded playfield top, spanning field + launch lane) ──
  // The plunged ball rockets up the lane, hits this arc and is guided up-and-over
  // then down-left into the playfield — the classic shooter-lane → top-arc flow.
  const ARC_DROP   = 3.4;                         // arc depth — bigger = more curved dome
  const ARC_SIDE_Z = TOP + ARC_DROP;             // where the arc meets the side walls
  (function buildTopArc() {
    const cx = (LANE_X1 - HW) / 2;               // arc centre x (covers field + lane)
    const halfW = (LANE_X1 + HW) / 2;
    const drop = ARC_DROP;                        // how far the side ends sit below the peak
    const R = (halfW * halfW + drop * drop) / (2 * drop);
    const ccz = TOP + R;                         // circle centre z (peak at z=TOP)
    const a0 = Math.asin(halfW / R);
    const N = 16;
    let px = -HW, pz = ARC_SIDE_Z;
    for (let i = 1; i <= N; i++) {
      const a = -a0 + (2 * a0) * (i / N);
      const nx = cx + R * Math.sin(a);
      const nz = ccz - R * Math.cos(a);
      wall(px, pz, nx, nz);
      px = nx; pz = nz;
    }
  })();
  // LEFT outer wall (also left outlane outer) from the arc down to the drop
  wall(-HW, ARC_SIDE_Z, -HW, DROP_Z);
  // RIGHT: launch-lane outer wall + divider (divider also = right outlane outer wall)
  wall(LANE_X1, ARC_SIDE_Z, LANE_X1, BOTTOM - 0.4);     // lane outer wall (from arc down)
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
    // outlane guard peg — sits ABOVE the outlane mouth (not in it) so it bats
    // SOME balls back toward the flipper while leaving the channel passable.
    // kind 'post' = persists across level rebuilds (not cleared in buildLevel).
    const gx = s * 3.05, gz = SPLIT_Z - 1.55;
    const peg = cyl(0.2, 0.2, 0.7, 10, 0xe04898, gx, 0.35, gz, { e: 0xff4bd0, ei: 0.45 });
    table.add(peg);
    circles.push({ x: gx, z: gz, r: 0.24, e: 0.6, kick: 0, score: 0, mesh: peg, light: null, kind: 'post', punch: 0 });
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
    const r = 0.54;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.add(cyl(r, r + 0.05, 0.17, 16, 0x1a0e36, 0, 0.085, 0));
    const cap = cyl(r - 0.11, r - 0.02, 0.38, 16, color, 0, 0.36, 0, { e: color, ei: 0.55 });
    g.add(cap);
    g.add(cyl(0.13, 0.13, 0.17, 10, 0xfff6cf, 0, 0.58, 0, { e: 0xfff6cf, ei: 0.9 }));
    table.add(g);
    const light = new THREE.PointLight(color, 0.5, 5, 2);
    light.position.set(x, 1.4, z); table.add(light);
    levelMeshes.push(g, light);
    circles.push({ x, z, r, e: 0.5, kick: 5.0, score: 100, mesh: g, cap, light, kind: 'pop', punch: 0 });
  }

  // guard pin — a tall, bouncy, non-kicking pillar that narrows the path to the
  // cast. Reuses the 'pop' kind (bounce + score + light pulse) with kick 0 so it
  // deflects without launching; level-clear only counts monsters, so it's inert
  // to progression. Cleared on level rebuild like any non-'post' circle.
  function spawnObstacle(x, z, color) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.add(cyl(0.27, 0.31, 0.16, 14, 0x1a0e36, 0, 0.08, 0));
    g.add(cyl(0.22, 0.26, 1.0, 12, color, 0, 0.58, 0, { e: color, ei: 0.5 }));
    table.add(g);
    const light = new THREE.PointLight(color, 0.3, 3.2, 2);
    light.position.set(x, 1.2, z); table.add(light);
    levelMeshes.push(g, light);
    circles.push({ x, z, r: 0.3, e: 0.85, kick: 0, score: 20, mesh: g, light, kind: 'pop', punch: 0 });
  }

  // monster pedestal — a beveled dark plinth + a glowing neon rim ring + a faint
  // rune-lit top face (vs the old flat purple disc). Glow tracks the level colour.
  // Returns a Group so it moves/hides with the monster like the old single mesh.
  let baseGlow = 0x5a2fae;   // updated per level from the palette inlay
  function makeMonsterBase(scale) {
    const s = scale / 0.62;
    const g = new THREE.Group();
    const plinth = cyl(0.66 * s, 0.82 * s, 0.12, 24, 0x160c28, 0, 0.06, 0);              // dark beveled plinth
    const tier   = cyl(0.54 * s, 0.66 * s, 0.06, 24, 0x2a1840, 0, 0.15, 0,
      { e: baseGlow, ei: 0.45 });                                                        // glowing top tier
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.64 * s, 0.045 * s, 8, 28),
      M(baseGlow, 0.4, baseGlow, 1.0));                                                  // bright neon rim
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.12; ring.castShadow = false;
    g.add(plinth, tier, ring);
    return g;
  }

  function spawnMonster(spec) {
    const fig = ROSTER[spec.key]();
    const SCALE = spec.scale || 0.62;
    fig.scale.setScalar(SCALE);
    fig.position.set(spec.x, 0, spec.z);
    fig.rotation.y = spec.face || 0;
    table.add(fig);
    const post = makeMonsterBase(SCALE);
    post.position.set(spec.x, 0, spec.z);
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
      move: spec.mv ? { ...spec.mv, ax: spec.x, az: spec.z, ph: spec.mv.p ?? Math.random() * 6.28 } : null,
    });
  }

  function applyPalette(p) {
    scene.fog.color.setHex(p.fog);
    renderer.setClearColor(p.fog);
    hemi.color.setHex(p.hemiSky); hemi.groundColor.setHex(p.hemiGround);
    key.color.setHex(p.key);
    floor.material.color.setHex(p.floor);
    inlayMat.color.setHex(p.inlay); inlayMat.emissive.setHex(p.inlay);
    baseGlow = p.inlay;   // monster pedestals glow the level colour
    // tint the mirror lane toward the level's inlay colour (kept mid-dark so the
    // reflections read without washing out)
    if (reflector && reflector.material && reflector.material.uniforms && reflector.material.uniforms.color) {
      reflector.material.uniforms.color.value.setHex(p.inlay).multiplyScalar(0.62);
    }
  }

  // build / rebuild the upper playfield for a level index
  function buildLevel(i) {
    // tear down previous content
    for (const mesh of levelMeshes) table.remove(mesh);
    levelMeshes.length = 0;
    // clear only per-level content; keep fixed 'post' pegs
    for (let k = circles.length - 1; k >= 0; k--) if (circles[k].kind !== 'post') circles.splice(k, 1);
    const L = LEVELS[i % LEVELS.length];
    applyPalette(L.pal);
    for (const [x, z, c] of L.pops) spawnPop(x, TOP + CONTENT_DZ + z * CONTENT_SPREAD, c);
    if (L.obs) for (const [x, z, c] of L.obs) spawnObstacle(x, TOP + CONTENT_DZ + z * CONTENT_SPREAD, c);
    for (const sp of L.cast) spawnMonster({ ...sp, z: TOP + CONTENT_DZ + sp.z * CONTENT_SPREAD });
    setMidFlippers(i >= 2, true);   // right upper flipper always; left joins from level 3
    hud.setLevel && hud.setLevel(i + 1, L.name);
  }

  // ── flippers ────────────────────────────────────────────────────────────
  // A MID pair (upper flippers) is added for the harder later levels so the
  // player can re-launch a ball that's fallen below the cast back up to it.
  // Same left/right input drives every flipper on that side — no new controls.
  const MID_PIVOT_X = 2.55, MID_PIVOT_Z = -2.4, MID_FLIP_LEN = 1.3;
  function makeFlipper(side, px, pz, len, mid = false) {
    const s = side;
    // rest: tip points inward + gently down (leaves a centre gap); active: swings up
    const rest   = s < 0 ? 0.50 : (Math.PI - 0.50);   // ~29° below horizontal, tips toward drain
    const active = s < 0 ? -0.50 : (Math.PI + 0.50);  // strong upward flip
    const group = new THREE.Group();
    group.position.set(px, 0.34, pz);
    const col = mid ? 0x49c2ff : 0xffd23f;            // mid pair is cool-blue to read as the upper tier
    const ec  = mid ? 0x2f8fe0 : 0xffa320;
    const bar = box(len, 0.34, FLIP_R * 2, col, len / 2 - 0.1, 0, 0, { e: ec, ei: 0.3 });
    group.add(bar);
    group.add(cyl(0.24, 0.24, 0.4, 12, 0xe04898, 0, 0, 0));   // pivot knuckle
    group.visible = !mid;                              // mid pair hidden until a level enables it
    table.add(group);
    const f = { side: s, px, pz, len, r: FLIP_R, ang: rest, target: rest, rest, active, omega: 0, group, held: false, mid, enabled: !mid };
    flippers.push(f);
    return f;
  }
  const flipL = makeFlipper(-1, -PIVOT_X, PIVOT_Z, FLIP_LEN);
  const flipR = makeFlipper(1, PIVOT_X, PIVOT_Z, FLIP_LEN);
  const flipMidL = makeFlipper(-1, -MID_PIVOT_X, MID_PIVOT_Z, MID_FLIP_LEN, true);
  const flipMidR = makeFlipper(1, MID_PIVOT_X, MID_PIVOT_Z, MID_FLIP_LEN, true);
  // upper flippers per side: the RIGHT one is on every level (the right side is a
  // hard area to save), the LEFT one joins from level 3 (the harder levels).
  function setMidFlippers(leftOn, rightOn) {
    const set = (f, on) => {
      f.enabled = on; f.group.visible = on;
      if (!on) { f.held = false; f.target = f.rest; f.ang = f.rest; f.omega = 0; }
    };
    set(flipMidL, leftOn); set(flipMidR, rightOn);
  }

  // ── balls (a small POOL so the pit can spit out a multiball) ───────────────
  const MAX_INPLAY = 5;                       // most physical balls on the table at once
  const ballMeshGeo = new THREE.IcosahedronGeometry(BALL_R, 1);
  const ballMat = new THREE.MeshStandardMaterial({
    color: 0xdfe6ee, roughness: 0.25, metalness: 0.8, flatShading: true,
    emissive: 0x223044, emissiveIntensity: 0.3,
  });
  const balls = [];
  for (let i = 0; i < MAX_INPLAY; i++) {
    const mesh = new THREE.Mesh(ballMeshGeo, ballMat);
    mesh.castShadow = true; mesh.position.y = BALL_R; mesh.visible = false;
    table.add(mesh);
    balls.push({ x: LANE_CX, z: BOTTOM - 0.6, vx: 0, vz: 0, live: false, gated: false,
      active: false, mesh, stuckT: 0, confX: 0, confZ: 0, confT: 0 });
  }
  // ONE shared ball light follows the lead ball (avoids piling up PointLights —
  // too many can blow the per-fragment light limit on mobile GPUs)
  const ballLight = new THREE.PointLight(0xbfe6ff, 0, 6, 2); table.add(ballLight);
  const LANE_EXIT_Z = TOP + 1.8;   // up near the top → sweep the ball into the field
  function activeBalls() { let n = 0; for (const b of balls) if (b.active) n++; return n; }
  function spawnBall(x, z, vx, vz, live = true) {
    for (const b of balls) {
      if (b.active) continue;
      b.active = true; b.live = live; b.gated = false;
      b.x = x; b.z = z; b.vx = vx; b.vz = vz; b.mesh.visible = true;
      b.stuckT = 0; b.confX = x; b.confZ = z; b.confT = 0;
      return b;
    }
    return null;
  }
  function despawnBall(b) { b.active = false; b.live = false; b.mesh.visible = false; }

  // ── MULTIBALL PIT (saucer) ─────────────────────────────────────────────────
  // A glowing gold hole mid-field. While ARMED (pulsing) it captures the next ball
  // that drops in and spits out a multiball; then it goes dark for a cooldown and
  // re-arms. When dark it's inert (the ball rolls over it), so it never disrupts
  // normal flow. Self-evident: bright pulsing = jackpot, dark = spent.
  const PIT = { x: 0, z: TOP + CONTENT_DZ + 4.0 * CONTENT_SPREAD, r: 0.52,
    armed: true, cd: 0, ringMat: null, light: null, group: null };
  (function buildPit() {
    const g = new THREE.Group(); g.position.set(PIT.x, 0, PIT.z);
    g.add(cyl(0.4, 0.4, 0.34, 20, 0x000000, 0, -0.14, 0));            // the recessed dark hole
    g.add(cyl(0.5, 0.6, 0.1, 20, 0x0c0716, 0, 0.05, 0));             // dark well rim
    const ringMat = new THREE.MeshStandardMaterial({ color: 0x1c1206, roughness: 0.4, metalness: 0,
      flatShading: true, emissive: new THREE.Color(0xffd23f), emissiveIntensity: 0.7 });
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.52, 0.06, 8, 24), ringMat);
    ring.rotation.x = Math.PI / 2; ring.position.y = 0.1; ring.castShadow = false;
    g.add(ring);
    const light = new THREE.PointLight(0xffd23f, 1.2, 5, 2); light.position.set(0, 1.0, 0); g.add(light);
    table.add(g);
    PIT.ringMat = ringMat; PIT.light = light; PIT.group = g;
  })();
  function startMultiball() {
    const n = Math.min(3, MAX_INPLAY - activeBalls());   // fan a few balls up out of the hole
    for (let i = 0; i < n; i++) {
      const ang = -Math.PI / 2 + (i - (n - 1) / 2) * 0.5;   // spread, aimed up the table
      const spd = 9 + Math.random() * 3;
      spawnBall(PIT.x + Math.cos(ang) * 0.3, PIT.z, Math.cos(ang) * spd, Math.sin(ang) * spd, true);
    }
    flashMsg('MULTIBALL!');
    audio.launch(); audio.pop();
  }
  function checkPit(b) {
    if (!PIT.armed) return;
    const dx = b.x - PIT.x, dz = b.z - PIT.z;
    if (dx * dx + dz * dz > PIT.r * PIT.r) return;
    PIT.armed = false; PIT.cd = 14;       // spent → dark for a while, then re-arms
    despawnBall(b);                        // the captured ball is consumed...
    startMultiball();                      // ...and reborn as a multiball
  }
  function updatePit(dt) {
    if (!PIT.armed) { PIT.cd -= dt; if (PIT.cd <= 0) PIT.armed = true; }
    const pulse = 0.6 + 0.4 * Math.sin(t * 4);
    if (PIT.ringMat) PIT.ringMat.emissiveIntensity = PIT.armed ? pulse : 0.1;
    if (PIT.light) PIT.light.intensity = PIT.armed ? (1.0 + 0.6 * Math.sin(t * 4)) : 0.18;
  }

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
    clearT: 0,           // countdown after a clear before the fade-swap
    clearing: false,     // mid level-clear transition
    stuckT: 0,           // how long the live ball has been idle (anti-stuck)
    confX: 0, confZ: 0, confT: 0,  // confinement anchor + timer (score-loop guard)
    hintShown: false,    // flip hint shown once (when the ball first nears the flippers)
    nextExtra: EXTRA_BALL_BASE,    // score at which the next free ball is awarded
    extraStep: EXTRA_BALL_BASE,    // current gap between free-ball milestones (escalates)
  };
  hud.setBest && hud.setBest(state.best);
  buildLevel(0);              // populate the table at preroll (no empty table — scroll-feed rule)
  hud.setPhase('preroll');    // (hides the level chip that buildLevel showed, until play starts)

  function resetBall() {
    // clear the table, then a single ball waits in the launch lane, auto-plunges
    for (const b of balls) despawnBall(b);
    spawnBall(LANE_CX, BOTTOM - 0.6, 0, 0, false);   // active + visible, not yet live
    state.launchT = 0.7;
  }
  function plunge() {
    for (const b of balls) {
      if (b.active && !b.live) {
        b.live = true; b.gated = false;
        b.vx = (Math.random() - 0.5) * 0.3;
        b.vz = -28;         // rocket up the launch lane (reaches the top)
      }
    }
    audio.launch();
  }

  function startGameRun() {
    state.mode = 'play';
    state.score = 0; state.balls = 3; state.mult = 1; state.comboT = 0;
    state.level = 0; state.clearT = 0; state.hintShown = false;
    state.nextExtra = EXTRA_BALL_BASE; state.extraStep = EXTRA_BALL_BASE;
    hud.setScore(0); hud.setBalls(3); hud.setMult(1);
    hud.setPhase('play');
    audio.prime(); audio.hum(true);
    buildLevel(0);
    resetBall();
  }

  // all monsters defeated → bonus + extra ball + banner now, then (after the
  // defeat bursts finish) a fade-swap to the next level so it isn't an abrupt cut
  function checkLevelClear() {
    if (state.clearing) return;
    if (circles.some(c => c.kind === 'monster' && c.alive)) return;
    const bonus = 2000 * (state.level + 1);
    addScore(bonus);
    // clear ball only on the FIRST lap (levels 1..N); once the levels loop
    // endless it's a pure survival run, so clears give score only → run can end
    const clearBall = state.level < LEVELS.length && state.balls < MAX_BALLS;
    if (clearBall) { state.balls++; hud.setBalls(state.balls); }
    flashMsg(clearBall ? 'LEVEL CLEAR  +1 BALL' : 'LEVEL CLEAR');
    audio.pop();
    state.clearing = true;
    state.clearT = 1.1;                            // let the bursts play out + banner show
    for (const b of balls) b.live = false;        // freeze every ball during the transition
  }

  function defeatMonster(c) {
    c.alive = false;
    c.defeatT = 1;                     // drives the burst animation
    addScore(c.score * 2);             // defeat bonus
    if (c.light) c.light.intensity = 4;
    audio.monster();
    // BURST: fling every voxel piece of the figure outward + up with spin
    for (const part of c.mesh.children) {
      const px = part.position.x, pz = part.position.z;
      part.userData.vel = new THREE.Vector3(
        px * 2 + (Math.random() - 0.5) * 4,
        2.5 + Math.random() * 3.5,
        pz * 2 + (Math.random() - 0.5) * 4);
      part.userData.spin = new THREE.Vector3(
        (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14, (Math.random() - 0.5) * 14);
    }
  }

  // called only when the LAST ball in play has drained (multiball costs one life)
  function loseBall() {
    for (const b of balls) despawnBall(b);
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

  // award a free ball ("续命"); returns false (and gives a small consolation
  // bonus) when already at the cap so the milestone isn't simply wasted.
  function awardExtraBall(msg) {
    if (state.balls >= MAX_BALLS) return false;
    state.balls++;
    hud.setBalls(state.balls);
    flashMsg(msg || 'EXTRA BALL  +1');
    audio.pop();
    return true;
  }

  function addScore(n) {
    state.score += n * state.mult;
    hud.setScore(state.score);
    // score-milestone free balls — escalating gap so they thin out as you climb
    while (state.balls < MAX_BALLS && state.score >= state.nextExtra) {
      state.extraStep = Math.round(state.extraStep * EXTRA_BALL_GROWTH);
      state.nextExtra += state.extraStep;
      awardExtraBall('EXTRA BALL  +1');
    }
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
    let clack = false;
    for (const f of flippers) {                 // drive every enabled flipper on this side
      if (f.side !== side || !f.enabled) continue;
      if (!f.held) clack = true;
      f.held = true; f.target = f.active;
    }
    if (clack) audio.flip();
  }
  function releaseSide(side) {
    for (const f of flippers) {
      if (f.side !== side) continue;
      f.held = false; f.target = f.rest;
    }
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
  function collideSeg(ball, s) {
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
    if (s.score && !(s.cool > 0)) { s.cool = 0.18; addScore(s.score); bump(); audio.sling(); if (s.sling) { s.sling.t = 0.18; s.sling.light.intensity = 3; } }
  }
  function collideCircle(ball, c) {
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
    if (c.kind === 'post') return;   // guard peg: pure bounce, no score/punch
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
    // pops / guard pins: cooldown so a ball wedged against (or ping-ponging on)
    // a bumper can't rack up score every frame — the score-loop trap fix.
    if (c.cool > 0) return;
    c.cool = 0.18;
    addScore(c.score); bump();
    c.punch = 1;
    if (c.light) c.light.intensity = 3.2;
    if (c.kind === 'sling') audio.sling(); else audio.pop();
  }
  function collideFlipper(ball, f) {
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
        if (!f.enabled) { f.omega = 0; continue; }
        const prev = f.ang;
        const speed = f.held ? 26 : 16;     // up fast, return a touch slower
        const diff = f.target - f.ang;
        const step = Math.sign(diff) * Math.min(Math.abs(diff), speed * SUB);
        f.ang += step;
        f.omega = (f.ang - prev) / SUB;
      }
      // per-ball physics (multiball: every active live ball steps independently)
      for (const ball of balls) {
        if (!ball.active || !ball.live) continue;
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
        for (const s of segs) collideSeg(ball, s);
        for (const c of circles) collideCircle(ball, c);
        for (const f of flippers) if (f.enabled) collideFlipper(ball, f);
        // top-of-arc sweep: once the plunged ball reaches the top, send it
        // DOWN-LEFT into the playfield (no teleport — it visibly rode up to the
        // top first, now sweeps down through the bumpers). Fires once per ball.
        if (!ball.gated && ball.z < LANE_EXIT_Z && ball.x > HW - 1.3) {
          ball.vx = -(8 + Math.random() * 3);   // sweep well into the field (toward centre)
          ball.vz = 3;
          ball.gated = true;
        }
        // multiball pit capture
        checkPit(ball);
        // drain — only the LAST drained ball costs a life
        if (ball.active && ball.z > DRAIN_Z) {
          despawnBall(ball);
          if (activeBalls() === 0) loseBall();
        }
      }
    }
  }

  // ── resize ─────────────────────────────────────────────────────────────────
  function onResize() {
    const w = canvas.clientWidth || window.innerWidth;
    const h = canvas.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // aspect-adaptive zoom: a tall phone (aspect ~0.46) uses the base distance;
    // wider/shorter screens pull the camera IN so the table still fills the frame
    FOLLOW.zoom = Math.max(0.7, Math.min(1, 0.46 / (w / h)));
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

    // auto-plunge countdown between balls (a ball waits in the lane, not yet live)
    if (state.mode === 'play' && state.launchT > 0) {
      state.launchT -= dt; if (state.launchT <= 0) plunge();
    }

    physics(dt);
    updatePit(dt);

    // anti-stuck + score-loop confinement guard — applied per live ball so a
    // trapped ball (slow in a corner, or fast ping-ponging in one spot) is always
    // freed and can't rack up score forever.
    if (state.mode === 'play') {
      for (const ball of balls) {
        if (!ball.active || !ball.live) continue;
        if (Math.hypot(ball.vx, ball.vz) < 1.3) ball.stuckT += dt; else ball.stuckT = 0;
        if (ball.stuckT > 2.5) {
          ball.vz += 5 + Math.random() * 2;            // shove down toward the flippers
          ball.vx += (Math.random() - 0.5) * 6;
          ball.stuckT = 0;
        }
        const dcx = ball.x - ball.confX, dcz = ball.z - ball.confZ;
        if (dcx * dcx + dcz * dcz > 1.3 * 1.3) { ball.confX = ball.x; ball.confZ = ball.z; ball.confT = 0; }
        else {
          ball.confT += dt;
          if (ball.confT > 2.6) {
            ball.vx = (ball.x >= 0 ? -1 : 1) * (4 + Math.random() * 3);   // kick toward centre
            ball.vz = 7 + Math.random() * 3;                              // and firmly down to the flippers
            ball.confX = ball.x; ball.confZ = ball.z; ball.confT = 0; ball.stuckT = 0;
          }
        }
      }
    }

    // level-clear transition: after the bursts play, fade-swap to the next level
    if (state.clearing) {
      state.clearT -= dt;
      if (state.clearT <= 0) {
        state.clearing = false;
        state.level++;
        const next = state.level;
        if (hud.levelTransition) hud.levelTransition(() => { buildLevel(next); resetBall(); });
        else { buildLevel(next); resetBall(); }
      }
    }

    if (state.mode === 'preroll') {
      // ATTRACT angle — framed low on the machine so the FLIPPERS are clearly in
      // the bottom of the first screen (the control guide sits on them), with a
      // gentle drift. Pulled back a touch so the whole machine reads.
      const z = FOLLOW.zoom;
      const sway = Math.sin(t * 0.4) * 0.7;
      camera.position.set(sway, 9.2 * z, FOLLOW.preroll + 8.2 * z);
      camera.lookAt(0, -0.2, FOLLOW.preroll - 3.4);
      camFocusZ = FOLLOW.preroll;     // keep the follow rig primed for the cut to play
    } else {
      // follow camera — track the most urgent live ball (nearest the drain), clamped
      let lead = null;
      for (const b of balls) if (b.active && b.live && (!lead || b.z > lead.z)) lead = b;
      const targetFocus = lead
        ? Math.max(FOLLOW.focusMin, Math.min(FOLLOW.focusMax, lead.z))
        : FOLLOW.preroll;
      camFocusZ += (targetFocus - camFocusZ) * Math.min(1, dt * FOLLOW.lerp);
      applyCamera();
    }

    // combo decay
    if (state.comboT > 0) { state.comboT -= dt; if (state.comboT <= 0 && state.mult > 1) { state.mult = 1; hud.setMult(1); } }

    // ball mesh follow + spin (every ball in the pool); one shared light tracks the lead
    let lit = null;
    for (const b of balls) {
      if (!b.active) { b.mesh.visible = false; continue; }
      b.mesh.visible = true;
      b.mesh.position.set(b.x, BALL_R, b.z);
      b.mesh.rotation.x += b.vz * dt * 1.4;
      b.mesh.rotation.z -= b.vx * dt * 1.4;
      if (b.live && (!lit || b.z > lit.z)) lit = b;
    }
    if (lit) { ballLight.position.set(lit.x, BALL_R + 0.6, lit.z); ballLight.intensity = 0.7; }
    else ballLight.intensity = 0;

    // flipper visuals
    for (const f of flippers) f.group.rotation.y = -f.ang;

    // bumper / monster animation — state machine: defeat > hit(style) > idle
    for (const c of circles) {
      if (c.cool > 0) c.cool -= dt;
      if (c.kind === 'post') continue;          // static guard peg
      if (c.kind === 'pop') {
        if (c.punch > 0) { c.punch = Math.max(0, c.punch - dt * 5); c.mesh.scale.setScalar(1 + c.punch * 0.18); }
        if (c.light) c.light.intensity = Math.max(0.5, c.light.intensity - dt * 7);
        continue;
      }
      const rig = c.rig;
      if (!c.alive) {
        // DEFEAT — the figure bursts into voxel shrapnel that flies out + falls
        if (c.defeatT > 0) {
          c.defeatT = Math.max(0, c.defeatT - dt * 0.9);
          for (const part of c.mesh.children) {
            const v = part.userData.vel; if (!v) continue;
            v.y -= 22 * dt;                                 // gravity on the pieces
            part.position.x += v.x * dt;
            part.position.y += v.y * dt;
            part.position.z += v.z * dt;
            const sp = part.userData.spin;
            part.rotation.x += sp.x * dt; part.rotation.y += sp.y * dt; part.rotation.z += sp.z * dt;
          }
          if (c.defeatT <= 0) { c.mesh.visible = false; if (c.post) c.post.visible = false; }
        }
        if (c.light) c.light.intensity = Math.max(0, c.light.intensity - dt * 4);
        continue;
      }
      // PATROL — alive monsters glide within their region per their rule. We move
      // the collision centre (c.x/c.z) and bring the figure + floor disc + light
      // along; next physics step reads the updated centre. Continues through hits.
      if (c.move) {
        const mv = c.move, a = t * mv.s + mv.ph;
        // position + heading (rigs face +z at yaw 0, so yaw = atan2(vx,vz)).
        // h/v use a discrete sign so the turn is a clean pivot, not a flicker
        // through "facing camera" at the zero-velocity turn point.
        if (mv.t === 'h')          { c.x = mv.ax + Math.sin(a) * mv.a; c.z = mv.az; c.heading = Math.cos(a) >= 0 ? Math.PI / 2 : -Math.PI / 2; }
        else if (mv.t === 'v')     { c.x = mv.ax; c.z = mv.az + Math.sin(a) * mv.a; c.heading = Math.cos(a) >= 0 ? 0 : Math.PI; }
        else if (mv.t === 'orbit') { c.x = mv.ax + Math.cos(a) * mv.a; c.z = mv.az + Math.sin(a) * mv.a; c.heading = Math.atan2(-Math.sin(a), Math.cos(a)); }
        c.mesh.position.x = c.x; c.mesh.position.z = c.z;
        if (c.post)  { c.post.position.x = c.x; c.post.position.z = c.z; }
        if (c.light) { c.light.position.x = c.x; c.light.position.z = c.z; }
      }
      const yaw = c.move ? c.heading : c.face;   // walkers face their heading
      if (c.punch > 0) {
        // HIT — varied reaction
        c.punch = Math.max(0, c.punch - dt * 3.2);
        const p = c.punch, w = Math.sin(p * 30);
        c.mesh.scale.setScalar(c.base);
        c.mesh.position.y = Math.sin(p * Math.PI) * 0.15;
        if (c.hitStyle === 'stagger') {
          c.mesh.rotation.set(-0.55 * p, yaw, 0);
          if (rig) { rig.armL.rotation.set(c.armBase - 1.8 * p, 0, 0.6 * p); rig.armR.rotation.set(c.armBase - 1.8 * p, 0, -0.6 * p); rig.legL.rotation.set(0.5 * p, 0, 0); rig.legR.rotation.set(0.3 * p, 0, 0); }
        } else if (c.hitStyle === 'spin') {
          c.mesh.rotation.set(0, yaw + p * 6.0, 0);
          if (rig) { rig.armL.rotation.set(c.armBase, 0, 1.2 * p); rig.armR.rotation.set(c.armBase, 0, -1.2 * p); rig.legL.rotation.set(0, 0, 0); rig.legR.rotation.set(0, 0, 0); }
        } else if (c.hitStyle === 'jump') {
          c.mesh.rotation.set(0, yaw, 0);
          c.mesh.position.y = Math.sin(p * Math.PI) * 0.5;
          if (rig) { rig.armL.rotation.set(c.armBase - 1.5 * p, 0, 0); rig.armR.rotation.set(c.armBase - 1.5 * p, 0, 0); rig.legL.rotation.set(-0.8 * p, 0, 0); rig.legR.rotation.set(-0.8 * p, 0, 0); }
        } else { // flail
          c.mesh.rotation.set(0, yaw, w * 0.12 * p);
          if (rig) { rig.armL.rotation.set(c.armBase - 2.3 * p + w * 0.6 * p, 0, 1.3 * p); rig.armR.rotation.set(c.armBase - 2.3 * p - w * 0.6 * p, 0, -1.3 * p); rig.legL.rotation.set(w * 0.9 * p, 0, 0); rig.legR.rotation.set(-w * 0.9 * p, 0, 0); }
        }
      } else if (c.move) {
        // WALK — stride legs + counter-swing arms + a per-step bob, facing heading
        const wk = t * (4 + c.move.s * 2.4) + c.ph;
        const sw = Math.sin(wk);
        c.mesh.rotation.set(0, yaw, 0); c.mesh.scale.setScalar(c.base);
        c.mesh.position.y = Math.abs(Math.cos(wk)) * 0.06;     // bob up on each footfall
        if (rig) {
          rig.legL.rotation.set(sw * 0.7, 0, 0); rig.legR.rotation.set(-sw * 0.7, 0, 0);
          rig.armL.rotation.set(c.armBase - sw * 0.5, 0, 0); rig.armR.rotation.set(c.armBase + sw * 0.5, 0, 0);
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
    // slingshot light decay + scoring-seg cooldown bleed
    for (const s of segs) {
      if (s.cool > 0) s.cool -= dt;
      if (s.sling && s.sling.t > 0) { s.sling.t -= dt; s.sling.light.intensity = Math.max(0, s.sling.t * 16); }
    }

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  loop();

  // expose for debug / screenshots / "play again"
  window.__mb = {
    scene, camera, renderer, balls, flippers, circles, segs, state, audio, PIT,
    gameplay: { reset },
    plunge, startGameRun, buildLevel, checkLevelClear, defeatMonster, startMultiball, ROSTER,
  };
}
