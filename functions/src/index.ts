import { initializeApp } from 'firebase-admin/app'
import { getDatabase } from 'firebase-admin/database'
import { onCall, HttpsError } from 'firebase-functions/v2/https'

initializeApp()

type GamePhase = 'lobby' | 'puzzle-active' | 'puzzle-revealed' | 'game-over'
type PowerUpType = 'double-down' | 'fifty-fifty' | 'time-freeze' | 'sabotage'
type PuzzleType = 'normal' | 'sudden-death'
type PuzzleTier = 'general' | 'fintech'

interface Puzzle {
  id: number
  tier: PuzzleTier
  type: PuzzleType
  emoji: string
  answers: string[]
  hint: string
}

interface PlayerRecord {
  displayName: string
  score: number
  powerUps: PowerUpType[]
  joinedAt: number
}

interface AnswerRecord {
  answer: string
  submittedAt: number
  powerUpUsed: PowerUpType | null
}

interface ScoreDelta {
  points: number
  correct: boolean
  powerUpUsed: PowerUpType | null
}

interface RoomState {
  phase: GamePhase
  currentPuzzleIndex: number
  timerStart: number
  timerDuration: number
}

interface PublicPuzzle {
  id: number
  tier: PuzzleTier
  type: PuzzleType
  emoji: string
  hint: string
}

function roomPath(code: string): string {
  return `rooms/${code}`
}

function toPublicPuzzle(puzzle: Puzzle): PublicPuzzle {
  return {
    id: puzzle.id,
    tier: puzzle.tier,
    type: puzzle.type,
    emoji: puzzle.emoji,
    hint: puzzle.hint,
  }
}

function normalizeAnswer(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '').trim()
}

function isCorrectAnswer(input: string, acceptedAnswers: string[]): boolean {
  const normalized = normalizeAnswer(input)
  if (!normalized) return false
  return acceptedAnswers.some(answer => normalizeAnswer(answer) === normalized)
}

function removeLastPowerUpInstance(powerUps: PowerUpType[] | null | undefined, used: PowerUpType): PowerUpType[] {
  const current = [...(powerUps ?? [])]
  const removeAt = current.lastIndexOf(used)
  if (removeAt === -1) return current
  return current.filter((_, index) => index !== removeAt)
}

function randomPowerUp(): PowerUpType {
  const options: PowerUpType[] = ['double-down', 'fifty-fifty', 'time-freeze', 'sabotage']
  return options[Math.floor(Math.random() * options.length)]
}

export const createRoom = onCall<{ code: string; puzzles: Puzzle[] }>(async request => {
  const { code, puzzles } = request.data
  if (!/^\d{4}$/.test(code)) throw new HttpsError('invalid-argument', 'Room code must be 4 digits.')
  if (!Array.isArray(puzzles) || puzzles.length !== 30) {
    throw new HttpsError('invalid-argument', 'A room requires exactly 30 puzzles.')
  }

  const db = getDatabase()
  const roomRef = db.ref(roomPath(code))
  const existing = await roomRef.child('state').get()
  if (existing.exists()) throw new HttpsError('already-exists', 'Room code already exists.')

  await roomRef.set({
    puzzles,
    state: {
      phase: 'lobby',
      currentPuzzleIndex: 0,
      timerStart: 0,
      timerDuration: 25000,
    } satisfies RoomState,
    host: {
      puzzles,
    },
    public: {
      currentPuzzle: null,
      revealedAnswer: null,
      meta: {
        totalPuzzles: puzzles.length,
      },
      deltas: {},
      powerupEvents: {},
    },
    players: {},
    answers: {},
    powerUpsUsed: {},
    deltas: {},
    powerupEvents: {},
  })

  return { ok: true }
})

export const joinRoom = onCall<{ code: string; playerId: string; displayName: string }>(async request => {
  const { code, playerId, displayName } = request.data
  if (!code || !playerId || !displayName.trim()) {
    throw new HttpsError('invalid-argument', 'Code, playerId, and displayName are required.')
  }

  const db = getDatabase()
  const roomRef = db.ref(roomPath(code))
  const stateSnap = await roomRef.child('state').get()
  if (!stateSnap.exists()) throw new HttpsError('not-found', 'Room not found.')

  const playerRecord: PlayerRecord = {
    displayName: displayName.trim().slice(0, 20),
    score: 0,
    powerUps: [],
    joinedAt: Date.now(),
  }

  await roomRef.child(`players/${playerId}`).set(playerRecord)
  return { ok: true }
})

