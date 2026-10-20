/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState } from 'react';
import { io, Socket } from 'socket.io-client';

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

interface GameState {
  players: Record<string, Player>;
  bullets: Bullet[];
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [mapSize, setMapSize] = useState({ width: 800, height: 600 });
  
  // Input state
  const keys = useRef({
    up: false,
    down: false,
    left: false,
    right: false,
  });
  const mouseAngle = useRef(0);

  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('connect', () => {
      console.log('Connected to server');
      setMyId(newSocket.id || null);
    });

    newSocket.on('init', (data: { id: string; obstacles: Obstacle[]; mapSize: { width: number; height: number } }) => {
      setMyId(data.id);
      setObstacles(data.obstacles);
      setMapSize(data.mapSize);
    });

    newSocket.on('state', (state: GameState) => {
      setGameState(state);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Input handling
  useEffect(() => {
    if (!socket) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW': keys.current.up = true; break;
        case 'KeyS': keys.current.down = true; break;
        case 'KeyA': keys.current.left = true; break;
        case 'KeyD': keys.current.right = true; break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW': keys.current.up = false; break;
        case 'KeyS': keys.current.down = false; break;
        case 'KeyA': keys.current.left = false; break;
        case 'KeyD': keys.current.right = false; break;
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      
      // We need to calculate angle relative to player center on screen
      // But we don't know player screen pos easily without camera logic.
      // For this simple version, let's assume the canvas maps 1:1 to the game world if possible,
      // OR we center the camera on the player.
      // Let's implement a camera system.
    };
    
    // Actually, let's do the angle calculation in the render loop or a separate interval
    // where we have access to the player's position.

    const handleMouseDown = () => {
      socket.emit('shoot');
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, [socket]);

  // Input transmission loop
  useEffect(() => {
    if (!socket) return;
    const interval = setInterval(() => {
      socket.emit('input', {
        ...keys.current,
        angle: mouseAngle.current,
      });
    }, 1000 / 60);
    return () => clearInterval(interval);
  }, [socket]);

  // Rendering Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId: number;

    const render = () => {
      if (!gameState || !myId) {
        animationFrameId = requestAnimationFrame(render);
        return;
      }

      const me = gameState.players[myId];
      
      // Clear canvas
      ctx.fillStyle = '#1a1a1a';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Camera logic: Center on player
      ctx.save();
      
      let camX = 0;
      let camY = 0;

      if (me) {
        camX = me.x - canvas.width / 2;
        camY = me.y - canvas.height / 2;
        
        // Clamp camera to map bounds
        camX = Math.max(0, Math.min(camX, mapSize.width - canvas.width));
        camY = Math.max(0, Math.min(camY, mapSize.height - canvas.height));
      }

      ctx.translate(-camX, -camY);

      // Draw Map Background (Grid)
      ctx.strokeStyle = '#333';
      ctx.lineWidth = 1;
      const gridSize = 50;
      for (let x = 0; x <= mapSize.width; x += gridSize) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, mapSize.height);
        ctx.stroke();
      }
      for (let y = 0; y <= mapSize.height; y += gridSize) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(mapSize.width, y);
        ctx.stroke();
      }

      // Draw Obstacles
      ctx.fillStyle = '#555';
      ctx.strokeStyle = '#777';
      ctx.lineWidth = 2;
      obstacles.forEach(obs => {
        ctx.fillRect(obs.x, obs.y, obs.width, obs.height);
        ctx.strokeRect(obs.x, obs.y, obs.width, obs.height);
      });

      // Draw Players
      (Object.values(gameState.players) as Player[]).forEach(p => {
        if (p.isDead) return;

        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle);

        // Draw Player Body
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(0, 0, 15, 0, Math.PI * 2);
        ctx.fill();

        // Draw Gun
        ctx.fillStyle = '#888';
        ctx.fillRect(10, -3, 15, 6);

        ctx.restore();

        // Draw Shield Bar
        ctx.fillStyle = 'red';
        ctx.fillRect(p.x - 20, p.y - 30, 40, 5);
        ctx.fillStyle = '#00ff00';
        ctx.fillRect(p.x - 20, p.y - 30, 40 * (p.shield / 100), 5);
        
        // Draw Name/ID (optional)
        // ctx.fillStyle = 'white';
        // ctx.font = '10px Arial';
        // ctx.fillText(p.id.slice(0, 4), p.x - 10, p.y - 35);
      });

      // Draw Bullets
      ctx.fillStyle = '#ffff00';
      gameState.bullets.forEach(b => {
        ctx.beginPath();
        ctx.arc(b.x, b.y, 3, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.restore();

      // UI Overlay (HUD)
      if (me) {
        ctx.fillStyle = 'white';
        ctx.font = '20px sans-serif';
        ctx.fillText(`Shield: ${me.shield}`, 20, 30);
        
        if (me.isDead) {
          ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = 'red';
          ctx.font = '40px sans-serif';
          ctx.textAlign = 'center';
          ctx.fillText('YOU DIED', canvas.width / 2, canvas.height / 2);
          ctx.font = '20px sans-serif';
          ctx.fillStyle = 'white';
          ctx.fillText('Refresh to respawn', canvas.width / 2, canvas.height / 2 + 40);
          ctx.textAlign = 'left'; // Reset
        }
      }

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    // Mouse move handler needs access to camera position to calculate angle correctly
    const handleMouseMove = (e: MouseEvent) => {
      if (!gameState || !myId) return;
      const me = gameState.players[myId];
      if (!me) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      // Calculate camera offset again (same logic as render)
      let camX = me.x - canvas.width / 2;
      let camY = me.y - canvas.height / 2;
      camX = Math.max(0, Math.min(camX, mapSize.width - canvas.width));
      camY = Math.max(0, Math.min(camY, mapSize.height - canvas.height));

      // Mouse position in world coordinates
      const worldMouseX = mouseX + camX;
      const worldMouseY = mouseY + camY;

      mouseAngle.current = Math.atan2(worldMouseY - me.y, worldMouseX - me.x);
    };

    window.addEventListener('mousemove', handleMouseMove);

    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', handleMouseMove);
    };
  }, [gameState, myId, obstacles, mapSize]);

  return (
    <div className="flex items-center justify-center min-h-screen bg-zinc-900 text-white overflow-hidden">
      <div className="relative">
        <canvas
          ref={canvasRef}
          width={800}
          height={600}
          className="border border-zinc-700 rounded-lg shadow-2xl bg-zinc-800 cursor-crosshair"
        />
        <div className="absolute top-4 right-4 text-zinc-400 text-sm">
          <p>WASD to Move</p>
          <p>Mouse to Aim</p>
          <p>Click to Shoot</p>
        </div>
      </div>
    </div>
  );
}

