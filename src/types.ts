export type GamePhase = 'lobby' | 'puzzle-active' | 'puzzle-revealed' | 'game-over'
export type PowerUpType = 'double-down' | 'fifty-fifty' | 'time-freeze' | 'sabotage'
export type PuzzleType = 'normal' | 'sudden-death'
export type PuzzleTier = 'general' | 'fintech'

export interface Puzzle {
  id: number
  tier: PuzzleTier
  type: PuzzleType
  image: string
  answers: string[]
  hint: string
  wordLengths?: number[]
}

export interface PlayerData {
  score: number
  powerUps: PowerUpType[]
  joinedAt: number
}

export interface AnswerRecord {
  answer: string
  submittedAt: number
  powerUpUsed: PowerUpType | null
}

export interface ScoreDelta {
  points: number
  correct: boolean
  powerUpUsed: PowerUpType | null
}

export interface GameState {
  phase: GamePhase
  currentPuzzleIndex: number
  timerStart: number
  timerDuration: number
}

export interface PowerUpEvent {
  player: string
  powerup: PowerUpType
  target?: string
  timestamp: number
}

export const POWERUP_LABELS: Record<PowerUpType, string> = {
  'double-down': '🎲 Double Down',
  'fifty-fifty': '✂️ 50/50',
  'time-freeze': '❄️ Time Freeze',
  'sabotage': '💀 Sabotage',
}

export const POWERUP_DESCRIPTIONS: Record<PowerUpType, string> = {
  'double-down': '2x points if correct — lose your score if wrong',
  'fifty-fifty': 'Reveals the puzzle hint',
  'time-freeze': 'Freezes your timer for 6 seconds',
  'sabotage': 'Steal 100 points from the leader',
}
