import { io, type Socket } from 'socket.io-client'
import type { Puzzle, PowerUpType } from './types'

export interface SocketRoomSnapshot {
  code: string
  state: {
    phase: 'lobby' | 'puzzle-active' | 'puzzle-revealed' | 'game-over'
    currentPuzzleIndex: number
    timerStart: number
    timerDuration: number
  }
  public: {
    currentPuzzle: Omit<Puzzle, 'answers'> & { wordLengths: number[] } | null
    revealedAnswer: string | null
    meta: {
      totalPuzzles: number
    }
  }
  players: Record<string, {
    displayName: string
    score: number
    powerUps: PowerUpType[]
    joinedAt: number
  }>
  deltas: Record<string, Record<string, {
    points: number
    correct: boolean
    powerUpUsed: PowerUpType | null
  }>>
  serverNow?: number
  powerupEvents: Array<{
    player: string
    powerup: PowerUpType
    target?: string
    timestamp: number
  }>
}

export class SocketApi {
  constructor() {
    this.socket = io(import.meta.env.VITE_SOCKET_URL ?? '', {
      autoConnect: false,
      transports: ['websocket'],
    })
  }

  socket: Socket

  connect(): Promise<void> {
    return new Promise((resolve) => {
      if (this.socket.connected) { resolve(); return }
      this.socket.once('connect', resolve)
      this.socket.connect()
    })
  }

  disconnect() {
    if (this.socket.connected) this.socket.disconnect()
  }

  onRoomState(handler: (snapshot: SocketRoomSnapshot) => void) {
    this.socket.on('room:state', handler)
    return () => this.socket.off('room:state', handler)
  }

  onHostState(handler: (snapshot: SocketRoomSnapshot & {
    puzzles: Puzzle[]
    answers: Record<string, Record<string, { answer: string; submittedAt: number; powerUpUsed: string | null }>>
    wrongSubmissions: Record<string, string[]>
  }) => void) {
    this.socket.on('host:state', handler)
    return () => this.socket.off('host:state', handler)
  }

  emitWithAck<TResponse>(event: string, payload: Record<string, unknown>) {
    return new Promise<TResponse>((resolve, reject) => {
      this.socket.emit(event, payload, (response: { ok?: boolean; error?: string } & TResponse) => {
        if (response?.ok) {
          resolve(response)
          return
        }
        reject(new Error(response?.error || `Socket event failed: ${event}`))
      })
    })
  }

  createRoom(payload: { code?: string; puzzles: Puzzle[]; timerDuration?: number }) {
    return this.emitWithAck<{ code: string; room: SocketRoomSnapshot }>('host:create_room', payload)
  }

  attachHost(code: string) {
    return this.emitWithAck<{ room: SocketRoomSnapshot & { puzzles: Puzzle[] } }>('host:attach', { code })
  }

  joinRoom(payload: { code: string; playerId: string; displayName: string }) {
    return this.emitWithAck<{ room: SocketRoomSnapshot }>('player:join_room', payload)
  }

  startRound(payload: { code: string; puzzleIndex?: number }) {
    return this.emitWithAck<{ ok: boolean }>('host:start_round', payload)
  }

  submitAnswer(payload: { code: string; playerId: string; answer: string; powerUpUsed: PowerUpType | null }) {
    return this.emitWithAck<{ ok: boolean }>('player:submit_answer', payload)
  }

  usePowerUp(payload: { code: string; playerId: string; powerUp: PowerUpType }) {
    return this.emitWithAck<{ ok: boolean }>('player:use_powerup', payload)
  }

  revealRound(code: string) {
    return this.emitWithAck<{ ok: boolean; deltas: Record<string, unknown>; wrongSubmissions: string[] }>('host:reveal_round', { code })
  }

  advanceRound(code: string) {
    return this.emitWithAck<{ ok: boolean }>('host:advance_round', { code })
  }

  distributePowerUps(code: string) {
    return this.emitWithAck<{ ok: boolean }>('host:distribute_powerups', { code })
  }

  endGame(code: string) {
    return this.emitWithAck<{ ok: boolean }>('host:end_game', { code })
  }
}

export function createSocketApi() {
  return new SocketApi()
}
