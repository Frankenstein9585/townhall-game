import type { GamePhase, PlayerData, PowerUpEvent, PowerUpType, Puzzle, ScoreDelta } from '../types'

export interface PublicPuzzle {
  id: number
  tier: Puzzle['tier']
  type: Puzzle['type']
  emoji: string
  hint: string
}

export interface HostRoundState {
  phase: GamePhase
  currentPuzzleIndex: number
  timerStart: number
  timerDuration: number
}

export interface PublicRoomView {
  state: HostRoundState
  currentPuzzle: PublicPuzzle | null
  players: Record<string, Pick<PlayerData, 'score' | 'joinedAt'>>
  powerupEvents?: Record<string, PowerUpEvent>
  deltas?: Record<string, Record<string, ScoreDelta>>
}

export interface PlayerSession {
  playerId: string
  displayName: string
  score: number
  powerUps: PowerUpType[]
  joinedAt: number
}

export interface CreateRoomCommand {
  code: string
  puzzles: Puzzle[]
}

export interface JoinRoomCommand {
  code: string
  playerId: string
  displayName: string
}

export interface SubmitAnswerCommand {
  code: string
  puzzleIndex: number
  playerId: string
  answer: string
  powerUpUsed: PowerUpType | null
}

export interface UsePowerUpCommand {
  code: string
  puzzleIndex: number
  playerId: string
  powerUp: PowerUpType
}
