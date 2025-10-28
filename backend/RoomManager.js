class RoomManager {
  constructor() {
    // Map of roomCode -> { code, players: Set<playerId>, clients: Set<clientId>, hostId: string|null, createdAt: Date }
    this.rooms = new Map();
  }

  generateRoomCode() {
    // Generate a unique 3-digit code as a string, e.g., "482"
    const maxAttempts = 1000;
    for (let i = 0; i < maxAttempts; i++) {
      const code = Math.floor(100 + Math.random() * 900).toString();
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Failed to generate unique room code');
  }

  createRoom(hostPlayerId = null) {
    const code = this.generateRoomCode();
    const room = {
      code,
      players: new Set(),
      clients: new Set(),
      hostId: hostPlayerId || null,
      createdAt: new Date(),
    };
    this.rooms.set(code, room);
    return room;
  }

  ensureRoom(code) {
    if (!this.rooms.has(code)) {
      const room = {
        code,
        players: new Set(),
        clients: new Set(),
        hostId: null,
        createdAt: new Date(),
      };
      this.rooms.set(code, room);
    }
    return this.rooms.get(code);
  }

  getRoom(code) {
    return this.rooms.get(code) || null;
  }

  addClientToRoom(code, clientId) {
    const room = this.ensureRoom(code);
    room.clients.add(clientId);
    return room;
  }

  removeClientFromRoom(code, clientId) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.clients.delete(clientId);
    // If room becomes empty (no clients and no players), delete it
    if (room.clients.size === 0 && room.players.size === 0) {
      this.rooms.delete(code);
    }
  }

  addPlayerToRoom(code, playerId, makeHostIfFirst = true) {
    const room = this.ensureRoom(code);
    room.players.add(playerId);
    if (makeHostIfFirst && !room.hostId) {
      room.hostId = playerId;
    }
    return room;
  }

  removePlayerFromRoom(code, playerId) {
    const room = this.rooms.get(code);
    if (!room) return;
    room.players.delete(playerId);
    if (room.hostId === playerId) {
      // Assign a new host if there are players left
      room.hostId = room.players.values().next().value || null;
    }
    if (room.clients.size === 0 && room.players.size === 0) {
      this.rooms.delete(code);
    }
  }

  listPlayers(code) {
    const room = this.rooms.get(code);
    if (!room) return [];
    return Array.from(room.players);
  }

  listClients(code) {
    const room = this.rooms.get(code);
    if (!room) return [];
    return Array.from(room.clients);
  }

  roomExists(code) {
    return this.rooms.has(code);
  }
}

module.exports = RoomManager;
