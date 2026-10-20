/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useEffect, useRef, useState, useCallback, type FormEvent } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  Shield,
  Crosshair,
  Users,
  Copy,
  Check,
  ExternalLink,
  RotateCcw,
  Trophy,
  Flame,
  UserCheck
} from 'lucide-react';

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

interface GameState {
  players: Record<string, Player>;
  bullets: Bullet[];
}

interface KillEvent {
  killer: string;
  victim: string;
  time: number;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [socket, setSocket] = useState<Socket | null>(null);
  const [myId, setMyId] = useState<string | null>(null);
  const [myName, setMyName] = useState<string>('');
  const [isEditingName, setIsEditingName] = useState(false);
  const [nameInputValue, setNameInputValue] = useState('');
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [obstacles, setObstacles] = useState<Obstacle[]>([]);
  const [mapSize, setMapSize] = useState({ width: 800, height: 600 });
  const [copied, setCopied] = useState(false);
  const [killFeed, setKillFeed] = useState<KillEvent[]>([]);

  // Input keys
  const keys = useRef({
    up: false,
    down: false,
    left: false,
    right: false,
  });
  const mouseAngle = useRef(0);

  // Initialize Socket.io connection
  useEffect(() => {
    const newSocket = io();
    setSocket(newSocket);

    newSocket.on('connect', () => {
      setMyId(newSocket.id || null);
    });

    newSocket.on(
      'init',
      (data: {
        id: string;
        name: string;
        obstacles: Obstacle[];
        mapSize: { width: number; height: number };
      }) => {
        setMyId(data.id);
        setMyName(data.name || 'Player');
        setNameInputValue(data.name || 'Player');
        setObstacles(data.obstacles);
        setMapSize(data.mapSize);
      }
    );

    newSocket.on('state', (state: GameState) => {
      setGameState(state);
    });

    newSocket.on('killFeed', (event: KillEvent) => {
      setKillFeed((prev) => [event, ...prev.slice(0, 4)]);
      // Auto-expire old feeds after 5 seconds
      setTimeout(() => {
        setKillFeed((current) => current.filter((k) => k.time !== event.time));
      }, 5000);
    });

    return () => {
      newSocket.disconnect();
    };
  }, []);

  // Handle name update
  const handleSaveName = (e?: FormEvent) => {
    if (e) e.preventDefault();
    if (!socket || !nameInputValue.trim()) return;
    const cleanName = nameInputValue.trim().slice(0, 16);
    setMyName(cleanName);
    setIsEditingName(false);
    socket.emit('setName', cleanName);
  };

  // Handle respawn
  const handleRespawn = useCallback(() => {
    if (socket) {
      socket.emit('respawn');
    }
  }, [socket]);

