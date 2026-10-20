import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Game Constants
const FPS = 60;
const PLAYER_SPEED = 3;
const BULLET_SPEED = 8;
const PLAYER_RADIUS = 15;
const BULLET_RADIUS = 3;
const MAP_WIDTH = 800;
const MAP_HEIGHT = 600;
const SHIELD_MAX = 100;

interface Player {
  id: string;
  name: string;
  x: number;
  y: number;
  angle: number;
  shield: number;
  color: string;
  isDead: boolean;
  kills: number;
}

interface Bullet {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  ownerId: string;
}

interface Obstacle {
  x: number;
  y: number;
  width: number;
  height: number;
}

// Game State
const players: Record<string, Player> = {};
let bullets: Bullet[] = [];
const obstacles: Obstacle[] = [
  { x: 100, y: 100, width: 60, height: 200 },
  { x: 640, y: 300, width: 60, height: 200 },
  { x: 300, y: 250, width: 200, height: 60 },
  { x: 180, y: 480, width: 120, height: 60 },
  { x: 500, y: 60, width: 120, height: 60 },
];

// Robust Circle-to-AABB collision check
function checkCircleAABB(cx: number, cy: number, r: number, box: Obstacle): boolean {
  const closestX = Math.max(box.x, Math.min(box.x + box.width, cx));
  const closestY = Math.max(box.y, Math.min(box.y + box.height, cy));
  const dx = cx - closestX;
  const dy = cy - closestY;
  return dx * dx + dy * dy < r * r;
}

// Check if circle collides with ANY obstacle in the arena
function collidesWithAnyObstacle(cx: number, cy: number, r: number): boolean {
  for (const obs of obstacles) {
    if (checkCircleAABB(cx, cy, r, obs)) {
      return true;
    }
  }
  return false;
}

// Resolve any obstacle or boundary overlap by pushing player outside
function resolveOverlap(player: Player) {
  // Push out of obstacles
  for (const obs of obstacles) {
    if (checkCircleAABB(player.x, player.y, PLAYER_RADIUS, obs)) {
      const closestX = Math.max(obs.x, Math.min(obs.x + obs.width, player.x));
      const closestY = Math.max(obs.y, Math.min(obs.y + obs.height, player.y));
      const diffX = player.x - closestX;
      const diffY = player.y - closestY;
      const dist = Math.sqrt(diffX * diffX + diffY * diffY);

      if (dist < 0.001) {
        // Deeply inside box: push to nearest face
        const leftDist = Math.abs(player.x - obs.x);
        const rightDist = Math.abs(player.x - (obs.x + obs.width));
        const topDist = Math.abs(player.y - obs.y);
        const botDist = Math.abs(player.y - (obs.y + obs.height));
        const minEdge = Math.min(leftDist, rightDist, topDist, botDist);

        if (minEdge === leftDist) player.x = obs.x - PLAYER_RADIUS;
        else if (minEdge === rightDist) player.x = obs.x + obs.width + PLAYER_RADIUS;
        else if (minEdge === topDist) player.y = obs.y - PLAYER_RADIUS;
        else player.y = obs.y + obs.height + PLAYER_RADIUS;
      } else {
        const overlap = PLAYER_RADIUS - dist;
        player.x += (diffX / dist) * overlap;
        player.y += (diffY / dist) * overlap;
      }
    }
  }

  // Strictly clamp inside outer arena boundary walls
  player.x = Math.max(PLAYER_RADIUS, Math.min(MAP_WIDTH - PLAYER_RADIUS, player.x));
  player.y = Math.max(PLAYER_RADIUS, Math.min(MAP_HEIGHT - PLAYER_RADIUS, player.y));
}

