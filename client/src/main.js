import * as THREE from 'three';
import { PointerLockControls } from 'three/examples/jsm/controls/PointerLockControls.js';
import io from 'socket.io-client';

const canvas = document.getElementById('bg');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0d0f14);
scene.fog = new THREE.Fog(0x0d0f14, 30, 120);

const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 500);
const controls = new PointerLockControls(camera, document.body);
camera.position.set(0, 1.6, 5);

const ambient = new THREE.AmbientLight(0xffffff, 0.35);
scene.add(ambient);
const dir = new THREE.DirectionalLight(0xffffff, 0.7);
dir.position.set(10, 20, 10);
scene.add(dir);

// Floor
const floorGeo = new THREE.PlaneGeometry(100, 100);
const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a1f2b, metalness: 0.1, roughness: 0.9 });
const floor = new THREE.Mesh(floorGeo, floorMat);
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

// Arena walls
const worldColliders = [floor];
const wallMat = new THREE.MeshStandardMaterial({ color: 0x242a3a, metalness: 0.15, roughness: 0.85 });
const wallSize = 100; // match floor
const wallHeight = 6;
function addWall(x, z, rotY) {
  const geo = new THREE.BoxGeometry(wallSize, wallHeight, 1);
  const mesh = new THREE.Mesh(geo, wallMat);
  mesh.position.set(x, wallHeight / 2, z);
  mesh.rotation.y = rotY;
  scene.add(mesh);
  worldColliders.push(mesh);
}
addWall(0, -wallSize / 2, 0);
addWall(0, wallSize / 2, 0);
addWall(-wallSize / 2, 0, Math.PI / 2);
addWall(wallSize / 2, 0, Math.PI / 2);

// Simple walls/boxes (fixed layout for meaningful cover)
const boxMat = new THREE.MeshStandardMaterial({ color: 0x30364a, metalness: 0.2, roughness: 0.8 });
const boxPositions = [
  { x: -20, y: 1, z: -20 }, { x: 0, y: 1, z: -20 }, { x: 20, y: 1, z: -20 },
  { x: -25, y: 1, z: 0 },   { x: -12, y: 1, z: 5 }, { x: 12, y: 1, z: -6 },
  { x: 25, y: 1, z: 0 },    { x: -18, y: 1, z: 18 }, { x: 0, y: 1, z: 20 },
  { x: 18, y: 1, z: 18 }
];
for (const p of boxPositions) {
  const box = new THREE.Mesh(new THREE.BoxGeometry(3, 2.5, 3), boxMat);
  box.position.set(p.x, p.y, p.z);
  scene.add(box);
  worldColliders.push(box);
}

// Effects manager (tracers, flashes, sparks)
const effects = [];
function addTimedEffect(object3d, ttlMs = 120, fade = true) {
  const start = performance.now();
  const end = start + ttlMs;
  effects.push({ obj: object3d, start, end, fade });
  scene.add(object3d);
}

function updateEffects(now) {
  for (let i = effects.length - 1; i >= 0; i--) {
    const e = effects[i];
    const t = (e.end - now) / (e.end - e.start);
    if (e.fade) {
      const mat = e.obj.material;
      if (mat && 'opacity' in mat) {
        mat.opacity = Math.max(0, Math.min(1, t));
      }
    }
    if (now >= e.end) {
      scene.remove(e.obj);
      if (e.obj.geometry) e.obj.geometry.dispose?.();
      if (e.obj.material) {
        if (Array.isArray(e.obj.material)) e.obj.material.forEach(m => m.dispose?.());
        else e.obj.material.dispose?.();
      }
      effects.splice(i, 1);
    }
  }
}

