import express from 'express';
import http from 'http';
import cors from 'cors';
import compression from 'compression';
import { Server as SocketIOServer } from 'socket.io';
import { v4 as uuidv4 } from 'uuid';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(cors());
app.use(compression());

// Serve built client
const clientDistPath = path.join(__dirname, '../client/dist');
app.use(express.static(clientDistPath));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*'}
});

const TICK_RATE_HZ = 20;
const WORLD_BROADCAST_INTERVAL_MS = Math.floor(1000 / TICK_RATE_HZ);
const PLAYER_RADIUS = 0.6;
const MAX_HEALTH = 100;

// Weapons
const WEAPONS = {
  rifle: { cooldownMs: 180, pellets: 1, spread: 0.0, damage: 25, range: 120 },
  shotgun: { cooldownMs: 800, pellets: 8, spread: 0.06, damage: 12, range: 40 },
  rocket: { cooldownMs: 900, speed: 45, ttlMs: 3000, splashRadius: 6, splashMax: 85 },
  rail: { cooldownMs: 1200, pellets: 1, spread: 0.0, damage: 90, range: 300, pierce: true }
};

/** @type {Map<string, any>} */
const players = new Map();
/** @type {Map<string, any>} */
const projectiles = new Map();

const arenaSpawns = [
  { x: 0, y: 1.6, z: 0 },
  { x: 10, y: 1.6, z: 10 },
  { x: -12, y: 1.6, z: 8 },
  { x: 15, y: 1.6, z: -14 },
  { x: -18, y: 1.6, z: -6 },
  { x: 6, y: 1.6, z: -12 },
];

