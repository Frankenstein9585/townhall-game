const POWER_UP_OPTIONS = ['double-down', 'fifty-fifty', 'time-freeze', 'sabotage']
export const POWERUP_EXPIRY_ROUNDS = 5

function normalizeAnswer(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '').trim()
}

export function isCorrectAnswer(input, acceptedAnswers) {
  const normalized = normalizeAnswer(input)
  if (!normalized) return false
  return acceptedAnswers.some(answer => normalizeAnswer(answer) === normalized)
}

export function randomPowerUp() {
  return POWER_UP_OPTIONS[Math.floor(Math.random() * POWER_UP_OPTIONS.length)]
}

// powerUps is Array<{type, assignedRound}>; usedType is a plain PowerUpType string
export function removeLastPowerUpInstance(powerUps, usedType) {
  const idx = [...powerUps].map(p => p.type).lastIndexOf(usedType)
  if (idx === -1) return powerUps
  return powerUps.filter((_, i) => i !== idx)
}

// Mutates players in-place: removes power-ups that have been held for >= POWERUP_EXPIRY_ROUNDS
export function expirePowerUps(players, currentPuzzleIndex) {
  for (const player of Object.values(players)) {
    player.powerUps = player.powerUps.filter(
      pu => currentPuzzleIndex - pu.assignedRound < POWERUP_EXPIRY_ROUNDS
    )
  }
}

export function toPublicPuzzle(puzzle) {
  if (!puzzle) return null
  return {
    id: puzzle.id,
    tier: puzzle.tier,
    type: puzzle.type,
    image: puzzle.image,
    hint: puzzle.hint,
    wordLengths: puzzle.answers[0].split(' ').map(w => w.length),
  }
}

export function resolveRound({ puzzle, answers, players, timerStart, timerDuration }) {
  const deltas = {}
  const wrongSubmissions = []

  for (const [playerId, player] of Object.entries(players)) {
    const answerRecord = answers[playerId]
    if (!answerRecord) continue

    const correct = isCorrectAnswer(answerRecord.answer, puzzle.answers)
    if (!correct && answerRecord.answer) wrongSubmissions.push(answerRecord.answer)

    const elapsed = Math.max(0, (answerRecord.submittedAt || Date.now()) - timerStart)
    const speedBonus = Math.max(0, Math.round(500 * (1 - elapsed / timerDuration)))
    const basePoints = 1000 + speedBonus

    let points = 0
    if (correct) {
      points = answerRecord.powerUpUsed === 'double-down' ? basePoints * 2 : basePoints
    } else {
      if (puzzle.type === 'sudden-death') points = -200
      if (answerRecord.powerUpUsed === 'double-down') points = -(player.score || 0)
    }

    deltas[playerId] = {
      points,
      correct,
      powerUpUsed: answerRecord.powerUpUsed || null,
    }
  }

  return {
    deltas,
    wrongSubmissions: [...new Set(wrongSubmissions)],
  }
}

export function createInitialRoom({ code, puzzles, hostSocketId, timerDuration = 15000 }) {
  return {
    code,
    createdAt: Date.now(),
    hostSocketId,
    puzzles,
    timerDuration,
    state: {
      phase: 'lobby',
      currentPuzzleIndex: 0,
      timerStart: 0,
      timerDuration,
    },
    public: {
      currentPuzzle: null,
      revealedAnswer: null,
      meta: {
        totalPuzzles: puzzles.length,
      },
    },
    players: {},
    answers: {},
    deltas: {},
    wrongSubmissions: {},
    powerupEvents: [],
    sabotagedThisRound: [],
  }
}

// Strips internal {type, assignedRound} objects down to plain PowerUpType strings for clients
function flattenPlayers(players) {
  return Object.fromEntries(
    Object.entries(players).map(([id, p]) => [
      id,
      { ...p, powerUps: p.powerUps.map(pu => pu.type) },
    ])
  )
}

export function buildPublicRoom(room) {
  return {
    code: room.code,
    state: room.state,
    public: room.public,
    players: flattenPlayers(room.players),
    deltas: room.deltas,
    powerupEvents: room.powerupEvents,
  }
}

export function buildHostRoom(room) {
  return {
    ...buildPublicRoom(room),
    puzzles: room.puzzles,
    answers: room.answers,
    wrongSubmissions: room.wrongSubmissions,
  }
}