function createTracer(start, end, color = 0xffee88, radius = 0.03) {
  const dirVec = new THREE.Vector3().subVectors(end, start);
  const length = dirVec.length();
  if (length <= 0.001) return null;
  const geom = new THREE.CylinderGeometry(radius, radius, length, 8, 1, true);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
  const mesh = new THREE.Mesh(geom, mat);
  const up = new THREE.Vector3(0, 1, 0);
  const quat = new THREE.Quaternion().setFromUnitVectors(up, dirVec.clone().normalize());
  mesh.quaternion.copy(quat);
  mesh.position.copy(new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5));
  return mesh;
}

function createRailTracer(start, end) {
  return createTracer(start, end, 0x66aaff, 0.02);
}

function createRailFlash(origin, dir) {
  return createMuzzleFlash(origin, dir, 0x66aaff);
}

function createMuzzleFlash(origin, dir, color = 0xffcc66) {
  const geom = new THREE.SphereGeometry(0.08, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
  const sphere = new THREE.Mesh(geom, mat);
  sphere.position.copy(origin).add(dir.clone().multiplyScalar(0.2));
  return sphere;
}

function createImpactSpark(point, color = 0xffeeaa) {
  const geom = new THREE.SphereGeometry(0.06, 8, 8);
  const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
  const spr = new THREE.Mesh(geom, mat);
  spr.position.copy(point);
  return spr;
}

function createRocketMesh(position) {
  const geom = new THREE.SphereGeometry(0.14, 12, 12);
  const mat = new THREE.MeshBasicMaterial({ color: 0xff5522, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(position);
  return mesh;
}

function createExplosion(position) {
  const geom = new THREE.SphereGeometry(0.3, 16, 16);
  const mat = new THREE.MeshBasicMaterial({ color: 0xffcc66, transparent: true, opacity: 1, depthWrite: false, blending: THREE.AdditiveBlending });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.copy(position);
  const start = performance.now();
  const life = 260;
  const end = start + life;
  effects.push({ obj: mesh, start, end, fade: true });
  scene.add(mesh);
  return mesh;
}

// Simple WebAudio sounds
let audioCtx = null;
function initAudio() {
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playRifleShot() {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'square';
  osc.frequency.setValueAtTime(260, t0);
  osc.frequency.exponentialRampToValueAtTime(60, t0 + 0.08);
  gain.gain.setValueAtTime(0.25, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.12);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.12);
}

function playShotgun() {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  const noiseBuffer = audioCtx.createBuffer(1, 22050, 44100);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 900;
  const gain = audioCtx.createGain();
  gain.gain.value = 0.6;
  src.connect(filter).connect(gain).connect(audioCtx.destination);
  src.start(t0);
}

function playRocketLaunch() {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(110, t0);
  osc.frequency.linearRampToValueAtTime(140, t0 + 0.15);
  gain.gain.setValueAtTime(0.3, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.25);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.25);
}

function playRail() {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(900, t0);
  osc.frequency.linearRampToValueAtTime(400, t0 + 0.18);
  gain.gain.setValueAtTime(0.25, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.2);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t0);
  osc.stop(t0 + 0.2);
}

function playExplosion() {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  const noiseBuffer = audioCtx.createBuffer(1, 22050, 44100);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = audioCtx.createBufferSource();
  src.buffer = noiseBuffer;
  const lp = audioCtx.createBiquadFilter();
  lp.type = 'lowpass'; lp.frequency.value = 500;
  const gain = audioCtx.createGain();
  gain.gain.setValueAtTime(0.5, t0);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.6);
  src.connect(lp).connect(gain).connect(audioCtx.destination);
  src.start(t0);
}

function playHit() {
  if (!audioCtx) return;
  const t0 = audioCtx.currentTime;
  const noiseBuffer = audioCtx.createBuffer(1, 11025, 44100);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
  const src = audioCtx.createBufferSource();
  const bp = audioCtx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 1200;
  const gain = audioCtx.createGain();
  gain.gain.value = 0.25;
  src.buffer = noiseBuffer;
  src.connect(bp).connect(gain).connect(audioCtx.destination);
  src.start(t0);
}