function randomSpawn() {
  return arenaSpawns[Math.floor(Math.random() * arenaSpawns.length)];
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function vectorLength(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function normalize(v) {
  const len = vectorLength(v);
  if (len === 0) return { x: 0, y: 0, z: 0 };
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function subtract(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function add(a, b) {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

function scale(v, s) {
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

// Distance from point p to ray (o + t*d), clamped to segment length `range`
function distancePointToRay(p, o, d, range) {
  const op = subtract(p, o);
  const tRaw = dot(op, d);
  const t = clamp(tRaw, 0, range);
  const closest = { x: o.x + d.x * t, y: o.y + d.y * t, z: o.z + d.z * t };
  const diff = subtract(p, closest);
  return Math.sqrt(dot(diff, diff));
}

function raycastFirstHit(origin, direction, range, excludeId) {
  let best = null;
  for (const [otherId, target] of players.entries()) {
    if (excludeId && otherId === excludeId) continue;
    const dist = distancePointToRay(target.position, origin, direction, range);
    if (dist <= PLAYER_RADIUS) {
      const toTarget = subtract(target.position, origin);
      const forward = dot(toTarget, direction);
      if (forward < 0 || forward > range) continue;
      if (!best || forward < best.forward) best = { target, forward };
    }
  }
  return best;
}

function raycastAllHits(origin, direction, range, excludeId) {
  const hits = [];
  for (const [otherId, target] of players.entries()) {
    if (excludeId && otherId === excludeId) continue;
    const dist = distancePointToRay(target.position, origin, direction, range);
    if (dist <= PLAYER_RADIUS) {
      const toTarget = subtract(target.position, origin);
      const forward = dot(toTarget, direction);
      if (forward < 0 || forward > range) continue;
      hits.push({ target, forward });
    }
  }
  hits.sort((a, b) => a.forward - b.forward);
  return hits;
}

function broadcastWorld() {
  const payload = {
    players: Array.from(players.values()).map(p => ({
      id: p.id,
      name: p.name,
      position: p.position,
      rotation: p.rotation,
      health: p.health,
      weapon: p.currentWeapon,
      kills: p.kills,
      deaths: p.deaths,
    })),
    projectiles: Array.from(projectiles.values()).map(pr => ({ id: pr.id, position: pr.position }))
  };
  io.emit('world', payload);
}

io.on('connection', (socket) => {
  const id = socket.id;
  const name = (socket.handshake.query?.name || `Player-${uuidv4().slice(0, 4)}`).toString();
  const spawn = randomSpawn();
  const player = {
    id,
    name,
    position: { ...spawn },
    rotation: { x: 0, y: 0, z: 0 },
    health: MAX_HEALTH,
    lastShootAtByWeapon: {},
    currentWeapon: 'rifle',
    inventory: { rifle: true, shotgun: true, rocket: true, rail: true },
    kills: 0,
    deaths: 0,
    joinedAt: Date.now(),
  };
  players.set(id, player);

  socket.emit('init', {
    id,
    you: player,
    players: Array.from(players.values())
  });

  socket.on('state', (data) => {
    const p = players.get(id);
    if (!p) return;
    if (data?.position && Number.isFinite(data.position.x)) {
      p.position = {
        x: clamp(data.position.x, -1000, 1000),
        y: clamp(data.position.y, -10, 1000),
        z: clamp(data.position.z, -1000, 1000),
      };
    }
    if (data?.rotation && Number.isFinite(data.rotation.y)) {
      p.rotation = {
        x: clamp(data.rotation.x ?? 0, -Math.PI, Math.PI),
        y: clamp(data.rotation.y ?? 0, -Math.PI, Math.PI),
        z: 0,
      };
    }
    if (typeof data?.weapon === 'string') {
      if (p.inventory[data.weapon]) p.currentWeapon = data.weapon;
    }
  });

  socket.on('shoot', (data) => {
    const shooter = players.get(id);
    if (!shooter) return;

    const weaponKey = (data?.weapon || shooter.currentWeapon);
    const weapon = WEAPONS[weaponKey];
    if (!weapon) return;
    if (!shooter.inventory[weaponKey]) return;

    const now = Date.now();
    const last = shooter.lastShootAtByWeapon[weaponKey] || 0;
    if (now - last < weapon.cooldownMs) return;
    shooter.lastShootAtByWeapon[weaponKey] = now;

    if (!data || !data.origin || !data.direction) return;

    const origin = {
      x: Number(data.origin.x) || shooter.position.x,
      y: Number(data.origin.y) || shooter.position.y,
      z: Number(data.origin.z) || shooter.position.z,
    };
    const baseDir = normalize({
      x: Number(data.direction.x) || 0,
      y: Number(data.direction.y) || 0,
      z: Number(data.direction.z) || 1,
    });

    if (weaponKey === 'rocket') {
      const idProj = uuidv4();
      const projectile = {
        id: idProj,
        owner: shooter.id,
        position: { ...origin },
        velocity: scale(baseDir, weapon.speed),
        ttlAt: now + weapon.ttlMs,
      };
      projectiles.set(idProj, projectile);
      io.emit('projectile_spawn', { id: idProj, owner: shooter.id, position: projectile.position });
      return;
    }

    // Hitscan weapons
    if (weapon.pierce) {
      const hits = raycastAllHits(origin, baseDir, weapon.range, shooter.id);
      for (const h of hits) {
        const target = h.target;
        const wasAlive = target.health > 0;
        target.health = Math.max(0, target.health - weapon.damage);
        io.to(target.id).emit('hit', { health: target.health, by: shooter.id });
        io.to(shooter.id).emit('confirm_hit', { targetId: target.id, remaining: target.health });
        if (wasAlive && target.health <= 0) {
          shooter.kills += 1;
          target.deaths += 1;
          const newSpawn = randomSpawn();
          target.position = { ...newSpawn };
          target.health = MAX_HEALTH;
          io.to(target.id).emit('died', { respawn: newSpawn, killerId: shooter.id });
        }
      }
      return;
    }

    /** @type {Map<string, number>} */
    const damageByTarget = new Map();
    for (let i = 0; i < weapon.pellets; i++) {
      const spreadX = (Math.random() * 2 - 1) * weapon.spread;
      const spreadY = (Math.random() * 2 - 1) * weapon.spread;
      const dir = normalize({ x: baseDir.x + spreadX, y: baseDir.y + spreadY, z: baseDir.z });
      const hit = raycastFirstHit(origin, dir, weapon.range, shooter.id);
      if (hit) {
        const prev = damageByTarget.get(hit.target.id) || 0;
        damageByTarget.set(hit.target.id, prev + weapon.damage);
      }
    }

    for (const [targetId, dmg] of damageByTarget.entries()) {
      const target = players.get(targetId);
      if (!target) continue;
      const wasAlive = target.health > 0;
      target.health = Math.max(0, target.health - Math.round(dmg));
      io.to(target.id).emit('hit', { health: target.health, by: shooter.id });
      io.to(shooter.id).emit('confirm_hit', { targetId: target.id, remaining: target.health });
      if (wasAlive && target.health <= 0) {
        shooter.kills += 1;
        target.deaths += 1;
        const newSpawn = randomSpawn();
        target.position = { ...newSpawn };
        target.health = MAX_HEALTH;
        io.to(target.id).emit('died', { respawn: newSpawn, killerId: shooter.id });
      }
    }
  });

  socket.on('disconnect', () => {
    players.delete(id);
  });
});

setInterval(() => {
  const now = Date.now();
  const dt = WORLD_BROADCAST_INTERVAL_MS / 1000;

  // Projectiles step
  for (const [projId, pr] of Array.from(projectiles.entries())) {
    pr.position = add(pr.position, scale(pr.velocity, dt));

    // explode on floor or ttl
    let shouldExplode = pr.position.y <= 0.5 || now >= pr.ttlAt;

    // proximity explode near any player
    if (!shouldExplode) {
      for (const [pid, pl] of players.entries()) {
        if (pid === pr.owner) continue;
        const dx = pl.position.x - pr.position.x;
        const dy = (pl.position.y) - pr.position.y;
        const dz = pl.position.z - pr.position.z;
        const d2 = dx*dx + dy*dy + dz*dz;
        if (d2 <= 1.0) { shouldExplode = true; break; }
      }
    }

    if (shouldExplode) {
      // Splash damage
      const weapon = WEAPONS.rocket;
      for (const pl of players.values()) {
        const dx = pl.position.x - pr.position.x;
        const dy = (pl.position.y) - pr.position.y;
        const dz = pl.position.z - pr.position.z;
        const d = Math.sqrt(dx*dx + dy*dy + dz*dz);
        if (d <= weapon.splashRadius) {
          const t = 1 - (d / weapon.splashRadius);
          const dmg = Math.round(t * weapon.splashMax);
          if (dmg > 0) {
            const wasAlive = pl.health > 0;
            pl.health = Math.max(0, pl.health - dmg);
            io.to(pl.id).emit('hit', { health: pl.health, by: pr.owner });
            io.to(pr.owner).emit('confirm_hit', { targetId: pl.id, remaining: pl.health });
            if (wasAlive && pl.health <= 0) {
              const killer = players.get(pr.owner);
              if (killer) killer.kills += 1;
              pl.deaths += 1;
              const newSpawn = randomSpawn();
              pl.position = { ...newSpawn };
              pl.health = MAX_HEALTH;
              io.to(pl.id).emit('died', { respawn: newSpawn, killerId: pr.owner });
            }
          }
        }
      }
      io.emit('projectile_explode', { id: pr.id, position: pr.position });
      projectiles.delete(projId);
    }
  }

  broadcastWorld();
}, WORLD_BROADCAST_INTERVAL_MS);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`[server] listening on port ${PORT}`);
  console.log('[server] if client is built, open http://localhost:' + PORT);
}); 