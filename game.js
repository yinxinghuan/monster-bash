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
import { createAudio } from './lib/audio.js';

// ─── table layout constants (XZ plane, all tunable) ──────────────────────────
const HW       = 3.0;     // playfield half-width: x ∈ [-HW, HW]
const TOP      = -8.6;    // far end of the table
const BOTTOM   = 3.4;     // near end / drain plane
const BALL_R   = 0.34;    // ball Ø = 0.68 → EVERY path the ball must pass must be > 0.68
const LANE_X1  = HW + 0.95;   // outer right wall (launch lane between HW and LANE_X1)
const LANE_CX  = (HW + LANE_X1) / 2;
const GRAV     = 13.0;    // table gravity (toward +z) — strong enough the ball flows down
const WALL_E   = 0.40;    // wall restitution
const FLIP_LEN = 1.7;
const FLIP_R   = 0.22;
const DRAIN_Z  = BOTTOM;  // past this z = ball lost

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

  // playfield floor — deep purple slab with a glowing inlay border
  const floor = box(HW * 2 + 0.4, 0.5, BOTTOM - TOP + 0.4, 0x231244,
    (-0 ), -0.25, (TOP + BOTTOM) / 2);
  floor.receiveShadow = true;
  table.add(floor);
  // launch-lane floor strip
  table.add(box(LANE_X1 - HW, 0.5, BOTTOM - TOP + 0.4, 0x1a0e36,
    LANE_CX, -0.24, (TOP + BOTTOM) / 2));
  // subtle glowing center inlay
  const inlay = box(HW * 1.5, 0.02, (BOTTOM - TOP) * 0.5, 0x3a1f6e,
    0, 0.02, (TOP + BOTTOM) / 2 - 1.0, { e: 0x5a2fae, ei: 0.35 });
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

  // ── bottom-region geometry anchors (single source of truth) ──────────────
  // Flipper pivots sit wide; flippers angle gently inward so the gaps the ball
  // must fall through are all WIDER than the ball (Ø 0.68):
  //   • centre drain gap between flipper tips ≈ 1.10
  //   • two outlanes (outside each flipper pivot) drain as well
  const PIVOT_X = 2.1;          // flipper pivot x (±)
  const PIVOT_Z = BOTTOM - 0.95;// flipper pivot z  (= 2.45)
  const FUNNEL_TOP_Z = 0.8;     // where the side walls start funnelling inward

  // ── outer walls ─────────────────────────────────────────────────────────
  // left side: vertical wall down to the funnel start, then funnel to the pivot
  wall(-HW, FUNNEL_TOP_Z, -HW, TOP + 1.1);
  wall(-HW, TOP + 1.1, -HW + 1.1, TOP);                 // top-left chamfer
  wall(-HW, FUNNEL_TOP_Z, -PIVOT_X, PIVOT_Z, { glow: 0x3a1f6e });   // left funnel → pivot
  // top span (caps field + lane top)
  wall(-HW + 1.1, TOP, LANE_X1, TOP);
  // right outer wall (down the launch lane, past the spawn point)
  wall(LANE_X1, TOP, LANE_X1, BOTTOM - 0.5);
  // lane divider — separates lane from field up top; stops at FUNNEL_TOP_Z so the
  // descending field ball funnels in (and the plunged ball still rides the lane up)
  wall(HW, FUNNEL_TOP_Z, HW, TOP + 2.9);
  wall(HW, FUNNEL_TOP_Z, PIVOT_X, PIVOT_Z, { glow: 0x3a1f6e });     // right funnel → pivot
  // NOTE: the launch ball is steered into the playfield by a deterministic
  // "lane-exit gate" in the physics step (see LANE_EXIT_Z), not by a passive
  // deflector wall — passive reflection proved direction-unreliable.

  // ── slingshots (angled kickers above each flipper, pulled OFF-CENTRE so they
  //    never block the central drain channel) ──────────────────────────────
  function makeSlingLight(x, z) {
    const l = new THREE.PointLight(0xff4bd0, 0, 4, 2);
    l.position.set(x, 1.2, z);
    table.add(l);
    return { light: l, t: 0 };
  }
  function slingshot(side) {
    const s = side; // -1 left, +1 right
    const ax = s * 1.7, az = 1.7;      // outer-upper (≥0.8 clear of the funnel guide = passable inlane)
    const bx = s * 1.0, bz = 2.7;      // inner-lower (x=±1.0 keeps centre channel ≈2.0 clear)
    wall(ax, az, bx, bz, { e: 0.55, kick: 5.5, score: 50, color: 0x8b2fc0, glow: 0xc24be8, h: 0.7 });
    segs[segs.length - 1].flash = makeSlingLight((ax + bx) / 2, (az + bz) / 2);
  }
  slingshot(-1);
  slingshot(1);

  // ── pop bumpers (classic round, light up + kick) ────────────────────────
  function popBumper(x, z, color) {
    const r = 0.62;
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    // base ring
    g.add(cyl(r, r + 0.06, 0.18, 16, 0x1a0e36, 0, 0.09, 0));
    // glowing cap
    const cap = cyl(r - 0.12, r - 0.02, 0.42, 16, color, 0, 0.4, 0, { e: color, ei: 0.55 });
    g.add(cap);
    g.add(cyl(0.14, 0.14, 0.18, 10, 0xfff6cf, 0, 0.66, 0, { e: 0xfff6cf, ei: 0.9 }));
    table.add(g);
    const light = new THREE.PointLight(color, 0.5, 5, 2);
    light.position.set(x, 1.4, z);
    table.add(light);
    circles.push({ x, z, r, e: 0.5, kick: 5.0, score: 100, mesh: g, cap, light, kind: 'pop', punch: 0 });
  }
  popBumper(-1.3, TOP + 3.6, 0x2fd0ff);
  popBumper(1.3, TOP + 3.6, 0xffd23f);
  popBumper(0, TOP + 5.2, 0x8bff5a);

  // ── monster bumpers (scaled creatures = high-value targets) ──────────────
  // face = base yaw (0 = looking straight at the camera/+z). Each creature gets
  // its own orientation so the table feels alive instead of a row of clones —
  // the side monsters turn inward toward the action.
  function monsterBumper(x, z, key, face = 0) {
    const fig = MONSTERS[key]();
    const SCALE = 0.62;                 // bigger, more readable creatures
    fig.scale.setScalar(SCALE);
    fig.position.set(x, 0.0, z);
    fig.rotation.y = face;
    table.add(fig);
    // limb rig (hip + shoulder pivot groups) so hits flail the actual arms/legs
    const rig = fig.userData.rig || null;
    const armBase = fig.userData.armBase || 0;
    // glow post under the monster
    const post = cyl(0.6, 0.7, 0.16, 14, 0x40206e, 0, 0.08, 0, { e: 0x6a2fae, ei: 0.4 });
    post.position.set(x, 0, z);
    table.add(post);
    const light = new THREE.PointLight(0xff5a8a, 0.0, 4, 2);
    light.position.set(x, 1.6, z);
    table.add(light);
    circles.push({ x, z, r: 0.66, e: 0.45, kick: 5.5, score: 250, mesh: fig, light, kind: 'monster', punch: 0, base: SCALE, face, rig, armBase });
  }
  monsterBumper(-2.0, TOP + 1.6, 'vampire',  0.5);   // left → turned inward-right
  monsterBumper(0,    TOP + 1.4, 'werewolf', 0.0);   // centre → straight at player
  monsterBumper(2.0,  TOP + 1.6, 'zombie',  -0.5);   // right → turned inward-left
  monsterBumper(-1.6, TOP + 6.4, 'skeleton', 0.8);   // lower-left → facing up the table
  monsterBumper(1.6,  TOP + 6.4, 'skeleton', -0.8);  // lower-right → facing up the table

  // ── flippers ────────────────────────────────────────────────────────────
  function makeFlipper(side) {
    const s = side;
    const px = s * PIVOT_X, pz = PIVOT_Z;
    // rest: tip points inward + gently down (leaves a ~1.1 centre gap); active: swings up
    const rest   = s < 0 ? 0.42 : (Math.PI - 0.42);
    const active = s < 0 ? -0.45 : (Math.PI + 0.45);
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
  const LANE_EXIT_Z = TOP + 2.6;   // when the plunged ball rises past this in the lane, gate it left

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
  };
  hud.setBest && hud.setBest(state.best);
  hud.setPhase('preroll');

  function resetBall() {
    ball.x = LANE_CX; ball.z = BOTTOM - 0.6;
    ball.vx = 0; ball.vz = 0; ball.live = false; ball.gated = false;
    state.launchT = 0.7;
  }
  function plunge() {
    ball.live = true;
    ball.vx = (Math.random() - 0.5) * 0.4;
    ball.vz = -25;         // rocket up the lane
    audio.launch();
  }

  function startGameRun() {
    state.mode = 'play';
    state.score = 0; state.balls = 3; state.mult = 1; state.comboT = 0;
    hud.setScore(0); hud.setBalls(3); hud.setMult(1);
    hud.setPhase('play');
    audio.prime(); audio.hum(true);
    resetBall();
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
    if (s.score) { addScore(s.score); bump(); audio.sling(); if (s.flash) { s.flash.t = 0.18; s.flash.light.intensity = 3; } }
  }
  function collideCircle(c) {
    const dx = ball.x - c.x, dz = ball.z - c.z;
    const d2 = dx * dx + dz * dz; const R = BALL_R + c.r;
    if (d2 >= R * R) return;
    const d = Math.sqrt(d2) || 1e-6;
    const nx = dx / d, nz = dz / d;
    ball.x += nx * (R - d); ball.z += nz * (R - d);
    const vn = ball.vx * nx + ball.vz * nz;
    if (vn < 0) { ball.vx -= (1 + c.e) * vn * nx; ball.vz -= (1 + c.e) * vn * nz; }
    ball.vx += nx * c.kick; ball.vz += nz * c.kick;
    addScore(c.score); bump();
    c.punch = 1;
    if (c.light) c.light.intensity = 3.2;
    if (c.kind === 'monster') audio.monster(); else audio.pop();
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
      ball.vx *= 0.9988; ball.vz *= 0.9988;
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
      // launch-lane exit gate: the moment the plunged ball clears the top of the
      // lane, inject it cleanly into the playfield, heading down-left into play.
      // (Deterministic, fires once per ball — passive deflectors were unreliable.)
      if (!ball.gated && ball.x > HW && ball.z < LANE_EXIT_Z) {
        ball.gated = true;
        ball.x = HW - 0.7;                 // unambiguously inside the field, clear of the divider
        ball.vx = -3 - Math.random() * 3;  // drift left
        ball.vz = 7;                        // head down into the bumpers
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

    // bumper punch + light decay
    for (const c of circles) {
      if (c.punch > 0) {
        c.punch = Math.max(0, c.punch - dt * (c.kind === 'monster' ? 3.2 : 5));
        if (c.kind === 'pop') {
          c.mesh.scale.setScalar(1 + c.punch * 0.18);
        } else if (c.kind === 'monster') {
          // got bashed: flail the actual ARMS + LEGS (not just bounce the model)
          const p = c.punch;
          const flail = Math.sin(p * 30);            // fast oscillation that eases out with p
          if (c.rig) {
            // arms throw up + splay out, with a flailing wave
            c.rig.armL.rotation.x = c.armBase - 2.3 * p + flail * 0.6 * p;
            c.rig.armR.rotation.x = c.armBase - 2.3 * p - flail * 0.6 * p;
            c.rig.armL.rotation.z =  1.3 * p;
            c.rig.armR.rotation.z = -1.3 * p;
            // legs kick out alternately
            c.rig.legL.rotation.x =  flail * 0.9 * p;
            c.rig.legR.rotation.x = -flail * 0.9 * p;
          }
          // small whole-body recoil so it reads as "knocked", limbs do the rest
          c.mesh.position.y = Math.sin(p * Math.PI) * 0.15;
          c.mesh.rotation.z = flail * 0.12 * p;
        }
      } else if (c.kind === 'monster') {
        // settle limbs back to rest
        if (c.rig) {
          c.rig.armL.rotation.set(c.armBase, 0, 0); c.rig.armR.rotation.set(c.armBase, 0, 0);
          c.rig.legL.rotation.set(0, 0, 0); c.rig.legR.rotation.set(0, 0, 0);
        }
        c.mesh.rotation.z = 0; c.mesh.position.y = 0;
      }
      if (c.light) c.light.intensity = Math.max(c.kind === 'pop' ? 0.5 : 0.0, c.light.intensity - dt * 7);
    }
    // slingshot light decay
    for (const s of segs) {
      if (s.flash && s.flash.t > 0) { s.flash.t -= dt; s.flash.light.intensity = Math.max(0, s.flash.t * 16); }
    }

    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  }
  loop();

  // expose for debug / screenshots / "play again"
  window.__mb = {
    scene, camera, renderer, ball, flippers, circles, segs, state, audio,
    gameplay: { reset },
    plunge, startGameRun,
  };
}