// Find a safe spawn position with generous clearance
function getSafeSpawnPoint(): { x: number; y: number } {
  for (let attempts = 0; attempts < 100; attempts++) {
    const margin = PLAYER_RADIUS * 3;
    const x = Math.random() * (MAP_WIDTH - margin * 2) + margin;
    const y = Math.random() * (MAP_HEIGHT - margin * 2) + margin;

    if (!collidesWithAnyObstacle(x, y, PLAYER_RADIUS + 15)) {
      return { x, y };
    }
  }
  // Safe fallback corner
  return { x: 50, y: 50 };
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer);
  const PORT = 3000;

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true, hmr: false },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.join(__dirname, "dist")));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(__dirname, "dist", "index.html"));
    });
  }

  // Socket.io Logic
  let guestCount = 1;
  io.on("connection", (socket) => {
    const playerNum = guestCount++;
    const defaultName = `Player #${playerNum}`;
    console.log(`Player connected: ${socket.id} (${defaultName})`);

    // Initialize player with safe spawn
    const spawn = getSafeSpawnPoint();
    players[socket.id] = {
      id: socket.id,
      name: defaultName,
      x: spawn.x,
      y: spawn.y,
      angle: 0,
      shield: SHIELD_MAX,
      color: `hsl(${Math.random() * 360}, 75%, 55%)`,
      isDead: false,
      kills: 0,
    };

    socket.emit("init", {
      id: socket.id,
      name: defaultName,
      obstacles,
      mapSize: { width: MAP_WIDTH, height: MAP_HEIGHT },
    });

    socket.on("setName", (newName: string) => {
      const player = players[socket.id];
      if (player && typeof newName === "string") {
        const trimmed = newName.trim().slice(0, 16);
        if (trimmed.length > 0) {
          player.name = trimmed;
        }
      }
    });

    socket.on("respawn", () => {
      const player = players[socket.id];
      if (player && player.isDead) {
        player.shield = SHIELD_MAX;
        player.isDead = false;
        const respawnLoc = getSafeSpawnPoint();
        player.x = respawnLoc.x;
        player.y = respawnLoc.y;
      }
    });

    socket.on("input", (data: { up: boolean; down: boolean; left: boolean; right: boolean; angle: number }) => {
      const player = players[socket.id];
      if (!player || player.isDead) return;

      player.angle = data.angle;

      let dx = 0;
      let dy = 0;

      if (data.up) dy -= PLAYER_SPEED;
      if (data.down) dy += PLAYER_SPEED;
      if (data.left) dx -= PLAYER_SPEED;
      if (data.right) dx += PLAYER_SPEED;

      // Normalize diagonal movement
      if (dx !== 0 && dy !== 0) {
        const length = Math.sqrt(dx * dx + dy * dy);
        dx = (dx / length) * PLAYER_SPEED;
        dy = (dy / length) * PLAYER_SPEED;
      }

      if (dx === 0 && dy === 0) {
        resolveOverlap(player);
        return;
      }

      // Calculate target clamped strictly to outer arena walls
      const targetX = Math.max(PLAYER_RADIUS, Math.min(MAP_WIDTH - PLAYER_RADIUS, player.x + dx));
      const targetY = Math.max(PLAYER_RADIUS, Math.min(MAP_HEIGHT - PLAYER_RADIUS, player.y + dy));

      // 1. Try moving diagonally
      if (!collidesWithAnyObstacle(targetX, targetY, PLAYER_RADIUS)) {
        player.x = targetX;
        player.y = targetY;
      } else {
        // 2. Wall sliding: check horizontal movement alone
        if (targetX !== player.x && !collidesWithAnyObstacle(targetX, player.y, PLAYER_RADIUS)) {
          player.x = targetX;
        }
        // 3. Wall sliding: check vertical movement alone
        if (targetY !== player.y && !collidesWithAnyObstacle(player.x, targetY, PLAYER_RADIUS)) {
          player.y = targetY;
        }
      }

      // Final pass: ensure player is never inside any obstacle or outside walls
      resolveOverlap(player);
    });

    socket.on("shoot", () => {
      const player = players[socket.id];
      if (!player || player.isDead) return;

      const spawnX = player.x + Math.cos(player.angle) * (PLAYER_RADIUS + 4);
      const spawnY = player.y + Math.sin(player.angle) * (PLAYER_RADIUS + 4);

      // Prevent shooting through a wall or obstacle
      if (
        spawnX <= BULLET_RADIUS ||
        spawnX >= MAP_WIDTH - BULLET_RADIUS ||
        spawnY <= BULLET_RADIUS ||
        spawnY >= MAP_HEIGHT - BULLET_RADIUS ||
        collidesWithAnyObstacle(spawnX, spawnY, BULLET_RADIUS)
      ) {
        return;
      }

      const vx = Math.cos(player.angle) * BULLET_SPEED;
      const vy = Math.sin(player.angle) * BULLET_SPEED;

      bullets.push({
        id: Math.random().toString(36).substr(2, 9),
        x: spawnX,
        y: spawnY,
        vx,
        vy,
        ownerId: socket.id,
      });
    });

    socket.on("disconnect", () => {
      console.log("Player disconnected:", socket.id);
      delete players[socket.id];
    });
  });

  // Game Loop
  setInterval(() => {
    // Update bullets
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx;
      b.y += b.vy;

      // Outer arena wall collision
      if (
        b.x <= BULLET_RADIUS ||
        b.x >= MAP_WIDTH - BULLET_RADIUS ||
        b.y <= BULLET_RADIUS ||
        b.y >= MAP_HEIGHT - BULLET_RADIUS
      ) {
        bullets.splice(i, 1);
        continue;
      }

      // Obstacle collision
      let hitObstacle = false;
      for (const obs of obstacles) {
        if (checkCircleAABB(b.x, b.y, BULLET_RADIUS, obs)) {
          hitObstacle = true;
          break;
        }
      }
      if (hitObstacle) {
        bullets.splice(i, 1);
        continue;
      }

      // Player collision
      for (const playerId in players) {
        const p = players[playerId];
        if (p.id !== b.ownerId && !p.isDead) {
          const dx = b.x - p.x;
          const dy = b.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);

          if (dist < PLAYER_RADIUS + BULLET_RADIUS) {
            p.shield -= 1; // Decrease shield by 1
            if (p.shield <= 0) {
              p.shield = 0;
              p.isDead = true;
              const killer = players[b.ownerId];
              if (killer) {
                killer.kills += 1;
                io.emit("killFeed", {
                  killer: killer.name,
                  victim: p.name,
                  time: Date.now(),
                });
              }
            }
            bullets.splice(i, 1);
            break; // Bullet hits one player
          }
        }
      }
    }

    io.emit("state", { players, bullets });
  }, 1000 / FPS);

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
