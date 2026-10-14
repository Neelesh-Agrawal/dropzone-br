import WebSocket from 'ws';
import { PlayerState, MatchPhase, ClientPacket, ServerPacket, WeaponId, AttachmentType } from '../src/shared/types';
import { MAX_PLAYERS_PER_ROOM, WEAPONS } from '../src/shared/constants';
import { GameLoop } from './GameLoop';

export interface Room {
  id: string;
  code: string;
  isSquad: boolean;
  phase: MatchPhase;
  players: Map<string, { socket: WebSocket; state: PlayerState }>;
  gameLoop: GameLoop | null;
}

export class RoomManager {
  private rooms: Map<string, Room> = new Map();
  private readonly allowedOptics: AttachmentType[] = ['optic_reddot', 'optic_holo', 'optic_2x', 'optic_4x', 'optic_6x', 'optic_8x'];

  public createRoom(socket: WebSocket, playerName: string, characterColor: string, isSquad: boolean, startingWeapon: WeaponId = 'viper_ar', startingSecondaryWeapon?: WeaponId, startingOptic?: import('../src/shared/types').AttachmentType): { room: Room; playerId: string } {
    startingWeapon = WEAPONS[startingWeapon] ? startingWeapon : 'viper_ar';
    startingSecondaryWeapon = startingSecondaryWeapon && WEAPONS[startingSecondaryWeapon] ? startingSecondaryWeapon : undefined;
    startingOptic = startingOptic && this.allowedOptics.includes(startingOptic) ? startingOptic : 'optic_reddot';
    const code = this.generateRoomCode();
    const playerId = `p_${Math.random().toString(36).substring(2, 9)}`;

    const hostState: PlayerState = {
      id: playerId,
      name: playerName || 'Player 1',
      squadId: isSquad ? 'squad_1' : `squad_${playerId}`,
      position: { x: (Math.random() - 0.5) * 400, y: 400, z: (Math.random() - 0.5) * 400 },
      rotation: { yaw: 0, pitch: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      health: 100,
      maxHealth: 100,
      armor: 50,
      maxArmor: 50,
      isDowned: false,
      downedTimer: 0,
      isEliminated: false,
      isHost: true,
      isReady: true,
      isDropping: true,
      altitude: 400,
      equippedWeapon: startingWeapon,
      primaryWeapon: startingWeapon,
      secondaryWeapon: startingSecondaryWeapon || null,
      activeSlot: 1,
      ammo: { 'Rifle Ammo': 90, 'SMG Ammo': 120, 'Shotgun Shells': 24, 'Sniper Ammo': 15 },
      magAmmo: { primary: WEAPONS[startingWeapon].magazineSize, secondary: startingSecondaryWeapon ? WEAPONS[startingSecondaryWeapon].magazineSize : 0 },
      healingItems: { medkit: 1, bandage: 5, shieldCell: 2 },
      attachments: {
        primary: { optic: startingOptic || 'optic_reddot', muzzle: null, grip: null, mag: null },
        secondary: { optic: null, muzzle: null, grip: null, mag: null }
      },
      vehicleId: null,
      kills: 0,
      damageDealt: 0,
      revives: 0,
      color: characterColor || '#38bdf8'
    };

    const room: Room = {
      id: `room_${Date.now()}`,
      code,
      isSquad,
      phase: 'LOBBY',
      players: new Map(),
      gameLoop: null
    };

    room.players.set(playerId, { socket, state: hostState });
    this.rooms.set(code, room);

    return { room, playerId };
  }

  public joinRoom(socket: WebSocket, code: string, playerName: string, characterColor: string, startingWeapon: WeaponId = 'viper_ar', startingSecondaryWeapon?: WeaponId, startingOptic?: import('../src/shared/types').AttachmentType): { room: Room; playerId: string } | null {
    startingWeapon = WEAPONS[startingWeapon] ? startingWeapon : 'viper_ar';
    startingSecondaryWeapon = startingSecondaryWeapon && WEAPONS[startingSecondaryWeapon] ? startingSecondaryWeapon : undefined;
    startingOptic = startingOptic && this.allowedOptics.includes(startingOptic) ? startingOptic : 'optic_reddot';
    const room = this.rooms.get(code.toUpperCase());
    if (!room || room.players.size >= MAX_PLAYERS_PER_ROOM || room.phase !== 'LOBBY') {
      return null;
    }

    const playerId = `p_${Math.random().toString(36).substring(2, 9)}`;
    const squadIdx = room.isSquad ? 1 : room.players.size + 1;

    const playerState: PlayerState = {
      id: playerId,
      name: playerName || `Player ${room.players.size + 1}`,
      squadId: room.isSquad ? 'squad_1' : `squad_${playerId}`,
      position: { x: (Math.random() - 0.5) * 400, y: 400, z: (Math.random() - 0.5) * 400 },
      rotation: { yaw: 0, pitch: 0 },
      velocity: { x: 0, y: 0, z: 0 },
      health: 100,
      maxHealth: 100,
      armor: 50,
      maxArmor: 50,
      isDowned: false,
      downedTimer: 0,
      isEliminated: false,
      isHost: false,
      isReady: true,
      isDropping: true,
      altitude: 400,
      equippedWeapon: startingWeapon,
      primaryWeapon: startingWeapon,
      secondaryWeapon: startingSecondaryWeapon || null,
      activeSlot: 1,
      ammo: { 'Rifle Ammo': 90, 'SMG Ammo': 120, 'Shotgun Shells': 24, 'Sniper Ammo': 15 },
      magAmmo: { primary: WEAPONS[startingWeapon].magazineSize, secondary: startingSecondaryWeapon ? WEAPONS[startingSecondaryWeapon].magazineSize : 0 },
      healingItems: { medkit: 1, bandage: 5, shieldCell: 2 },
      attachments: {
        primary: { optic: startingOptic || 'optic_reddot', muzzle: null, grip: null, mag: null },
        secondary: { optic: null, muzzle: null, grip: null, mag: null }
      },
      vehicleId: null,
      kills: 0,
      damageDealt: 0,
      revives: 0,
      color: characterColor || '#e53e3e'
    };

    room.players.set(playerId, { socket, state: playerState });
    return { room, playerId };
  }

  public findOrCreateQuickMatch(socket: WebSocket, playerName: string, characterColor: string): { room: Room; playerId: string } {
    for (const room of this.rooms.values()) {
      if (room.phase === 'LOBBY' && room.players.size < MAX_PLAYERS_PER_ROOM) {
        const joined = this.joinRoom(socket, room.code, playerName, characterColor);
        if (joined) return joined;
      }
    }
    return this.createRoom(socket, playerName, characterColor, false);
  }

  public getRoomByCode(code: string): Room | undefined {
    return this.rooms.get(code.toUpperCase());
  }

  public removePlayer(socket: WebSocket): void {
    for (const room of this.rooms.values()) {
      for (const [pId, pData] of room.players.entries()) {
        if (pData.socket === socket) {
          room.players.delete(pId);
          if (![...room.players.values()].some(player => player.socket?.readyState === WebSocket.OPEN)) {
            if (room.gameLoop) room.gameLoop.stop();
            this.rooms.delete(room.code);
          } else {
            if (pData.state.isHost) {
              const successor = [...room.players.values()].find(p => p.socket?.readyState === WebSocket.OPEN);
              if (successor) successor.state.isHost = true;
            }
            if (room.phase === 'LOBBY') this.broadcastRoomUpdate(room);
          }
          return;
        }
      }
    }
  }

  public broadcastRoomUpdate(room: Room): void {
    const playersList = Array.from(room.players.values()).map(p => p.state);
    const packet: ServerPacket = {
      type: 'ROOM_UPDATED',
      players: playersList,
      isSquad: room.isSquad
    };
    this.broadcastToRoom(room, packet);
  }

  public broadcastToRoom(room: Room, packet: ServerPacket): void {
    const payload = JSON.stringify(packet);
    for (const { socket } of room.players.values()) {
      if (socket && socket.readyState === WebSocket.OPEN) {
        socket.send(payload);
      }
    }
  }

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return this.rooms.has(code) ? this.generateRoomCode() : code;
  }
}