export const submitAnswer = onCall<{
  code: string
  playerId: string
  puzzleIndex: number
  answer: string
  powerUpUsed: PowerUpType | null
}>(async request => {
  const { code, playerId, puzzleIndex, answer, powerUpUsed } = request.data
  const db = getDatabase()
  const roomRef = db.ref(roomPath(code))
  const stateSnap = await roomRef.child('state').get()
  const state = stateSnap.val() as RoomState | null

  if (!state || state.phase !== 'puzzle-active') {
    throw new HttpsError('failed-precondition', 'Round is not accepting answers.')
  }
  if (state.currentPuzzleIndex !== puzzleIndex) {
    throw new HttpsError('failed-precondition', 'Puzzle index is no longer active.')
  }

  const payload: AnswerRecord = {
    answer: answer.trim(),
    submittedAt: Date.now(),
    powerUpUsed: powerUpUsed ?? null,
  }

  await roomRef.child(`answers/${puzzleIndex}/${playerId}`).set(payload)
  return { ok: true }
})

export const startRound = onCall<{ code: string; puzzleIndex?: number }>(async request => {
  const { code, puzzleIndex = 0 } = request.data
  const db = getDatabase()
  const roomRef = db.ref(roomPath(code))
  const roomSnap = await roomRef.get()
  const room = roomSnap.val() as { host?: { puzzles?: Puzzle[] } } | null
  const puzzle = room?.host?.puzzles?.[puzzleIndex]

  if (!puzzle) throw new HttpsError('not-found', 'Puzzle not found.')

  const now = Date.now()
  await db.ref().update({
    [`${roomPath(code)}/state/phase`]: 'puzzle-active',
    [`${roomPath(code)}/state/currentPuzzleIndex`]: puzzleIndex,
    [`${roomPath(code)}/state/timerStart`]: now,
    [`${roomPath(code)}/state/timerDuration`]: 25000,
    [`${roomPath(code)}/public/currentPuzzle`]: toPublicPuzzle(puzzle),
    [`${roomPath(code)}/public/revealedAnswer`]: null,
  })

  return { ok: true }
})

export const advanceRound = onCall<{ code: string }>(async request => {
  const { code } = request.data
  const db = getDatabase()
  const roomRef = db.ref(roomPath(code))
  const roomSnap = await roomRef.get()
  const room = roomSnap.val() as { state?: RoomState; host?: { puzzles?: Puzzle[] } } | null

  const currentIndex = room?.state?.currentPuzzleIndex ?? 0
  const nextIndex = currentIndex + 1
  const nextPuzzle = room?.host?.puzzles?.[nextIndex]

  if (!nextPuzzle) {
    await db.ref().update({
      [`${roomPath(code)}/state/phase`]: 'game-over',
      [`${roomPath(code)}/public/currentPuzzle`]: null,
      [`${roomPath(code)}/public/revealedAnswer`]: null,
    })
    return { ok: true, phase: 'game-over' }
  }

  const now = Date.now()
  await db.ref().update({
    [`${roomPath(code)}/state/phase`]: 'puzzle-active',
    [`${roomPath(code)}/state/currentPuzzleIndex`]: nextIndex,
    [`${roomPath(code)}/state/timerStart`]: now,
    [`${roomPath(code)}/state/timerDuration`]: 25000,
    [`${roomPath(code)}/public/currentPuzzle`]: toPublicPuzzle(nextPuzzle),
    [`${roomPath(code)}/public/revealedAnswer`]: null,
  })

  return { ok: true, phase: 'puzzle-active', puzzleIndex: nextIndex }
})

export const usePowerUp = onCall<{
  code: string
  playerId: string
  powerUp: PowerUpType
}>(async request => {
  const { code, playerId, powerUp } = request.data
  const db = getDatabase()
  const roomRef = db.ref(roomPath(code))
  const roomSnap = await roomRef.get()
  const room = roomSnap.val() as {
    players?: Record<string, PlayerRecord>
    public?: { powerupEvents?: Record<string, unknown> }
  } | null

  const player = room?.players?.[playerId]
  if (!player) throw new HttpsError('not-found', 'Player not found.')
  if (!(player.powerUps ?? []).includes(powerUp)) {
    throw new HttpsError('failed-precondition', 'Power-up not available.')
  }

  if (powerUp === 'sabotage') {
    const others = Object.entries(room?.players ?? {})
      .filter(([id]) => id !== playerId)
      .sort(([, a], [, b]) => b.score - a.score)

    if (others.length === 0) throw new HttpsError('failed-precondition', 'No valid sabotage target.')

    const [leaderId, leader] = others[0]
    await db.ref().update({
      [`${roomPath(code)}/players/${leaderId}/score`]: Math.max(0, leader.score - 100),
      [`${roomPath(code)}/players/${playerId}/score`]: (player.score ?? 0) + 100,
      [`${roomPath(code)}/players/${playerId}/powerUps`]: removeLastPowerUpInstance(player.powerUps, 'sabotage'),
      [`${roomPath(code)}/powerupEvents/${Date.now()}`]: {
        player: player.displayName,
        powerup: 'sabotage',
        target: leader.displayName,
        timestamp: Date.now(),
      },
      [`${roomPath(code)}/public/powerupEvents/${Date.now()}`]: {
        player: player.displayName,
        powerup: 'sabotage',
        target: leader.displayName,
        timestamp: Date.now(),
      },
    })

    return { ok: true, target: leader.displayName }
  }

  return { ok: true }
})