// Networking
const socket = io();
let myId = null;
let myHealth = 100;
const otherPlayers = new Map(); // id -> { mesh, hpBg, hpFg, name }
const projectileMeshes = new Map(); // id -> mesh
// removed pickups

// UI elements
const healthEl = document.getElementById('health');
const weaponEl = document.getElementById('weapon');
const lbEl = document.getElementById('leaderboard');
function updateHealth(hp) {
  myHealth = hp;
  healthEl.textContent = `HP: ${Math.round(hp)}`;
}
function updateWeaponLabel() {
  weaponEl && (weaponEl.textContent = `Weapon: ${currentWeapon}`);
}
function updateLeaderboard(players) {
  if (!lbEl) return;
  const sorted = [...players].sort((a, b) => {
    if ((b.kills||0) !== (a.kills||0)) return (b.kills||0) - (a.kills||0);
    return (a.deaths||0) - (b.deaths||0);
  });
  lbEl.innerHTML = sorted.map(p => {
    const youMark = p.id === myId ? ' (you)' : '';
    return `<div class="lb-row"><span class="lb-name">${p.name}${youMark}</span><span class="lb-score">${p.kills||0}/${p.deaths||0}</span></div>`;
  }).join('');
}

function createHpBar() {
  const group = new THREE.Group();
  const width = 1.2, height = 0.12;
  const bgGeo = new THREE.PlaneGeometry(width, height);
  const bgMat = new THREE.MeshBasicMaterial({ color: 0x22262f, transparent: true, opacity: 0.7, depthWrite: false });
  const bg = new THREE.Mesh(bgGeo, bgMat);
  const fgGeo = new THREE.PlaneGeometry(width, height);
  const fgMat = new THREE.MeshBasicMaterial({ color: 0x6cff8d, transparent: true, opacity: 0.95, depthWrite: false });
  const fg = new THREE.Mesh(fgGeo, fgMat);
  fg.position.z = 0.001;
  group.add(bg);
  group.add(fg);
  group.userData = { width, height, fg };
  return group;
}

function setHpBarValue(group, ratio) {
  const clamped = Math.max(0, Math.min(1, ratio));
  const { width, fg } = group.userData;
  fg.scale.x = clamped;
  fg.position.x = -width * 0.5 * (1 - clamped) + (width * clamped) * 0.5;
  if (clamped > 0.66) fg.material.color.set(0x6cff8d);
  else if (clamped > 0.33) fg.material.color.set(0xffe066);
  else fg.material.color.set(0xff6b6b);
}

function addPlayer(player) {
  if (player.id === myId) return;
  if (otherPlayers.has(player.id)) return;
  const color = new THREE.Color().setHSL(Math.random(), 0.6, 0.5);
  const material = new THREE.MeshStandardMaterial({ color });
  const mesh = new THREE.Mesh(new THREE.CapsuleGeometry(0.5, 1.2, 4, 8), material);
  mesh.position.set(player.position.x, player.position.y - 0.8, player.position.z);
  scene.add(mesh);
  const hp = createHpBar();
  scene.add(hp);
  otherPlayers.set(player.id, { mesh, hpBg: hp, hpFg: hp.userData.fg, name: player.name });
}

function removePlayer(id) {
  const p = otherPlayers.get(id);
  if (!p) return;
  scene.remove(p.mesh);
  scene.remove(p.hpBg);
  otherPlayers.delete(id);
}

function createItemMesh(item) {
  let color = 0x66ff99;
  if (item.type === 'shotgun') color = 0xffaa66;
  if (item.type === 'rocket') color = 0xff5566;
  const geom = new THREE.TorusKnotGeometry(0.4, 0.12, 64, 8);
  const mat = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.2, metalness: 0.0, roughness: 0.6 });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.position.set(item.position.x, item.position.y, item.position.z);
  mesh.visible = !!item.active;
  return mesh;
}

socket.on('connect', () => {
  // nothing yet
});

