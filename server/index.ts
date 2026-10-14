import express from 'express';
import { createServer } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { RoomManager } from './RoomManager';
import { GameLoop } from './GameLoop';
import { ClientPacket, ServerPacket } from '../src/shared/types';
import path from 'node:path';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 16384 });

const roomManager = new RoomManager();

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', serverTime: new Date().toISOString() });
});
app.use(express.static(path.resolve('dist')));

wss.on('connection', (socket: WebSocket) => {
  let currentPlayerId: string | null = null;
  let currentRoomCode: string | null = null;
  let packetCount = 0;
  let packetWindow = Date.now();

  socket.on('message', (message: string) => {
    try {
      const packet: ClientPacket = JSON.parse(message.toString());
      if (!packet || typeof packet.type !== 'string') return;
      if (Date.now() - packetWindow > 1000) { packetWindow = Date.now(); packetCount = 0; }
      if (++packetCount > 150) return;
      if (packet.type === 'PING') { socket.send(JSON.stringify({ type: 'PONG', sentAt: packet.sentAt })); return; }
      if (packet.type === 'LEAVE_ROOM') {
        roomManager.removePlayer(socket); currentRoomCode = null; currentPlayerId = null; return;
      }
      if (packet.type === 'CREATE_ROOM' || packet.type === 'JOIN_ROOM') {
        if (currentRoomCode) { socket.send(JSON.stringify({ type: 'ERROR_MESSAGE', message: 'Leave your current room before joining another.' })); return; }
        packet.playerName = typeof packet.playerName === 'string' ? packet.playerName.trim().slice(0, 24) : 'Operator';
        packet.characterColor = /^#[0-9a-f]{6}$/i.test(packet.characterColor) ? packet.characterColor : '#617a72';
        if (packet.type === 'JOIN_ROOM' && typeof packet.roomCode !== 'string') return;
      }

      if (packet.type === 'CREATE_ROOM') {
        const { room, playerId } = roomManager.createRoom(socket, packet.playerName, packet.characterColor, packet.isSquad, packet.startingWeapon, packet.startingSecondaryWeapon, packet.startingOptic);
        const appearance = room.players.get(playerId)!.state;
        appearance.skin = /^#[0-9a-f]{6}$/i.test(packet.skin || '') ? packet.skin : '#c99672';
        appearance.outfit = ['field','scout','armor'].includes(packet.outfit || '') ? packet.outfit : 'field';
        currentPlayerId = playerId;
        currentRoomCode = room.code;

        const response: ServerPacket = {
          type: 'ROOM_JOINED',
          roomId: room.id,
          roomCode: room.code,
          playerId,
          isHost: true,
          players: Array.from(room.players.values()).map(p => p.state)
        };
        socket.send(JSON.stringify(response));
        roomManager.broadcastRoomUpdate(room);

      } else if (packet.type === 'JOIN_ROOM') {
        const result = roomManager.joinRoom(socket, packet.roomCode, packet.playerName, packet.characterColor, packet.startingWeapon, packet.startingSecondaryWeapon, packet.startingOptic);
        if (result) {
          const appearance = result.room.players.get(result.playerId)!.state;
          appearance.skin = /^#[0-9a-f]{6}$/i.test(packet.skin || '') ? packet.skin : '#c99672';
          appearance.outfit = ['field','scout','armor'].includes(packet.outfit || '') ? packet.outfit : 'field';
          currentPlayerId = result.playerId;
          currentRoomCode = result.room.code;

          const response: ServerPacket = {
            type: 'ROOM_JOINED',
            roomId: result.room.id,
            roomCode: result.room.code,
            playerId: result.playerId,
            isHost: false,
            players: Array.from(result.room.players.values()).map(p => p.state)
          };
          socket.send(JSON.stringify(response));
          roomManager.broadcastRoomUpdate(result.room);
        } else {
          socket.send(JSON.stringify({ type: 'ERROR_MESSAGE', message: 'Room full or code invalid' }));
        }

      } else if (packet.type === 'START_MATCH') {
        if (!currentRoomCode) return;
        const room = roomManager.getRoomByCode(currentRoomCode);
        if (room && room.phase === 'LOBBY' && room.players.get(currentPlayerId!)?.state.isHost) {
          room.phase = 'DROP';
          room.gameLoop = new GameLoop(room, (p) => roomManager.broadcastToRoom(room, p));
          room.gameLoop.start();
        }

      } else if (currentRoomCode && currentPlayerId) {
        const room = roomManager.getRoomByCode(currentRoomCode);
        if (room && room.gameLoop) {
          room.gameLoop.handleClientInput(currentPlayerId, packet);
        }
      }
    } catch (err) {
      console.error('Failed to parse WebSocket packet:', err);
    }
  });

  socket.on('close', () => {
    roomManager.removePlayer(socket);
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => {
  console.log(`[DROPZONE Server] Running on http://localhost:${PORT} and ws://localhost:${PORT}`);
});
