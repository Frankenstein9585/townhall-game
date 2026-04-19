import {
  buildHostRoom,
  buildPublicRoom,
  createInitialRoom,
  expirePowerUps,
  randomPowerUp,
  removeLastPowerUpInstance,
  resolveRound,
  toPublicPuzzle,
} from './gameEngine.js'

function roomChannel(code) {
  return `room:${code}`
}

function generateRoomCode() {
  return String(Math.floor(1000 + Math.random() * 9000))
}

async function broadcastRoom(io, room) {
  const serverNow = Date.now()
  io.to(roomChannel(room.code)).emit('room:state', { ...buildPublicRoom(room), serverNow })
  if (room.hostSocketId) {
    io.to(room.hostSocketId).emit('host:state', { ...buildHostRoom(room), serverNow })
  }
}

function requireRoom(room, ack) {
  if (room) return true
  ack?.({ ok: false, error: 'Room not found.' })
  return false
}

export function registerSocketHandlers(io, store) {
  io.on('connection', socket => {
    socket.on('host:create_room', async (payload, ack) => {
      try {
        const puzzles = Array.isArray(payload?.puzzles) ? payload.puzzles : []
        if (puzzles.length < 1) {
          ack?.({ ok: false, error: 'Room requires at least 1 puzzle.' })
          return
        }

        let code = payload?.code || generateRoomCode()
        while (await store.getRoom(code)) {
          code = generateRoomCode()
        }

        const timerDuration = Number(payload?.timerDuration) || 15000
        const room = createInitialRoom({ code, puzzles, hostSocketId: socket.id, timerDuration })
        await store.saveRoom(code, room)
        socket.join(roomChannel(code))
        ack?.({ ok: true, code, room: buildHostRoom(room) })
      } catch (error) {
        ack?.({ ok: false, error: error instanceof Error ? error.message : 'Failed to create room.' })
      }
    })

    socket.on('host:attach', async (payload, ack) => {
      const room = await store.getRoom(payload?.code)
      if (!requireRoom(room, ack)) return
      room.hostSocketId = socket.id
      await store.saveRoom(room.code, room)
      socket.join(roomChannel(room.code))
      ack?.({ ok: true, room: buildHostRoom(room) })
      await broadcastRoom(io, room)
    })

    socket.on('player:join_room', async (payload, ack) => {
      const room = await store.getRoom(payload?.code)
      if (!requireRoom(room, ack)) return

      const playerId = String(payload?.playerId || '')
      const displayName = String(payload?.displayName || '').trim().slice(0, 20)
      if (!playerId || !displayName) {
        ack?.({ ok: false, error: 'playerId and displayName are required.' })
        return
      }

      room.players[playerId] = {
        ...(room.players[playerId] || {}),
        socketId: socket.id,
        displayName,
        score: room.players[playerId]?.score || 0,
        powerUps: room.players[playerId]?.powerUps || [],
        joinedAt: room.players[playerId]?.joinedAt || Date.now(),
      }
      await store.saveRoom(room.code, room)
      socket.join(roomChannel(room.code))
      ack?.({
        ok: true,
        room: buildPublicRoom(room),
        player: {
          displayName: room.players[playerId].displayName,
          score: room.players[playerId].score,
          powerUps: room.players[playerId].powerUps.map(p => p.type),
          joinedAt: room.players[playerId].joinedAt,
        },
      })
      await broadcastRoom(io, room)
    })

    socket.on('host:start_round', async (payload, ack) => {
      const room = await store.getRoom(payload?.code)
      if (!requireRoom(room, ack)) return

      const puzzleIndex = Number(payload?.puzzleIndex ?? 0)
      const puzzle = room.puzzles[puzzleIndex]
      if (!puzzle) {
        ack?.({ ok: false, error: 'Puzzle not found.' })
        return
      }

      room.state = {
        phase: 'puzzle-active',
        currentPuzzleIndex: puzzleIndex,
        timerStart: Date.now(),
        timerDuration: room.timerDuration || 15000,
      }
      room.public.currentPuzzle = toPublicPuzzle(puzzle)
      room.public.revealedAnswer = null
      room.sabotagedThisRound = []
      await store.saveRoom(room.code, room)
      ack?.({ ok: true })
      await broadcastRoom(io, room)
    })

    socket.on('player:submit_answer', async (payload, ack) => {
      const room = await store.getRoom(payload?.code)
      if (!requireRoom(room, ack)) return
      if (room.state.phase !== 'puzzle-active') {
        ack?.({ ok: false, error: 'Round is not accepting answers.' })
        return
      }

      const playerId = String(payload?.playerId || '')
      if (!room.players[playerId]) {
        ack?.({ ok: false, error: 'Player not found.' })
        return
      }

      const roundKey = String(room.state.currentPuzzleIndex)
      room.answers[roundKey] = room.answers[roundKey] || {}
      room.answers[roundKey][playerId] = {
        answer: String(payload?.answer || '').trim(),
        submittedAt: Date.now(),
        powerUpUsed: payload?.powerUpUsed || null,
      }
      await store.saveRoom(room.code, room)
      ack?.({ ok: true })
      await broadcastRoom(io, room)
    })

    socket.on('player:use_powerup', async (payload, ack) => {
      const room = await store.getRoom(payload?.code)
      if (!requireRoom(room, ack)) return

      const playerId = String(payload?.playerId || '')
      const powerUp = payload?.powerUp
      const player = room.players[playerId]
      if (!player) {
        ack?.({ ok: false, error: 'Player not found.' })
        return
      }
      if (!player.powerUps.some(pu => pu.type === powerUp)) {
        ack?.({ ok: false, error: 'Power-up not available.' })
        return
      }

      // Remove the power-up for all types
      player.powerUps = removeLastPowerUpInstance(player.powerUps, powerUp)

      // Sabotage has an additional scoring effect
      if (powerUp === 'sabotage') {
        const alreadyHit = room.sabotagedThisRound || []
        // Prefer a target not yet hit this round to prevent pile-ons on the leader
        const eligible = Object.entries(room.players)
          .filter(([id]) => id !== playerId && !alreadyHit.includes(id))
          .sort(([, a], [, b]) => b.score - a.score)
        const allOthers = Object.entries(room.players)
          .filter(([id]) => id !== playerId)
          .sort(([, a], [, b]) => b.score - a.score)
        const [targetId, targetPlayer] = eligible[0] ?? allOthers[0] ?? []
        if (!targetPlayer) {
          ack?.({ ok: false, error: 'No valid sabotage target.' })
          return
        }

        targetPlayer.score = Math.max(0, targetPlayer.score - 100)
        player.score += 100
        if (!alreadyHit.includes(targetId)) {
          room.sabotagedThisRound = [...alreadyHit, targetId]
        }
        room.powerupEvents.push({
          player: player.displayName,
          powerup: 'sabotage',
          target: targetPlayer.displayName,
          timestamp: Date.now(),
        })
      }

      await store.saveRoom(room.code, room)
      ack?.({ ok: true })
      await broadcastRoom(io, room)
    })

    socket.on('host:reveal_round', async (payload, ack) => {
      const room = await store.getRoom(payload?.code)
      if (!requireRoom(room, ack)) return

      const puzzleIndex = room.state.currentPuzzleIndex
      const puzzle = room.puzzles[puzzleIndex]
      const answers = room.answers[String(puzzleIndex)] || {}
      const { deltas, wrongSubmissions } = resolveRound({
        puzzle,
        answers,
        players: room.players,
        timerStart: room.state.timerStart,
        timerDuration: room.state.timerDuration,
      })

      for (const [playerId, delta] of Object.entries(deltas)) {
        room.players[playerId].score = Math.max(0, room.players[playerId].score + delta.points)
      }

      room.deltas[String(puzzleIndex)] = deltas
      room.wrongSubmissions[String(puzzleIndex)] = wrongSubmissions
      room.state.phase = 'puzzle-revealed'
      room.public.revealedAnswer = puzzle.answers[0]
      await store.saveRoom(room.code, room)
      ack?.({ ok: true, deltas, wrongSubmissions })
      await broadcastRoom(io, room)
    })

    socket.on('host:advance_round', async (payload, ack) => {
      const room = await store.getRoom(payload?.code)
      if (!requireRoom(room, ack)) return

      const nextIndex = room.state.currentPuzzleIndex + 1

      // Expire power-ups that have been held too long
      expirePowerUps(room.players, nextIndex)

      const nextPuzzle = room.puzzles[nextIndex]
      if (!nextPuzzle) {
        room.state.phase = 'game-over'
        room.public.currentPuzzle = null
        room.public.revealedAnswer = null
        await store.saveRoom(room.code, room)
        ack?.({ ok: true, phase: 'game-over' })
        await broadcastRoom(io, room)
        return
      }

      room.state = {
        phase: 'puzzle-active',
        currentPuzzleIndex: nextIndex,
        timerStart: Date.now(),
        timerDuration: room.timerDuration || 15000,
      }
      room.public.currentPuzzle = toPublicPuzzle(nextPuzzle)
      room.public.revealedAnswer = null
      room.sabotagedThisRound = []
      await store.saveRoom(room.code, room)
      ack?.({ ok: true, phase: 'puzzle-active', puzzleIndex: nextIndex })
      await broadcastRoom(io, room)
    })

    socket.on('host:end_game', async (payload, ack) => {
      const room = await store.getRoom(payload?.code)
      if (!requireRoom(room, ack)) return
      room.state.phase = 'game-over'
      room.public.currentPuzzle = null
      room.public.revealedAnswer = null
      await store.saveRoom(room.code, room)
      ack?.({ ok: true })
      await broadcastRoom(io, room)
    })

    socket.on('host:restart_game', async (payload, ack) => {
      const room = await store.getRoom(payload?.code)
      if (!requireRoom(room, ack)) return

      for (const player of Object.values(room.players)) {
        player.score = 0
        player.powerUps = []
      }
      room.state = {
        phase: 'lobby',
        currentPuzzleIndex: 0,
        timerStart: 0,
        timerDuration: room.timerDuration || 15000,
      }
      room.answers = {}
      room.deltas = {}
      room.wrongSubmissions = {}
      room.powerupEvents = []
      room.sabotagedThisRound = []
      room.public.currentPuzzle = null
      room.public.revealedAnswer = null

      await store.saveRoom(room.code, room)
      ack?.({ ok: true })
      await broadcastRoom(io, room)
    })

    socket.on('host:distribute_powerups', async (payload, ack) => {
      const room = await store.getRoom(payload?.code)
      if (!requireRoom(room, ack)) return

      const assignedRound = room.state.currentPuzzleIndex + 1

      for (const player of Object.values(room.players)) {
        const updated = player.powerUps.length >= 2 ? player.powerUps.slice(1) : [...player.powerUps]
        const nextPowerUp = randomPowerUp()
        player.powerUps = [...updated, { type: nextPowerUp, assignedRound }]
        room.powerupEvents.push({
          player: player.displayName,
          powerup: nextPowerUp,
          timestamp: Date.now(),
        })
      }

      await store.saveRoom(room.code, room)
      ack?.({ ok: true })
      await broadcastRoom(io, room)
    })
  })
}