socket.on('init', (data) => {
  myId = data.id;
  camera.position.set(data.you.position.x, data.you.position.y, data.you.position.z);
  updateHealth(data.you.health);
  if (data.you.currentWeapon) currentWeapon = data.you.currentWeapon;
  updateWeaponLabel();
  data.players.forEach(addPlayer);
  updateLeaderboard(data.players || []);
  // no items anymore
});

socket.on('world', (payload) => {
  const seen = new Set();
  for (const p of payload.players) {
    seen.add(p.id);
    if (p.id === myId) {
      continue;
    }
    if (!otherPlayers.has(p.id)) addPlayer(p);
    const op = otherPlayers.get(p.id);
    op.mesh.position.set(p.position.x, p.position.y - 0.8, p.position.z);
    op.mesh.rotation.y = p.rotation.y;
    // hp bar position above head and face camera
    const hp = op.hpBg;
    hp.position.set(p.position.x, p.position.y + 1.2, p.position.z);
    hp.lookAt(camera.position);
    setHpBarValue(hp, (p.health ?? 100) / 100);
  }
  for (const id of Array.from(otherPlayers.keys())) {
    if (!seen.has(id)) removePlayer(id);
  }
  // projectiles update (positions only)
  for (const pr of (payload.projectiles || [])) {
    const mesh = projectileMeshes.get(pr.id);
    if (mesh) mesh.position.set(pr.position.x, pr.position.y, pr.position.z);
  }
  updateLeaderboard(payload.players || []);
});

socket.on('projectile_spawn', (data) => {
  if (projectileMeshes.has(data.id)) return;
  const mesh = createRocketMesh(new THREE.Vector3(data.position.x, data.position.y, data.position.z));
  projectileMeshes.set(data.id, mesh);
  scene.add(mesh);
});

socket.on('projectile_explode', (data) => {
  const mesh = projectileMeshes.get(data.id);
  if (mesh) {
    scene.remove(mesh);
    projectileMeshes.delete(data.id);
  }
  createExplosion(new THREE.Vector3(data.position.x, data.position.y, data.position.z));
  playExplosion();
});

// remove item events
// socket.on('item_update', ...)
// socket.on('pickup', ...)

socket.on('hit', (data) => {
  updateHealth(data.health);
  playHit();
});

socket.on('died', (data) => {
  updateHealth(100);
  camera.position.set(data.respawn.x, data.respawn.y, data.respawn.z);
});

socket.on('confirm_hit', (_data) => {
  // can add hit marker later
});

// Movement
const move = { forward: false, backward: false, left: false, right: false };
const speed = 11.5; // increased run speed
let lastSentAt = 0;

// Weapons
let currentWeapon = 'rifle';
updateWeaponLabel();
// Local cooldowns to match server; prevent SFX/FX if on cooldown
const weaponCooldownMs = { rifle: 180, shotgun: 800, rocket: 900, rail: 1200 };
const lastShotAtByWeapon = new Map();

// Jumping physics
const groundHeight = 1.6; // camera eye height when standing on ground level y=0
const gravity = 20; // m/s^2
let velocityY = 0; // vertical velocity
let canJump = true;

// Arena bounds clamp
const half = wallSize / 2 - 1.0; // keep slightly inside walls
function clampToArena(vec3) {
  vec3.x = Math.max(-half, Math.min(half, vec3.x));
  vec3.z = Math.max(-half, Math.min(half, vec3.z));
}

