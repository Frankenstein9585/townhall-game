import { useState, useEffect, useRef, useCallback } from 'react'
import type { Puzzle, PlayerData, GameState, ScoreDelta, PowerUpEvent, PowerUpType } from './types'
import { POWERUP_LABELS } from './types'
import questionData from '../questions.json'
import { validatePuzzleJson } from './fuzzyMatch'
import { createSocketApi, type SocketApi } from './socketApi'
import { HOST_SESSION_KEY } from './constants'

type HostPhase = 'setup' | 'lobby' | 'puzzle-active' | 'puzzle-revealed' | 'game-over' | 'reconnecting'

type HostPlayerRecord = PlayerData & { displayName?: string }

function toDisplayPlayers(players: Record<string, HostPlayerRecord>): Record<string, PlayerData> {
  return Object.fromEntries(
    Object.entries(players).map(([, data]) => [
      data.displayName ?? 'Unknown',
      {
        score: data.score,
        powerUps: Array.isArray(data.powerUps) ? data.powerUps : [],
        joinedAt: data.joinedAt,
      },
    ]),
  )
}

function toDisplayDeltas(players: Record<string, HostPlayerRecord>, deltas: Record<string, ScoreDelta>): Record<string, ScoreDelta> {
  return Object.fromEntries(
    Object.entries(deltas).map(([playerId, delta]) => [players[playerId]?.displayName ?? playerId, delta]),
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-gray-900 rounded-lg border border-gray-700 ${className}`}>
      {children}
    </div>
  )
}

function Timer({ timerStart, duration, onExpire }: { timerStart: number; duration: number; onExpire?: () => void }) {
  const [remaining, setRemaining] = useState(duration)
  const expiredRef = useRef(false)
  const onExpireRef = useRef(onExpire)
  onExpireRef.current = onExpire

  useEffect(() => {
    expiredRef.current = false
    const tick = () => {
      const elapsed = Date.now() - timerStart
      const left = Math.max(0, duration - elapsed)
      setRemaining(left)
      if (left === 0 && !expiredRef.current) {
        expiredRef.current = true
        onExpireRef.current?.()
      }
    }
    tick()
    const id = setInterval(tick, 200)
    return () => clearInterval(id)
  }, [timerStart, duration])

  const pct = remaining / duration
  const secs = Math.ceil(remaining / 1000)
  const color = pct > 0.5 ? 'bg-green-500' : pct > 0.25 ? 'bg-yellow-500' : 'bg-red-500'

  return (
    <div className="w-full">
      <div className="flex justify-between text-sm text-gray-400 mb-1">
        <span>Time remaining</span>
        <span className={`font-bold text-base font-mono ${secs <= 5 ? 'text-red-400 animate-pulse-fast' : 'text-white'}`}>
          {secs}s
        </span>
      </div>
      <div className="h-2 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-200`}
          style={{ width: `${pct * 100}%` }}
        />
      </div>
    </div>
  )
}

