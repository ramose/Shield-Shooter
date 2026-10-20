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
  x: number;
  y: number;
  angle: number;
  shield: number;
  color: string;
  isDead: boolean;
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
  { x: 100, y: 100, width: 50, height: 200 },
  { x: 650, y: 300, width: 50, height: 200 },
  { x: 300, y: 250, width: 200, height: 50 },
  { x: 200, y: 500, width: 100, height: 50 },
  { x: 500, y: 50, width: 100, height: 50 },
];

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
  io.on("connection", (socket) => {
    console.log("Player connected:", socket.id);

    // Initialize player
    players[socket.id] = {
      id: socket.id,
      x: Math.random() * (MAP_WIDTH - 100) + 50,
      y: Math.random() * (MAP_HEIGHT - 100) + 50,
      angle: 0,
      shield: SHIELD_MAX,
      color: `hsl(${Math.random() * 360}, 70%, 50%)`,
      isDead: false,
    };

    socket.emit("init", { id: socket.id, obstacles, mapSize: { width: MAP_WIDTH, height: MAP_HEIGHT } });

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

      // Proposed new position
      const newX = player.x + dx;
      const newY = player.y + dy;

      // Collision with walls
      if (newX < PLAYER_RADIUS || newX > MAP_WIDTH - PLAYER_RADIUS) dx = 0;
      if (newY < PLAYER_RADIUS || newY > MAP_HEIGHT - PLAYER_RADIUS) dy = 0;

      // Collision with obstacles
      let canMoveX = true;
      let canMoveY = true;

      for (const obs of obstacles) {
        if (
          newX + PLAYER_RADIUS > obs.x &&
          newX - PLAYER_RADIUS < obs.x + obs.width &&
          player.y + PLAYER_RADIUS > obs.y &&
          player.y - PLAYER_RADIUS < obs.y + obs.height
        ) {
          canMoveX = false;
        }
        if (
          player.x + PLAYER_RADIUS > obs.x &&
          player.x - PLAYER_RADIUS < obs.x + obs.width &&
          newY + PLAYER_RADIUS > obs.y &&
          newY - PLAYER_RADIUS < obs.y + obs.height
        ) {
          canMoveY = false;
        }
      }

      if (canMoveX) player.x += dx;
      if (canMoveY) player.y += dy;
    });

    socket.on("shoot", () => {
      const player = players[socket.id];
      if (!player || player.isDead) return;

      const vx = Math.cos(player.angle) * BULLET_SPEED;
      const vy = Math.sin(player.angle) * BULLET_SPEED;

      bullets.push({
        id: Math.random().toString(36).substr(2, 9),
        x: player.x + Math.cos(player.angle) * (PLAYER_RADIUS + 5),
        y: player.y + Math.sin(player.angle) * (PLAYER_RADIUS + 5),
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

      // Wall collision
      if (b.x < 0 || b.x > MAP_WIDTH || b.y < 0 || b.y > MAP_HEIGHT) {
        bullets.splice(i, 1);
        continue;
      }

      // Obstacle collision
      let hitObstacle = false;
      for (const obs of obstacles) {
        if (
          b.x > obs.x &&
          b.x < obs.x + obs.width &&
          b.y > obs.y &&
          b.y < obs.y + obs.height
        ) {
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