// Collision helpers
const playerHalfWidth = 0.5;
const playerHalfHeight = groundHeight; // ensures standing on floor gives eye height 1.6
function makeAabb(pos) {
  const halfVec = new THREE.Vector3(playerHalfWidth, playerHalfHeight, playerHalfWidth);
  const min = new THREE.Vector3().subVectors(pos, halfVec);
  const max = new THREE.Vector3().addVectors(pos, halfVec);
  return new THREE.Box3(min, max);
}
function collidesAt(pos, epsilonY = 0.001) {
  const aabb = makeAabb(pos);
  aabb.min.y += epsilonY; // avoid counting touching top face as intersection
  for (const obj of worldColliders) {
    const box = new THREE.Box3().setFromObject(obj);
    if (aabb.intersectsBox(box)) return box;
  }
  return null;
}
function resolveVertical(posBefore, posAfter) {
  const pos = posAfter.clone();
  const box = collidesAt(pos, 0); // allow true penetration check
  if (box) {
    const feetBefore = posBefore.y - playerHalfHeight;
    const feetAfter = pos.y - playerHalfHeight;
    const topY = box.max.y;
    // Landing on top
    if (velocityY <= 0 && feetBefore >= topY - 0.001 && feetAfter <= topY + 0.01) {
      pos.y = topY + playerHalfHeight;
      velocityY = 0;
      canJump = true;
      return pos;
    }
    // Hitting ceiling when jumping up
    const headAfter = pos.y + playerHalfHeight;
    const bottomY = box.min.y;
    if (velocityY > 0 && headAfter >= bottomY) {
      pos.y = bottomY - playerHalfHeight - 0.001;
      velocityY = 0;
      return pos;
    }
  }
  // Ground clamp for floor baseline
  if (pos.y < groundHeight) {
    pos.y = groundHeight;
    velocityY = 0;
    canJump = true;
  }
  return pos;
}

function onKeyDown(e) {
  switch (e.code) {
    case 'KeyW': move.forward = true; break;
    case 'KeyS': move.backward = true; break;
    case 'KeyA': move.left = true; break;
    case 'KeyD': move.right = true; break;
    case 'Digit1': currentWeapon = 'rifle'; updateWeaponLabel(); break;
    case 'Digit2': currentWeapon = 'shotgun'; updateWeaponLabel(); break;
    case 'Digit3': currentWeapon = 'rocket'; updateWeaponLabel(); break;
    case 'Digit4': currentWeapon = 'rail'; updateWeaponLabel(); break;
    case 'Space':
      if (canJump) {
        velocityY = 11.5; // higher jump impulse
        canJump = false;
      }
      break;
  }
}
function onKeyUp(e) {
  switch (e.code) {
    case 'KeyW': move.forward = false; break;
    case 'KeyS': move.backward = false; break;
    case 'KeyA': move.left = false; break;
    case 'KeyD': move.right = false; break;
  }
}

document.body.addEventListener('click', () => {
  if (!controls.isLocked) controls.lock();
  initAudio();
});
window.addEventListener('keydown', onKeyDown);
window.addEventListener('keyup', onKeyUp);

let lastTime = performance.now();
function loop() {
  requestAnimationFrame(loop);
  const now = performance.now();
  const dt = Math.min(0.05, (now - lastTime) / 1000);
  lastTime = now;

  updateEffects(now);

  if (controls.isLocked) {
    // desired horizontal move
    const forwardDir = new THREE.Vector3();
    const rightDir = new THREE.Vector3();
    camera.getWorldDirection(forwardDir);
    forwardDir.y = 0; forwardDir.normalize();
    rightDir.crossVectors(forwardDir, new THREE.Vector3(0,1,0)).normalize();
    let moveH = new THREE.Vector3();
    if (move.forward) moveH.add(forwardDir);
    if (move.backward) moveH.addScaledVector(forwardDir, -1);
    if (move.left) moveH.addScaledVector(rightDir, -1);
    if (move.right) moveH.add(rightDir);
    if (moveH.lengthSq() > 0) moveH.normalize().multiplyScalar(speed * dt);

    // vertical step
    velocityY -= gravity * dt;
    let pos = camera.position.clone();
    pos.y += velocityY * dt;
    pos = resolveVertical(camera.position, pos);

    // horizontal step axis-by-axis with collision tests
    // X axis
    if (moveH.x !== 0) {
      const next = pos.clone(); next.x += moveH.x; clampToArena(next);
      if (!collidesAt(next)) pos = next;
    }
    // Z axis
    if (moveH.z !== 0) {
      const next = pos.clone(); next.z += moveH.z; clampToArena(next);
      if (!collidesAt(next)) pos = next;
    }

    camera.position.copy(pos);

    // send state at ~120 Hz
    if (now - lastSentAt > 8) {
      lastSentAt = now;
      socket.emit('state', {
        position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
        rotation: { x: 0, y: controls.getObject().rotation.y, z: 0 },
        weapon: currentWeapon,
      });
    }
  }

  renderer.render(scene, camera);
}
loop();