  // Copy shareable link
  const handleCopyLink = () => {
    const url = window.location.href;
    navigator.clipboard.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    });
  };

  // Open in new tab for instant testing
  const handleOpenSecondTab = () => {
    window.open(window.location.href, '_blank');
  };

  // Keyboard input handling
  useEffect(() => {
    if (!socket) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore controls while typing name in input
      if (document.activeElement?.tagName === 'INPUT') return;

      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          keys.current.up = true;
          break;
        case 'KeyS':
        case 'ArrowDown':
          keys.current.down = true;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          keys.current.left = true;
          break;
        case 'KeyD':
        case 'ArrowRight':
          keys.current.right = true;
          break;
        case 'Space':
          // Space to respawn if dead
          if (myId && gameState?.players[myId]?.isDead) {
            handleRespawn();
          }
          break;
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
          keys.current.up = false;
          break;
        case 'KeyS':
        case 'ArrowDown':
          keys.current.down = false;
          break;
        case 'KeyA':
        case 'ArrowLeft':
          keys.current.left = false;
          break;
        case 'KeyD':
        case 'ArrowRight':
          keys.current.right = false;
          break;
      }
    };

    const handleMouseDown = (e: MouseEvent) => {
      if (document.activeElement?.tagName === 'INPUT') return;
      if (e.button === 0) {
        socket.emit('shoot');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('mousedown', handleMouseDown);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('mousedown', handleMouseDown);
    };
  }, [socket, myId, gameState, handleRespawn]);

  // Input transmission loop to server
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

  // Canvas render loop
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

      // Dark sci-fi arena background
      ctx.fillStyle = '#090d16';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      ctx.save();

      // Camera center on player
      let camX = 0;
      let camY = 0;

      if (me) {
        camX = me.x - canvas.width / 2;
        camY = me.y - canvas.height / 2;
        camX = Math.max(0, Math.min(camX, mapSize.width - canvas.width));
        camY = Math.max(0, Math.min(camY, mapSize.height - canvas.height));
      }

      ctx.translate(-camX, -camY);

      // Arena Grid floor
      ctx.strokeStyle = '#182238';
      ctx.lineWidth = 1;
      const gridSize = 40;
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

      // Arena Outer Bounds with glowing neon border
      ctx.strokeStyle = '#06b6d4';
      ctx.lineWidth = 4;
      ctx.strokeRect(0, 0, mapSize.width, mapSize.height);

      // Draw Obstacles (Tactical Barrier Boxes)
      obstacles.forEach((obs) => {
        // Shadow / base
        ctx.fillStyle = '#1e293b';
        ctx.fillRect(obs.x, obs.y, obs.width, obs.height);

        // Highlight border
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 3;
        ctx.strokeRect(obs.x, obs.y, obs.width, obs.height);

        // Inner tactical cross lines
        ctx.strokeStyle = '#27354a';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(obs.x, obs.y);
        ctx.lineTo(obs.x + obs.width, obs.y + obs.height);
        ctx.moveTo(obs.x + obs.width, obs.y);
        ctx.lineTo(obs.x, obs.y + obs.height);
        ctx.stroke();

        // Corner warning markings
        ctx.fillStyle = '#f59e0b';
        const cSize = 6;
        ctx.fillRect(obs.x + 2, obs.y + 2, cSize, cSize);
        ctx.fillRect(obs.x + obs.width - cSize - 2, obs.y + 2, cSize, cSize);
        ctx.fillRect(obs.x + 2, obs.y + obs.height - cSize - 2, cSize, cSize);
        ctx.fillRect(obs.x + obs.width - cSize - 2, obs.y + obs.height - cSize - 2, cSize, cSize);
      });

      // Draw Players
      const playersList = Object.values(gameState.players) as Player[];
      playersList.forEach((p) => {
        if (p.isDead) return;

        ctx.save();
        ctx.translate(p.x, p.y);

        // Pulsing Shield Aura
        const shieldRatio = Math.max(0, p.shield / 100);
        if (shieldRatio > 0) {
          ctx.beginPath();
          ctx.arc(0, 0, 22, 0, Math.PI * 2);
          ctx.strokeStyle = `rgba(56, 189, 248, ${0.3 + shieldRatio * 0.4})`;
          ctx.lineWidth = 2.5;
          ctx.stroke();

          // Subtle shield fill
          ctx.fillStyle = `rgba(56, 189, 248, ${shieldRatio * 0.08})`;
          ctx.fill();
        }

        // Aim Rotation for body & gun
        ctx.rotate(p.angle);

        // Gun Barrel
        ctx.fillStyle = '#64748b';
        ctx.fillRect(10, -4, 16, 8);
        ctx.fillStyle = '#38bdf8';
        ctx.fillRect(22, -2, 4, 4); // Laser muzzle tip

        // Player Body
        ctx.beginPath();
        ctx.arc(0, 0, 15, 0, Math.PI * 2);
        ctx.fillStyle = p.color;
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = p.id === myId ? '#ffffff' : '#0f172a';
        ctx.stroke();

        // Inner Core Ring
        ctx.beginPath();
        ctx.arc(0, 0, 6, 0, Math.PI * 2);
        ctx.fillStyle = '#0f172a';
        ctx.fill();

        ctx.restore();

        // --- Overhead HUD (Name & Shield Bar) ---
        // Player Name
        ctx.font = 'bold 11px sans-serif';
        ctx.textAlign = 'center';
        const displayName = p.name || `P-${p.id.slice(0, 4)}`;
        const textWidth = ctx.measureText(displayName).width;

        // Nameplate dark pill
        ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
        ctx.fillRect(p.x - textWidth / 2 - 4, p.y - 48, textWidth + 8, 14);

        ctx.fillStyle = p.id === myId ? '#38bdf8' : '#f1f5f9';
        ctx.fillText(displayName, p.x, p.y - 37);

        // Shield Bar Background
        const barWidth = 44;
        const barHeight = 5;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(p.x - barWidth / 2, p.y - 32, barWidth, barHeight);

        // Shield Bar Fill
        const currentShieldW = Math.max(0, barWidth * (p.shield / 100));
        let shieldColor = '#22c55e'; // Green
        if (p.shield < 35) shieldColor = '#ef4444'; // Red
        else if (p.shield < 70) shieldColor = '#eab308'; // Yellow

        ctx.fillStyle = shieldColor;
        ctx.fillRect(p.x - barWidth / 2, p.y - 32, currentShieldW, barHeight);

        // Bar border
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
        ctx.lineWidth = 1;
        ctx.strokeRect(p.x - barWidth / 2, p.y - 32, barWidth, barHeight);
      });

      // Draw Bullets (Glowing energy shots)
      gameState.bullets.forEach((b) => {
        ctx.save();
        ctx.beginPath();
        ctx.arc(b.x, b.y, 4, 0, Math.PI * 2);
        ctx.fillStyle = '#fef08a';
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 10;
        ctx.fill();
        ctx.restore();
      });

      ctx.restore();

      animationFrameId = requestAnimationFrame(render);
    };

    render();

    // Mouse movement in world coordinates
    const handleMouseMove = (e: MouseEvent) => {
      if (!gameState || !myId) return;
      const me = gameState.players[myId];
      if (!me) return;

      const rect = canvas.getBoundingClientRect();
      const mouseX = e.clientX - rect.left;
      const mouseY = e.clientY - rect.top;

      let camX = me.x - canvas.width / 2;
      let camY = me.y - canvas.height / 2;
      camX = Math.max(0, Math.min(camX, mapSize.width - canvas.width));
      camY = Math.max(0, Math.min(camY, mapSize.height - canvas.height));

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

  const me = gameState && myId ? gameState.players[myId] : null;
  const connectedPlayers = gameState ? (Object.values(gameState.players) as Player[]) : [];
  const sortedPlayers = [...connectedPlayers].sort((a, b) => b.kills - a.kills || b.shield - a.shield);

  return (
    <div className="flex flex-col items-center justify-start min-h-screen bg-slate-950 text-slate-100 font-sans p-3 sm:p-5 select-none">
      {/* Top Header / Multiplayer Hub */}
      <header className="w-full max-w-5xl flex flex-wrap items-center justify-between gap-3 mb-3 bg-slate-900/90 border border-slate-800 p-3.5 rounded-xl shadow-lg backdrop-blur">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400">
            <Shield className="w-6 h-6" />
          </div>
          <div>
            <h1 className="text-lg font-black tracking-wider text-white uppercase flex items-center gap-2">
              Shield Shooter Arena
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-cyan-900/60 text-cyan-300 border border-cyan-700/50">
                LIVE
              </span>
            </h1>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
              <span>{connectedPlayers.length} {connectedPlayers.length === 1 ? 'Player' : 'Players'} in Arena</span>
            </div>
          </div>
        </div>

        {/* Player Name Tag Editor */}
        <div className="flex items-center gap-2 bg-slate-950/70 border border-slate-800 px-3 py-1.5 rounded-lg">
          <UserCheck className="w-4 h-4 text-cyan-400" />
          {isEditingName ? (
            <form onSubmit={handleSaveName} className="flex items-center gap-1.5">
              <input
                type="text"
                value={nameInputValue}
                onChange={(e) => setNameInputValue(e.target.value)}
                maxLength={16}
                autoFocus
                className="bg-slate-800 text-xs text-white px-2 py-1 rounded border border-cyan-500/50 focus:outline-none w-28"
              />
              <button
                type="submit"
                className="text-xs bg-cyan-600 hover:bg-cyan-500 text-white px-2 py-1 rounded transition"
              >
                Save
              </button>
            </form>
          ) : (
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-slate-200">
                Callsign: <span className="text-cyan-400">{myName || 'Guest'}</span>
              </span>
              <button
                onClick={() => setIsEditingName(true)}
                className="text-[11px] text-slate-400 hover:text-white underline cursor-pointer"
              >
                Edit
              </button>
            </div>
          )}
        </div>

        {/* Share & Invite Buttons */}
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopyLink}
            className="flex items-center gap-1.5 text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 active:scale-95 text-white px-3.5 py-2 rounded-lg transition shadow-md shadow-cyan-900/30 cursor-pointer"
            title="Copy this game link and send to friends to play together"
          >
            {copied ? <Check className="w-4 h-4 text-emerald-300" /> : <Copy className="w-4 h-4" />}
            {copied ? 'Link Copied!' : 'Copy Invite Link'}
          </button>

          <button
            onClick={handleOpenSecondTab}
            className="flex items-center gap-1.5 text-xs font-medium bg-slate-800 hover:bg-slate-700 active:scale-95 text-slate-200 border border-slate-700 px-3 py-2 rounded-lg transition cursor-pointer"
            title="Open a second tab to test 2 players battle on the same computer"
          >
            <ExternalLink className="w-3.5 h-3.5 text-slate-400" />
            <span className="hidden sm:inline">Open 2nd Tab</span>
          </button>
        </div>
      </header>

      {/* Main Game Section with Canvas + Sidebar */}
      <div className="flex flex-col lg:flex-row items-start justify-center gap-4 w-full max-w-5xl">
        {/* Game Canvas Container */}
        <div className="relative mx-auto bg-slate-900 rounded-xl overflow-hidden border border-slate-800 shadow-2xl">
          <canvas
            ref={canvasRef}
            width={780}
            height={560}
            className="block cursor-crosshair max-w-full"
          />

          {/* Canvas HUD: Shield Gauge (Bottom Left) */}
          <div className="absolute bottom-4 left-4 pointer-events-none flex items-center gap-3 bg-slate-950/85 backdrop-blur border border-slate-800/80 px-4 py-2.5 rounded-xl shadow-lg">
            <div className="flex items-center justify-center w-10 h-10 rounded-lg bg-cyan-950/80 border border-cyan-500/30 text-cyan-400 font-bold">
              <Shield className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1">
                <span>SHIELD INTEGRITY</span>
                <span className="font-mono font-bold text-cyan-400">{me ? me.shield : 100}%</span>
              </div>
              <div className="w-36 h-2.5 bg-slate-800 rounded-full overflow-hidden border border-slate-700">
                <div
                  className={`h-full transition-all duration-100 ${
                    !me || me.shield > 65
                      ? 'bg-emerald-500'
                      : me.shield > 30
                      ? 'bg-amber-400'
                      : 'bg-rose-500'
                  }`}
                  style={{ width: `${Math.max(0, me ? me.shield : 100)}%` }}
                />
              </div>
            </div>
          </div>

          {/* Kill Feed (Top Right of Canvas) */}
          <div className="absolute top-4 right-4 pointer-events-none flex flex-col gap-1.5 max-w-xs">
            {killFeed.map((kf, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 text-xs bg-slate-950/80 backdrop-blur border border-red-900/40 text-slate-200 px-3 py-1 rounded-lg shadow"
              >
                <Flame className="w-3.5 h-3.5 text-amber-400" />
                <span className="font-semibold text-cyan-400">{kf.killer}</span>
                <span className="text-slate-400 text-[10px]">eliminated</span>
                <span className="font-semibold text-rose-400">{kf.victim}</span>
              </div>
            ))}
          </div>

          {/* Death / Respawn Overlay */}
          {me && me.isDead && (
            <div className="absolute inset-0 bg-slate-950/90 backdrop-blur-sm flex flex-col items-center justify-center p-6 text-center z-20">
              <div className="w-16 h-16 rounded-full bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-500 mb-3 shadow-lg shadow-rose-950/50">
                <Crosshair className="w-8 h-8" />
              </div>
              <h2 className="text-3xl font-black text-rose-500 tracking-wider uppercase mb-1">
                Shield Depleted
              </h2>
              <p className="text-sm text-slate-400 mb-6 max-w-sm">
                Your tactical energy was extinguished in combat. Recharging systems...
              </p>

              <button
                onClick={handleRespawn}
                className="flex items-center gap-2 bg-gradient-to-r from-cyan-500 to-blue-600 hover:from-cyan-400 hover:to-blue-500 text-white font-bold text-sm px-7 py-3 rounded-xl shadow-lg shadow-cyan-900/50 active:scale-95 transition cursor-pointer"
              >
                <RotateCcw className="w-4 h-4" />
                RESPAWN IN ARENA
              </button>
              <span className="text-xs text-slate-500 mt-2.5">
                or press <kbd className="px-1.5 py-0.5 bg-slate-800 rounded border border-slate-700 text-slate-300">Spacebar</kbd>
              </span>
            </div>
          )}
        </div>

        {/* Sidebar: Leaderboard & Joining Guide */}
        <div className="w-full lg:w-72 flex flex-col gap-3">
          {/* Live Arena Scoreboard */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-lg backdrop-blur">
            <div className="flex items-center justify-between pb-2 mb-3 border-b border-slate-800">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <Trophy className="w-4 h-4 text-amber-400" />
                Arena Combatants
              </h3>
              <span className="text-[11px] text-slate-400">
                {connectedPlayers.length} online
              </span>
            </div>

            <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
              {sortedPlayers.map((p) => {
                const isMe = p.id === myId;
                return (
                  <div
                    key={p.id}
                    className={`flex items-center justify-between p-2 rounded-lg text-xs border ${
                      isMe
                        ? 'bg-cyan-950/30 border-cyan-700/50 text-white'
                        : 'bg-slate-950/50 border-slate-800 text-slate-300'
                    }`}
                  >
                    <div className="flex items-center gap-2 overflow-hidden">
                      <span
                        className="w-2.5 h-2.5 rounded-full shrink-0"
                        style={{ backgroundColor: p.color }}
                      />
                      <span className="font-semibold truncate max-w-[100px]">
                        {p.name || 'Player'}
                        {isMe && <span className="text-[10px] text-cyan-400 ml-1">(You)</span>}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-amber-400 font-mono text-[11px]" title="Kills">
                        {p.kills} 🎯
                      </span>
                      <span
                        className={`font-mono text-[11px] ${
                          p.isDead
                            ? 'text-rose-400'
                            : p.shield > 60
                            ? 'text-emerald-400'
                            : 'text-amber-400'
                        }`}
                      >
                        {p.isDead ? 'DEAD' : `${p.shield}%`}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Quick Guide on How Others Join */}
          <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 shadow-lg text-xs space-y-3">
            <h4 className="font-bold text-slate-200 flex items-center gap-1.5 text-[13px]">
              <Users className="w-4 h-4 text-cyan-400" />
              How Others Join
            </h4>
            <ol className="list-decimal list-inside space-y-1.5 text-slate-400">
              <li>
                Click <strong className="text-cyan-300">Copy Invite Link</strong> above.
              </li>
              <li>
                Share the URL with friends or open it on another device/browser.
              </li>
              <li>
                They will spawn immediately in the arena with a gun and full shield!
              </li>
            </ol>
            <div className="p-2.5 bg-slate-950/80 rounded-lg border border-slate-800 text-[11px] text-slate-400">
              💡 <strong className="text-slate-300">Solo testing tip:</strong> Click{' '}
              <span className="text-cyan-400 underline cursor-pointer" onClick={handleOpenSecondTab}>
                Open 2nd Tab
              </span>{' '}
              or open an incognito window to see both players fighting each other side-by-side.
            </div>
          </div>

          {/* Controls Reference */}
          <div className="bg-slate-900/60 border border-slate-800/80 rounded-xl p-3 text-xs text-slate-400 flex items-center justify-between">
            <div className="space-y-0.5">
              <p><kbd className="bg-slate-800 px-1 py-0.5 rounded text-white">W A S D</kbd> to move</p>
              <p><span className="text-white">Mouse</span> to aim gun</p>
            </div>
            <div className="space-y-0.5 text-right">
              <p><span className="text-white">Left-Click</span> to fire</p>
              <p><span className="text-amber-400">Cover</span> behind boxes</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