export const distributePowerUps = onCall<{ code: string }>(async request => {
  const { code } = request.data
  const db = getDatabase()
  const roomRef = db.ref(roomPath(code))
  const playersSnap = await roomRef.child('players').get()
  const players = (playersSnap.val() ?? {}) as Record<string, PlayerRecord>
  const updates: Record<string, unknown> = {}
  const timestampBase = Date.now()

  for (const [playerId, player] of Object.entries(players)) {
    const nextPowerUp = randomPowerUp()
    const current = [...(player.powerUps ?? [])]
    const capped = current.length >= 2 ? current.slice(1) : current
    updates[`${roomPath(code)}/players/${playerId}/powerUps`] = [...capped, nextPowerUp]
    updates[`${roomPath(code)}/powerupEvents/${timestampBase}-${playerId}`] = {
      player: player.displayName,
      powerup: nextPowerUp,
      timestamp: timestampBase,
    }
    updates[`${roomPath(code)}/public/powerupEvents/${timestampBase}-${playerId}`] = {
      player: player.displayName,
      powerup: nextPowerUp,
      timestamp: timestampBase,
    }
  }

  await db.ref().update(updates)
  return { ok: true }
})

export const revealRound = onCall<{ code: string }>(async request => {
  const { code } = request.data
  const db = getDatabase()
  const roomRef = db.ref(roomPath(code))
  const roomSnap = await roomRef.get()
  const room = roomSnap.val() as {
    state: RoomState
    host?: { puzzles?: Puzzle[] }
    players?: Record<string, PlayerRecord>
    answers?: Record<string, Record<string, AnswerRecord>>
  } | null

  if (!room?.state || room.state.phase !== 'puzzle-active') {
    throw new HttpsError('failed-precondition', 'Round is not active.')
  }

  const puzzleIndex = room.state.currentPuzzleIndex
  const puzzles = room.host?.puzzles ?? []
  const puzzle = puzzles[puzzleIndex]
  if (!puzzle) throw new HttpsError('not-found', 'Puzzle not found.')

  const answers = room.answers?.[String(puzzleIndex)] ?? {}
  const players = room.players ?? {}
  const deltas: Record<string, ScoreDelta> = {}
  const updates: Record<string, unknown> = {
    [`${roomPath(code)}/state/phase`]: 'puzzle-revealed',
    [`${roomPath(code)}/public/revealedAnswer`]: puzzle.answers[0],
  }

  for (const [playerId, player] of Object.entries(players)) {
    const answer = answers[playerId]
    if (!answer) continue

    const correct = isCorrectAnswer(answer.answer ?? '', puzzle.answers)
    const elapsed = Math.max(0, (answer.submittedAt ?? Date.now()) - room.state.timerStart)
    const speedBonus = Math.max(0, Math.round(500 * (1 - elapsed / room.state.timerDuration)))
    const basePoints = 1000 + speedBonus

    let points = 0
    if (correct) {
      points = answer.powerUpUsed === 'double-down' ? basePoints * 2 : basePoints
    } else {
      if (puzzle.type === 'sudden-death') points = -500
      if (answer.powerUpUsed === 'double-down') points = -(player.score ?? 0)
    }

    deltas[playerId] = {
      points,
      correct,
      powerUpUsed: answer.powerUpUsed ?? null,
    }
    updates[`${roomPath(code)}/players/${playerId}/score`] = Math.max(0, (player.score ?? 0) + points)

    if (answer.powerUpUsed) {
      updates[`${roomPath(code)}/players/${playerId}/powerUps`] = removeLastPowerUpInstance(player.powerUps, answer.powerUpUsed)
    }
  }

  updates[`${roomPath(code)}/public/deltas/${puzzleIndex}`] = deltas
  updates[`${roomPath(code)}/deltas/${puzzleIndex}`] = deltas
  await db.ref().update(updates)

  return { ok: true, deltas }
})