// Shooting with per-weapon effects (respect cooldowns)
window.addEventListener('mousedown', (e) => {
  if (!controls.isLocked) return;
  if (e.button !== 0) return;

  const cooldown = weaponCooldownMs[currentWeapon] || 0;
  const now = performance.now();
  const last = lastShotAtByWeapon.get(currentWeapon) || 0;
  if (now - last < cooldown) return; // on cooldown: no sound/effects/emit
  lastShotAtByWeapon.set(currentWeapon, now);

  const origin = new THREE.Vector3();
  origin.copy(camera.position);
  const direction = new THREE.Vector3();
  camera.getWorldDirection(direction);

  if (currentWeapon === 'rifle') {
    const maxLen = 120;
    const rc = new THREE.Raycaster(origin, direction, 0, maxLen);
    const hit = rc.intersectObjects(worldColliders, false)[0];
    const end = hit ? hit.point.clone() : origin.clone().add(direction.clone().multiplyScalar(maxLen));
    const tracer = createTracer(origin, end, 0xffe480, 0.022);
    if (tracer) addTimedEffect(tracer, 120, true);
    addTimedEffect(createMuzzleFlash(origin, direction, 0xffe480), 70, true);
    playRifleShot();
  } else if (currentWeapon === 'shotgun') {
    const pellets = 8;
    for (let i = 0; i < pellets; i++) {
      const spreadX = (Math.random() * 2 - 1) * 0.06;
      const spreadY = (Math.random() * 2 - 1) * 0.06;
      const dir = new THREE.Vector3(direction.x + spreadX, direction.y + spreadY, direction.z).normalize();
      const maxLen = 45;
      const rc = new THREE.Raycaster(origin, dir, 0, maxLen);
      const hit = rc.intersectObjects(worldColliders, false)[0];
      const end = hit ? hit.point.clone() : origin.clone().add(dir.clone().multiplyScalar(maxLen));
      const tracer = createTracer(origin, end, 0xff8844, 0.03);
      if (tracer) addTimedEffect(tracer, 120, true);
      if (hit) addTimedEffect(createImpactSpark(hit.point, 0xffaa66), 140, true);
    }
    addTimedEffect(createMuzzleFlash(origin, direction, 0xffaa66), 90, true);
    playShotgun();
  } else if (currentWeapon === 'rocket') {
    addTimedEffect(createMuzzleFlash(origin, direction, 0xff5522), 90, true);
    playRocketLaunch();
  } else if (currentWeapon === 'rail') {
    const maxLen = 300;
    const rc = new THREE.Raycaster(origin, direction, 0, maxLen);
    const hits = rc.intersectObjects(worldColliders, true);
    const end = hits.length ? hits[0].point.clone() : origin.clone().add(direction.clone().multiplyScalar(maxLen));
    const tracer = createRailTracer(origin, end);
    if (tracer) addTimedEffect(tracer, 180, true);
    addTimedEffect(createRailFlash(origin, direction), 90, true);
    playRail();
  }

  socket.emit('shoot', {
    origin: { x: origin.x, y: origin.y, z: origin.z },
    direction: { x: direction.x, y: direction.y, z: direction.z },
    weapon: currentWeapon,
  });
});

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}); 