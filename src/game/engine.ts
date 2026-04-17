import { isCorrect } from '../fuzzyMatch'
import type { AnswerRecord, PlayerData, PowerUpType, Puzzle, ScoreDelta } from '../types'

export interface ResolvedRound {
  deltas: Record<string, ScoreDelta>
  updatedScores: Record<string, number>
  consumedPowerUps: Record<string, PowerUpType[]>
  wrongSubmissions: string[]
}

function normalizePowerUps(powerUps: PlayerData['powerUps'] | Record<string, PowerUpType> | null | undefined): PowerUpType[] {
  if (Array.isArray(powerUps)) return powerUps
  return Object.values(powerUps ?? {}) as PowerUpType[]
}

export function removeLastPowerUpInstance(powerUps: PlayerData['powerUps'] | Record<string, PowerUpType> | null | undefined, used: PowerUpType): PowerUpType[] {
  const current = normalizePowerUps(powerUps)
  const removeAt = current.lastIndexOf(used)
  if (removeAt === -1) return current
  return current.filter((_, index) => index !== removeAt)
}

export function resolveRound(params: {
  puzzle: Puzzle
  answers: Record<string, AnswerRecord>
  players: Record<string, PlayerData>
  timerStart: number
  timerDuration: number
}): ResolvedRound {
  const { puzzle, answers, players, timerStart, timerDuration } = params
  const deltas: Record<string, ScoreDelta> = {}
  const updatedScores: Record<string, number> = {}
  const consumedPowerUps: Record<string, PowerUpType[]> = {}
  const wrongSubmissions: string[] = []

  for (const [playerName, playerData] of Object.entries(players)) {
    const record = answers[playerName]
    if (!record) continue

    const correct = isCorrect(record.answer ?? '', puzzle.answers)
    if (!correct && record.answer) wrongSubmissions.push(record.answer)

    const elapsed = Math.max(0, (record.submittedAt ?? Date.now()) - timerStart)
    const speedBonus = Math.max(0, Math.round(500 * (1 - elapsed / timerDuration)))
    const basePoints = 1000 + speedBonus
    const currentScore = playerData.score ?? 0

    let points = 0
    if (correct) {
      points = record.powerUpUsed === 'double-down' ? basePoints * 2 : basePoints
    } else {
      if (puzzle.type === 'sudden-death') points = -500
      if (record.powerUpUsed === 'double-down') points = -currentScore
    }

    deltas[playerName] = {
      points,
      correct,
      powerUpUsed: record.powerUpUsed ?? null,
    }
    updatedScores[playerName] = Math.max(0, currentScore + points)

    if (record.powerUpUsed) {
      consumedPowerUps[playerName] = removeLastPowerUpInstance(playerData.powerUps, record.powerUpUsed)
    }
  }

  return {
    deltas,
    updatedScores,
    consumedPowerUps,
    wrongSubmissions: [...new Set(wrongSubmissions)],
  }
}