function Leaderboard({ players, deltas, limit }: { players: Record<string, PlayerData>; deltas?: Record<string, ScoreDelta>; limit?: number }) {
  const sorted = Object.entries(players)
    .sort(([, a], [, b]) => b.score - a.score)
    .slice(0, limit)

  const medals = ['🥇', '🥈', '🥉']

  return (
    <div>
      {sorted.map(([name, data], i) => {
        const delta = deltas?.[name]
        return (
          <div key={name} className={`flex items-center gap-3 px-3 py-2.5 ${i < sorted.length - 1 ? 'border-b border-gray-800' : ''}`}>
            <span className="text-sm w-6 text-center text-gray-500">{medals[i] ?? i + 1}</span>
            <span className="flex-1 font-medium truncate text-sm">{name}</span>
            <div className="text-right">
              <div className="font-bold font-mono text-amber-400 text-sm">{data.score.toLocaleString()}</div>
              {delta && (
                <div className={`text-xs font-medium ${delta.correct ? 'text-green-400' : 'text-red-400'}`}>
                  {delta.points >= 0 ? '+' : ''}{delta.points.toLocaleString()}
                </div>
              )}
              {delta?.powerUpUsed && (
                <div className="text-xs text-gray-500 mt-0.5">{POWERUP_LABELS[delta.powerUpUsed]}</div>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function PlayerInventoryCard({ players }: { players: Record<string, PlayerData> }) {
  return (
    <Card className="p-4">
      <div className="text-xs text-gray-500 mb-2 font-semibold uppercase tracking-wider">Player Power-ups</div>
      <div className="space-y-1.5">
        {Object.entries(players).map(([name, data]) => (
          <div key={name} className="flex items-center justify-between gap-2">
            <span className="text-xs text-gray-300 truncate flex-1">{name}</span>
            <div className="flex gap-1 flex-shrink-0">
              {data.powerUps.length === 0
                ? <span className="text-gray-700 text-xs">—</span>
                : data.powerUps.map((p, i) => (
                    <span key={i} className="text-xs border border-gray-600 text-gray-300 px-1.5 py-0.5 rounded">
                      {POWERUP_LABELS[p]}
                    </span>
                  ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ─── Setup Screen ────────────────────────────────────────────────────────────

function SetupScreen({ onRoomCreated }: { onRoomCreated: (puzzles: Puzzle[], timerSeconds: number) => Promise<void> }) {
  const [jsonText, setJsonText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [puzzles, setPuzzles] = useState<Puzzle[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [showDefault, setShowDefault] = useState(false)
  const [timerSeconds, setTimerSeconds] = useState(15)

  function validate(text: string) {
    setJsonText(text)
    if (!text.trim()) { setError(null); setPuzzles(null); return }
    const { puzzles: p, error: e } = validatePuzzleJson(text)
    setError(e)
    setPuzzles(p as Puzzle[] | null)
  }

  async function handleCreate() {
    if (!puzzles) return
    setCreating(true)
    try {
      await onRoomCreated(puzzles, timerSeconds)
    } catch {
      setError('Failed to create room. Check the server is running and try again.')
      setCreating(false)
    }
  }

  const defaultJson = JSON.stringify(questionData, null, 2)

  return (
    <div className="max-w-2xl mx-auto p-6 animate-fade-in">
      <h2 className="text-xl font-bold mb-1 uppercase tracking-wide">Setup</h2>
      <p className="text-gray-500 text-sm mb-6">Paste your puzzle JSON or load the defaults.</p>

      <div className="flex gap-2 mb-4">
        <button
          onClick={() => validate(defaultJson)}
          className="text-sm px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-colors font-medium"
        >
          Load defaults
        </button>
        <button
          onClick={() => setShowDefault(v => !v)}
          className="text-sm px-4 py-2 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 transition-colors font-medium"
        >
          {showDefault ? 'Hide' : 'Preview'} JSON
        </button>
      </div>

      {showDefault && (
        <Card className="mb-4 p-4 max-h-48 overflow-y-auto">
          <pre className="text-xs text-gray-500 whitespace-pre-wrap">{defaultJson}</pre>
        </Card>
      )}

      <textarea
        value={jsonText}
        onChange={e => validate(e.target.value)}
        placeholder='Paste puzzle JSON here, or click "Load defaults" above...'
        className="w-full h-40 bg-gray-900 border border-gray-700 rounded-lg p-4 font-mono text-sm text-gray-200 focus:outline-none focus:border-amber-500 transition-colors resize-none"
      />

      {error && (
        <div className="mt-3 p-3 border border-red-700 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {puzzles && !error && (
        <div className="mt-3 p-3 border border-green-700 rounded-lg text-green-400 text-sm">
          {puzzles.length} puzzles validated — {puzzles.filter(p => p.tier === 'fintech').length} fintech, {puzzles.filter(p => p.type === 'sudden-death').length} Sudden Death
        </div>
      )}

      {puzzles && !error && (
        <div className="mt-4 max-h-48 overflow-y-auto space-y-1">
          {puzzles.map((p, i) => (
            <div key={p.id} className="flex items-center gap-3 text-sm bg-gray-900 border border-gray-800 rounded px-3 py-1.5">
              <span className="text-gray-600 w-5 text-xs">{i + 1}</span>
              <span className="text-xs text-gray-400 truncate flex-1">{p.image}</span>
              <span className={`text-xs px-2 py-0.5 rounded-full border ${p.tier === 'fintech' ? 'border-amber-600 text-amber-400' : 'border-blue-700 text-blue-400'}`}>
                {p.tier}
              </span>
              {p.type === 'sudden-death' && (
                <span className="text-xs px-2 py-0.5 rounded-full border border-red-700 text-red-400">⚡ SD</span>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="mt-6">
        <label className="block text-xs text-gray-500 mb-2 uppercase tracking-wider font-semibold">
          Time per puzzle — <span className="text-white">{timerSeconds}s</span>
        </label>
        <div className="flex gap-2">
          {[10, 15, 20, 25, 30].map(s => (
            <button
              key={s}
              onClick={() => setTimerSeconds(s)}
              className={`flex-1 py-2 rounded-lg text-sm font-bold transition-colors ${timerSeconds === s ? 'bg-amber-400 text-gray-900' : 'bg-gray-800 text-gray-400 hover:bg-gray-700 border border-gray-700'}`}
            >
              {s}s
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={handleCreate}
        disabled={!puzzles || !!error || creating}
        className="mt-4 w-full py-4 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed text-gray-900 transition-colors font-bold text-lg"
      >
        {creating ? 'Creating room…' : 'Create Room →'}
      </button>
    </div>
  )
}

// ─── Lobby Screen ─────────────────────────────────────────────────────────────

function LobbyScreen({ code, players, onStart }: { code: string; players: Record<string, PlayerData>; onStart: () => void }) {
  const count = Object.keys(players).length
  const url = window.location.href

  function copyUrl() {
    navigator.clipboard.writeText(url).catch(() => {})
  }

  return (
    <div className="max-w-lg mx-auto p-6 animate-fade-in">
      <p className="text-gray-500 text-xs mb-2 text-center uppercase tracking-wider">Players join at:</p>
      <button onClick={copyUrl} className="w-full mb-6 p-3 bg-gray-900 border border-gray-700 rounded-lg text-gray-400 text-xs hover:border-gray-500 transition-colors truncate font-mono">
        {url}
      </button>

      <Card className="p-8 text-center mb-6">
        <p className="text-gray-500 text-xs uppercase tracking-widest mb-3">Room Code</p>
        <div className="text-7xl font-black tracking-widest text-amber-400 font-mono">{code}</div>
        <p className="text-gray-600 text-sm mt-3">Share this with your players</p>
      </Card>

      <Card className="p-4 mb-6">
        <div className="flex justify-between items-center mb-3">
          <span className="text-sm font-semibold text-gray-300 uppercase tracking-wide">Players</span>
          <span className="text-amber-400 font-bold font-mono text-sm">{count}</span>
        </div>
        {count === 0 ? (
          <p className="text-gray-700 text-sm text-center py-4">Waiting for players to join…</p>
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {Object.keys(players).map(name => (
              <div key={name} className="bg-gray-800 border border-gray-700 rounded px-3 py-2 text-sm font-medium truncate">
                {name}
              </div>
            ))}
          </div>
        )}
      </Card>

      <button
        onClick={onStart}
        disabled={count < 2}
        className="w-full py-4 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed text-gray-900 transition-colors font-bold text-lg"
      >
        {count < 2 ? `Need at least 2 players (${count}/2)` : `Start Game →`}
      </button>
    </div>
  )
}

// ─── Puzzle Screen (Host) ─────────────────────────────────────────────────────

function HostPuzzleScreen({
  puzzle, puzzleIndex, totalPuzzles, timerStart, timerDuration,
  players, answeredCount, powerUpFeed, onReveal,
}: {
  puzzle: Puzzle
  puzzleIndex: number
  totalPuzzles: number
  timerStart: number
  timerDuration: number
  players: Record<string, PlayerData>
  answeredCount: number
  powerUpFeed: PowerUpEvent[]
  onReveal: () => void
}) {
  const [timerExpired, setTimerExpired] = useState(false)
  const totalPlayers = Object.keys(players).length

  return (
    <div className="max-w-2xl mx-auto p-6 animate-slide-up">
      <div className="flex justify-between items-center mb-4">
        <div className="flex items-center gap-2">
          <span className="text-gray-500 text-sm font-mono">{puzzleIndex + 1} / {totalPuzzles}</span>
          <span className={`text-xs px-2 py-0.5 rounded-full border ${puzzle.tier === 'fintech' ? 'border-amber-600 text-amber-400' : 'border-blue-700 text-blue-400'}`}>
            {puzzle.tier}
          </span>
        </div>
        {puzzle.type === 'sudden-death' && (
          <span className="text-xs px-3 py-1 rounded-full border border-red-600 text-red-400 font-bold">
            ⚡ SUDDEN DEATH
          </span>
        )}
      </div>

      <Card className="p-8 text-center mb-4">
        <img src={`/Rebus/${puzzle.image}`} alt="" className="max-h-52 object-contain mx-auto mb-6" />
        <Timer timerStart={timerStart} duration={timerDuration} onExpire={() => setTimerExpired(true)} />
      </Card>

      <div className="grid grid-cols-2 gap-4 mb-4">
        <Card className="p-4 text-center">
          <div className="text-3xl font-black text-amber-400 font-mono">{answeredCount} / {totalPlayers}</div>
          <div className="text-gray-500 text-xs mt-1 uppercase tracking-wide">Submitted</div>
        </Card>
        <Card className="p-4">
          <div className="text-xs text-gray-500 mb-2 font-semibold uppercase tracking-wider">Power-up Feed</div>
          {powerUpFeed.length === 0 ? (
            <p className="text-gray-700 text-xs">No activity yet</p>
          ) : (
            <div className="space-y-1 max-h-20 overflow-y-auto">
              {[...powerUpFeed].reverse().slice(0, 5).map((e, i) => (
                <div key={i} className="text-xs text-gray-400">
                  <span className="text-amber-400">{e.player}</span> used {POWERUP_LABELS[e.powerup as PowerUpType]}
                  {e.target && <span className="text-red-400"> on {e.target}</span>}
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      <PlayerInventoryCard players={players} />

      <button
        onClick={onReveal}
        disabled={!timerExpired && answeredCount < totalPlayers}
        className="mt-4 w-full py-4 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed text-gray-900 transition-colors font-bold text-lg"
      >
        {!timerExpired && answeredCount < totalPlayers
          ? `Waiting… (${answeredCount}/${totalPlayers} answered)`
          : 'Reveal Answer →'}
      </button>
      {(timerExpired || answeredCount === totalPlayers) && (
        <p className="text-center text-gray-600 text-xs mt-2">Ready to reveal</p>
      )}
    </div>
  )
}

// ─── Results Screen (Host) ────────────────────────────────────────────────────

function HostResultsScreen({
  puzzle, puzzleIndex, totalPuzzles, players, deltas, wrongSubmissions, powerUpDropping, onNext,
}: {
  puzzle: Puzzle
  puzzleIndex: number
  totalPuzzles: number
  players: Record<string, PlayerData>
  deltas: Record<string, ScoreDelta>
  wrongSubmissions: string[]
  powerUpDropping: boolean
  onNext: () => void
}) {
  const correctCount = Object.values(deltas).filter(d => d.correct).length

  return (
    <div className="max-w-2xl mx-auto p-6 animate-slide-up">
      <div className="flex justify-between items-center mb-4">
        <span className="text-gray-500 text-sm font-mono">Puzzle {puzzleIndex + 1} / {totalPuzzles}</span>
        {puzzle.type === 'sudden-death' && (
          <span className="text-xs px-2 py-0.5 rounded-full border border-red-700 text-red-400">⚡ Sudden Death</span>
        )}
      </div>

      <Card className="p-6 text-center mb-4">
        <p className="text-gray-500 text-xs uppercase tracking-wider mb-2">Answer</p>
        <img src={`/Rebus/${puzzle.image}`} alt="" className="max-h-28 object-contain mx-auto mb-3" />
        <div className="text-2xl font-black text-green-400 uppercase tracking-wide">{puzzle.answers[0]}</div>
        <p className="text-gray-500 text-sm mt-1 italic">{puzzle.hint}</p>
        <div className="mt-3 text-xs text-gray-500 font-mono">
          {correctCount} / {Object.keys(players).length} correct
        </div>
      </Card>

      {wrongSubmissions.length > 0 && (
        <Card className="p-4 mb-4">
          <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-2">Wrong submissions</p>
          <div className="flex flex-wrap gap-2">
            {wrongSubmissions.slice(0, 12).map((s, i) => (
              <span key={i} className="text-xs border border-red-800 text-red-400 px-2 py-1 rounded">{s || '(empty)'}</span>
            ))}
          </div>
        </Card>
      )}

      <Card className="p-4 mb-4">
        <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-3">Top 5</p>
        <Leaderboard players={players} deltas={deltas} limit={5} />
      </Card>

      {powerUpDropping && (
        <div className="mb-4 p-3 border border-gray-600 rounded-lg text-gray-300 text-sm text-center">
          🎁 Power-ups distributed to all players
        </div>
      )}

      <button
        onClick={onNext}
        className="w-full py-4 rounded-lg bg-amber-400 hover:bg-amber-300 text-gray-900 transition-colors font-bold text-lg"
      >
        {puzzleIndex + 1 >= totalPuzzles ? 'See Final Results →' : 'Next Puzzle →'}
      </button>
    </div>
  )
}

// ─── Final Leaderboard ────────────────────────────────────────────────────────

function FinalLeaderboard({ players, onRestart }: { players: Record<string, PlayerData>; onRestart: () => void }) {
  const sorted = Object.entries(players).sort(([, a], [, b]) => b.score - a.score)
  const winner = sorted[0]

  return (
    <div className="max-w-lg mx-auto p-6 animate-fade-in">
      <div className="text-center mb-8">
        <h2 className="text-4xl font-black text-white">{winner?.[0]}</h2>
        <p className="text-amber-400 font-mono font-bold text-xl mt-1">{winner?.[1].score.toLocaleString()} pts</p>
        <p className="text-gray-500 text-sm mt-1">wins the game</p>
      </div>

      <Card className="mb-6">
        <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider px-4 pt-4 pb-2">Final Standings</p>
        {sorted.map(([name, data], i) => {
          const medals = ['🥇', '🥈', '🥉']
          return (
            <div key={name} className={`flex items-center gap-3 px-4 py-3 ${i === 0 ? 'border-l-2 border-amber-400' : ''} ${i < sorted.length - 1 ? 'border-b border-gray-800' : ''}`}>
              <span className="text-sm w-6 text-center">{medals[i] ?? i + 1}</span>
              <span className="flex-1 font-semibold truncate">{name}</span>
              <span className={`font-bold font-mono ${i === 0 ? 'text-amber-400' : 'text-gray-300'}`}>
                {data.score.toLocaleString()}
              </span>
            </div>
          )
        })}
      </Card>

      <button
        onClick={onRestart}
        className="w-full py-4 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white transition-colors font-semibold"
      >
        ← Back to Home
      </button>
    </div>
  )
}

// ─── Main HostApp ─────────────────────────────────────────────────────────────

export default function HostApp({ onExit }: { onExit: () => void }) {
  const [hostPhase, setHostPhase] = useState<HostPhase>('setup')
  const [roomCode, setRoomCode] = useState('')
  const [puzzles, setPuzzles] = useState<Puzzle[]>([])
  const [players, setPlayers] = useState<Record<string, HostPlayerRecord>>({})
  const [gameState, setGameState] = useState<GameState | null>(null)
  const [answeredCount, setAnsweredCount] = useState(0)
  const [deltas, setDeltas] = useState<Record<string, ScoreDelta>>({})
  const [wrongSubmissions, setWrongSubmissions] = useState<string[]>([])
  const [powerUpFeed, setPowerUpFeed] = useState<PowerUpEvent[]>([])
  const [powerUpDropping, setPowerUpDropping] = useState(false)
  const displayPlayers = toDisplayPlayers(players)
  const displayDeltas = toDisplayDeltas(players, deltas)

  const socketApiRef = useRef<SocketApi | null>(null)

  function attachHostStateListener(api: SocketApi) {
    api.onHostState(snapshot => {
      setPlayers(snapshot.players as Record<string, HostPlayerRecord>)
      setGameState(snapshot.state)
      setPowerUpFeed(snapshot.powerupEvents)
      const puzzleKey = String(snapshot.state.currentPuzzleIndex)
      setAnsweredCount(Object.keys(snapshot.answers?.[puzzleKey] ?? {}).length)
      if (snapshot.state.phase === 'puzzle-active') setHostPhase('puzzle-active')
      else if (snapshot.state.phase === 'puzzle-revealed') setHostPhase('puzzle-revealed')
      else if (snapshot.state.phase === 'game-over') setHostPhase('game-over')
    })
  }

  useEffect(() => {
    const api = createSocketApi()
    socketApiRef.current = api

    const stored = localStorage.getItem(HOST_SESSION_KEY)
    if (stored) {
      setHostPhase('reconnecting')
      const { roomCode: savedCode } = JSON.parse(stored) as { roomCode: string }
      api.connect().then(async () => {
        try {
          const { room } = await api.attachHost(savedCode)
          const snap = room as typeof room & {
            answers?: Record<string, Record<string, unknown>>
            deltas?: Record<string, Record<string, ScoreDelta>>
            wrongSubmissions?: Record<string, string[]>
          }
          setRoomCode(savedCode)
          setPuzzles(room.puzzles)
          setPlayers(room.players as Record<string, HostPlayerRecord>)
          setGameState(room.state)
          setPowerUpFeed(room.powerupEvents)
          const puzzleKey = String(room.state.currentPuzzleIndex)
          setAnsweredCount(Object.keys(snap.answers?.[puzzleKey] ?? {}).length)
          if (room.state.phase === 'puzzle-revealed') {
            setDeltas((snap.deltas?.[puzzleKey] ?? {}) as Record<string, ScoreDelta>)
            setWrongSubmissions(snap.wrongSubmissions?.[puzzleKey] ?? [])
          }
          attachHostStateListener(api)
          setHostPhase(room.state.phase as HostPhase)
        } catch {
          localStorage.removeItem(HOST_SESSION_KEY)
          setHostPhase('setup')
        }
      })
    }

    return () => { api.disconnect() }
  }, [])

  const handleRoomCreated = useCallback(async (pzls: Puzzle[], timerSeconds: number) => {
    const api = socketApiRef.current!
    await api.connect()
    const { code } = await api.createRoom({ puzzles: pzls, timerDuration: timerSeconds * 1000 })
    localStorage.setItem(HOST_SESSION_KEY, JSON.stringify({ roomCode: code }))
    setRoomCode(code)
    setPuzzles(pzls)
    setHostPhase('lobby')
    attachHostStateListener(api)
  }, [])

  async function handleStartGame() {
    await socketApiRef.current!.startRound({ code: roomCode })
  }

  async function handleReveal() {
    const result = await socketApiRef.current!.revealRound(roomCode)
    const roundDeltas = result.deltas as Record<string, ScoreDelta>
    const roundWrongs = result.wrongSubmissions
    setDeltas(roundDeltas)
    setWrongSubmissions(roundWrongs)
  }

  async function handleNext() {
    const idx = gameState?.currentPuzzleIndex ?? 0
    const isDrop = [3, 6, 9, 12, 15, 18, 21, 24, 27].includes(idx + 1)

    if (isDrop) {
      setPowerUpDropping(true)
      await socketApiRef.current!.distributePowerUps(roomCode)
      setPowerUpDropping(false)
    }

    await socketApiRef.current!.advanceRound(roomCode)
    setAnsweredCount(0)
    setDeltas({})
    setWrongSubmissions([])
  }

  const nav = (label: string, right?: string) => (
    <div className="flex items-center justify-between px-6 py-4 border-b border-gray-800">
      <span className="font-bold text-sm uppercase tracking-wider text-amber-400">{label}</span>
      {right && <span className="text-gray-500 text-xs font-mono">{right}</span>}
    </div>
  )

  if (hostPhase === 'reconnecting') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Reconnecting to room…</p>
        </div>
      </div>
    )
  }

  if (hostPhase === 'setup') {
    return (
      <div className="min-h-screen">
        <div className="flex items-center gap-4 px-6 py-4 border-b border-gray-800">
          <button onClick={onExit} className="text-gray-500 hover:text-white transition-colors text-sm">←</button>
          <span className="font-bold text-sm uppercase tracking-wider text-amber-400">Host Setup</span>
        </div>
        <SetupScreen onRoomCreated={handleRoomCreated} />
      </div>
    )
  }

  if (hostPhase === 'lobby') {
    return (
      <div className="min-h-screen">
        {nav(`Room ${roomCode}`, 'Lobby')}
        <LobbyScreen code={roomCode} players={displayPlayers} onStart={handleStartGame} />
      </div>
    )
  }

  const currentIdx = gameState?.currentPuzzleIndex ?? 0
  const currentPuzzle = puzzles[currentIdx]

  if (!currentPuzzle) return null

  if (hostPhase === 'puzzle-active') {
    return (
      <div className="min-h-screen">
        {nav(`Room ${roomCode}`, `${Object.keys(players).length} players`)}
        <HostPuzzleScreen
          puzzle={currentPuzzle}
          puzzleIndex={currentIdx}
          totalPuzzles={puzzles.length}
          timerStart={gameState?.timerStart ?? Date.now()}
          timerDuration={gameState?.timerDuration ?? 15000}
          players={displayPlayers}
          answeredCount={answeredCount}
          powerUpFeed={powerUpFeed}
          onReveal={handleReveal}
        />
      </div>
    )
  }

  if (hostPhase === 'puzzle-revealed') {
    return (
      <div className="min-h-screen">
        {nav(`Room ${roomCode}`, `${Object.keys(players).length} players`)}
        <HostResultsScreen
          puzzle={currentPuzzle}
          puzzleIndex={currentIdx}
          totalPuzzles={puzzles.length}
          players={displayPlayers}
          deltas={displayDeltas}
          wrongSubmissions={wrongSubmissions}
          powerUpDropping={powerUpDropping}
          onNext={handleNext}
        />
      </div>
    )
  }

  if (hostPhase === 'game-over') {
    return (
      <div className="min-h-screen">
        {nav('Game Over')}
        <FinalLeaderboard players={displayPlayers} onRestart={onExit} />
      </div>
    )
  }

  return null
}
