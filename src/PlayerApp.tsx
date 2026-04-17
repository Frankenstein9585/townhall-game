import { useState, useEffect, useRef, useCallback } from 'react'
import type { Puzzle, PlayerData, PowerUpType } from './types'
import { POWERUP_LABELS, POWERUP_DESCRIPTIONS } from './types'
import { createSocketApi, type SocketApi, type SocketRoomSnapshot } from './socketApi'
import { PLAYER_SESSION_KEY } from './constants'

type PlayerPhase = 'join' | 'lobby' | 'puzzle-active' | 'puzzle-revealed' | 'game-over' | 'reconnecting'

interface PlayerView {
  id: string
  displayName: string
  score: number
  powerUps: PowerUpType[]
  joinedAt: number
}

const PLAYER_ID_STORAGE_PREFIX = 'rebus-player-id'

function storageKey(roomCode: string): string {
  return `${PLAYER_ID_STORAGE_PREFIX}:${roomCode}`
}

function getOrCreateStoredPlayerId(roomCode: string): string {
  const existing = window.localStorage.getItem(storageKey(roomCode))
  if (existing) return existing
  const created = crypto.randomUUID()
  window.localStorage.setItem(storageKey(roomCode), created)
  return created
}

function normalizePlayers(players: SocketRoomSnapshot['players']): Record<string, PlayerView> {
  return Object.fromEntries(
    Object.entries(players).map(([id, player]) => [
      id,
      { id, displayName: player.displayName, score: player.score, powerUps: player.powerUps, joinedAt: player.joinedAt },
    ]),
  )
}

function playersByDisplayName(players: Record<string, PlayerView>): Record<string, PlayerData> {
  return Object.fromEntries(
    Object.values(players).map(player => [
      player.displayName,
      { score: player.score, powerUps: player.powerUps, joinedAt: player.joinedAt },
    ]),
  )
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-gray-900 rounded-lg border border-gray-700 ${className}`}>
      {children}
    </div>
  )
}

function JoinScreen({ onJoined }: { onJoined: (code: string, name: string) => Promise<void> }) {
  const [code, setCode] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  async function handleJoin() {
    const trimCode = code.trim()
    const trimName = name.trim().slice(0, 20)
    if (!trimCode || !trimName) { setError('Enter both a room code and your name.'); return }
    setLoading(true)
    setError('')
    try {
      await onJoined(trimCode, trimName)
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      setError(msg.toLowerCase().includes('not found') ? 'Room not found. Check the code and try again.' : 'Could not connect. Check your internet and try again.')
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 animate-fade-in">
      <div className="mb-8 text-center">
        <h1 className="text-4xl font-black tracking-tight uppercase text-white">Rebus</h1>
        <p className="text-amber-400 font-bold tracking-widest uppercase text-sm mt-1">Showdown</p>
        <p className="text-gray-500 text-sm mt-3">Enter the room code from your host screen</p>
      </div>

      <div className="w-full max-w-xs space-y-3">
        <input
          type="text"
          inputMode="numeric"
          maxLength={4}
          placeholder="4821"
          value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, ''))}
          onKeyDown={e => e.key === 'Enter' && handleJoin()}
          className="w-full py-4 px-5 bg-gray-900 border border-gray-700 rounded-lg text-center text-4xl font-mono font-black tracking-widest text-amber-400 focus:outline-none focus:border-amber-500 transition-colors"
        />
        <input
          type="text"
          maxLength={20}
          placeholder="Your display name"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleJoin()}
          className="w-full py-3 px-4 bg-gray-900 border border-gray-700 rounded-lg text-base focus:outline-none focus:border-amber-500 transition-colors"
        />

        {error && <p className="text-red-400 text-sm text-center">{error}</p>}

        <button
          onClick={handleJoin}
          disabled={loading || !code || !name}
          className="w-full py-4 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed text-gray-900 transition-colors font-bold text-lg"
        >
          {loading ? 'Joining…' : 'Join Game'}
        </button>
      </div>
    </div>
  )
}

function WaitingLobby({ playerName, players }: { playerName: string; players: Record<string, PlayerData> }) {
  return (
    <div className="max-w-sm mx-auto p-6 animate-fade-in text-center">
      <h2 className="text-2xl font-black mb-1">You're in</h2>
      <p className="text-gray-500 text-sm mb-6">Waiting for the host to start…</p>

      <Card className="p-4 text-left mb-4">
        <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider mb-3">
          {Object.keys(players).length} players joined
        </p>
        <div className="grid grid-cols-2 gap-1.5">
          {Object.keys(players).map(n => (
            <div
              key={n}
              className={`px-3 py-2 rounded text-sm font-medium truncate ${n === playerName ? 'border-l-2 border-amber-400 bg-gray-800 text-white' : 'bg-gray-800 text-gray-300'}`}
            >
              {n === playerName ? `${n} (you)` : n}
            </div>
          ))}
        </div>
      </Card>

      <div className="flex gap-1 justify-center mt-6">
        {[0, 1, 2].map(i => (
          <div key={i} className="w-1.5 h-1.5 rounded-full bg-gray-600 animate-bounce" style={{ animationDelay: `${i * 0.2}s` }} />
        ))}
      </div>
    </div>
  )
}

function PowerUpBar({
  powerUps, activeUp, hintRevealed, freezeActive, disabled, onActivate,
}: {
  powerUps: PowerUpType[]
  activeUp: PowerUpType | null
  hintRevealed: boolean
  freezeActive: boolean
  disabled: boolean
  onActivate: (p: PowerUpType) => void
}) {
  if (powerUps.length === 0) return (
    <div className="text-gray-600 text-sm text-center py-2">No power-ups yet</div>
  )

  return (
    <div className="flex gap-2 flex-wrap">
      {powerUps.map((p, i) => {
        const isActive = activeUp === p || (p === 'fifty-fifty' && hintRevealed) || (p === 'time-freeze' && freezeActive)
        return (
          <button
            key={`${p}-${i}`}
            onClick={() => !disabled && !isActive && onActivate(p)}
            disabled={disabled || isActive}
            title={POWERUP_DESCRIPTIONS[p]}
            className={`flex-1 min-w-0 py-2 px-3 rounded-lg text-xs font-bold transition-all
              ${isActive
                ? 'bg-gray-800 border border-amber-500 text-amber-300 cursor-default'
                : disabled
                  ? 'bg-gray-900 border border-gray-800 text-gray-600 cursor-not-allowed'
                  : 'bg-gray-800 border border-gray-600 text-white hover:border-gray-400 active:scale-95'
              }`}
          >
            {POWERUP_LABELS[p]}
          </button>
        )
      })}
    </div>
  )
}

function AnswerDashes({ typed, wordLengths, isFocused, onClick }: {
  typed: string
  wordLengths: number[]
  isFocused?: boolean
  onClick?: () => void
}) {
  const inputLetters = typed.replace(/ /g, '')
  const totalLen = wordLengths.reduce((s, n) => s + n, 0)
  let pos = 0
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-2 justify-center my-4 cursor-text" onClick={onClick}>
      {wordLengths.map((len, wi) => (
        <div key={wi} className="flex gap-1">
          {Array.from({ length: len }).map((_, ci) => {
            const i = pos++
            const got = inputLetters[i]
            const isCursor = isFocused && !got && i === inputLetters.length && inputLetters.length < totalLen
            return (
              <div
                key={ci}
                className={`w-10 h-12 border-2 flex items-center justify-center text-base font-bold uppercase rounded transition-colors
                  ${got
                    ? 'border-gray-400 text-white'
                    : isCursor
                      ? 'border-amber-400'
                      : 'border-gray-700'
                  }`}
              >
                {got ?? (isCursor ? <span className="animate-pulse text-amber-400 text-xl leading-none">|</span> : '')}
              </div>
            )
          })}
        </div>
      ))}
    </div>
  )
}

function PlayerPuzzleScreen({
  puzzle, puzzleIndex, totalPuzzles, timerStart, timerDuration,
  playerId, roomCode, playerData, socketApi, onSubmitted,
}: {
  puzzle: Pick<Puzzle, 'image' | 'hint' | 'type'> & { wordLengths?: number[] }
  puzzleIndex: number
  totalPuzzles: number
  timerStart: number
  timerDuration: number
  playerId: string
  roomCode: string
  playerData: PlayerData
  socketApi: SocketApi
  onSubmitted: () => void
}) {
  const [answer, setAnswer] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [remaining, setRemaining] = useState(timerDuration)
  const [activeUp, setActiveUp] = useState<PowerUpType | null>(null)
  const [hintRevealed, setHintRevealed] = useState(false)
  const [freezeOffset, setFreezeOffset] = useState(0)
  const [newPowerUp, setNewPowerUp] = useState<PowerUpType | null>(null)
  const [locallyUsed, setLocallyUsed] = useState<PowerUpType[]>([])
  const [inputFocused, setInputFocused] = useState(false)
  const prevPowerUps = useRef<PowerUpType[]>(playerData.powerUps ?? [])
  const inputRef = useRef<HTMLInputElement>(null)
  const answerRef = useRef(answer)
  useEffect(() => { answerRef.current = answer }, [answer])

  useEffect(() => {
    const prev = prevPowerUps.current ?? []
    const curr = Array.isArray(playerData.powerUps) ? playerData.powerUps : []
    if (curr.length > prev.length) {
      const added = curr[curr.length - 1]
      setNewPowerUp(added)
      setTimeout(() => setNewPowerUp(null), 3000)
    }
    prevPowerUps.current = curr
  }, [playerData.powerUps])

  useEffect(() => {
    const tick = () => {
      const elapsed = Date.now() - timerStart - freezeOffset
      const left = Math.max(0, timerDuration - elapsed)
      setRemaining(left)
      if (left === 0 && !submitted) autoSubmit()
    }
    tick()
    const id = setInterval(tick, 200)
    return () => clearInterval(id)
  }, [timerStart, timerDuration, freezeOffset, submitted])

  async function autoSubmit() {
    if (submitted) return
    const current = answerRef.current
    if (!current.trim()) return
    await doSubmit(current)
  }

  async function doSubmit(ans: string) {
    if (submitted) return
    setSubmitted(true)
    await socketApi.submitAnswer({ code: roomCode, playerId, answer: ans.trim(), powerUpUsed: activeUp })
    onSubmitted()
  }

  async function handleActivate(p: PowerUpType) {
    setLocallyUsed(prev => [...prev, p])
    await socketApi.usePowerUp({ code: roomCode, playerId, powerUp: p })
    if (p === 'fifty-fifty') setHintRevealed(true)
    else if (p === 'time-freeze') setFreezeOffset(o => o + 6000)
    else if (p === 'double-down') setActiveUp('double-down')
  }

  const pct = remaining / timerDuration
  const secs = Math.ceil(remaining / 1000)
  const barColor = pct > 0.5 ? 'bg-green-500' : pct > 0.25 ? 'bg-yellow-500' : 'bg-red-500'

  return (
    <div className="max-w-sm mx-auto p-4 animate-slide-up">
      {newPowerUp && (
        <div className="fixed top-4 inset-x-4 z-50 bg-gray-900 border border-amber-500 rounded-xl p-4 text-center animate-pop shadow-xl">
          <div className="text-xs text-amber-400 uppercase tracking-widest mb-1 font-bold">Power-up received</div>
          <div className="font-bold text-white">{POWERUP_LABELS[newPowerUp]}</div>
        </div>
      )}

      <div className="flex justify-between items-center mb-3">
        <span className="text-gray-500 text-xs font-mono">{puzzleIndex + 1} / {totalPuzzles}</span>
        {puzzle.type === 'sudden-death' && (
          <span className="text-xs px-2 py-0.5 rounded-full border border-red-700 text-red-400 font-bold">
            ⚡ SUDDEN DEATH −200pts
          </span>
        )}
      </div>

      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
          <span className="text-gray-600 uppercase tracking-wider">Time</span>
          <span className={`font-bold font-mono ${secs <= 5 ? 'text-red-400 animate-pulse-fast' : 'text-white'}`}>{secs}s</span>
        </div>
        <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
          <div className={`h-full ${barColor} transition-all duration-200`} style={{ width: `${pct * 100}%` }} />
        </div>
      </div>

      <Card className="p-5 text-center mb-3">
        <img src={`/Rebus/${puzzle.image}`} alt="" className="max-h-44 object-contain mx-auto" />
        {hintRevealed && (
          <div className="mt-4 p-3 border-l-2 border-amber-400 bg-gray-800 text-gray-200 text-sm text-left animate-fade-in rounded-r-lg">
            {puzzle.hint}
          </div>
        )}
        {activeUp === 'double-down' && (
          <div className="mt-3 p-2 border-l-2 border-yellow-500 bg-gray-800 text-yellow-300 text-xs text-left rounded-r-lg">
            Double Down active — 2× if correct, lose score if wrong
          </div>
        )}
        {freezeOffset > 0 && (
          <div className="mt-3 p-2 border-l-2 border-blue-500 bg-gray-800 text-blue-300 text-xs text-left rounded-r-lg">
            Time Freeze active — +6s added to your timer
          </div>
        )}
      </Card>

      {/* Hidden input — captures keyboard on all devices */}
      <input
        ref={inputRef}
        type="text"
        value={answer}
        onChange={e => setAnswer(e.target.value.toUpperCase())}
        onKeyDown={e => e.key === 'Enter' && answer.trim() && !submitted && doSubmit(answer)}
        onFocus={() => setInputFocused(true)}
        onBlur={() => setInputFocused(false)}
        autoFocus
        disabled={remaining === 0 || submitted}
        className="fixed top-0 left-0 w-px h-px opacity-0 pointer-events-none text-base"
        aria-label="Answer input"
      />

      {puzzle.wordLengths && puzzle.wordLengths.length > 0 && (
        <AnswerDashes
          typed={answer}
          wordLengths={puzzle.wordLengths}
          isFocused={inputFocused}
          onClick={() => inputRef.current?.focus()}
        />
      )}

      {submitted ? (
        <div className="text-center py-5">
          <p className="text-gray-400 text-sm">Submitted — waiting for reveal…</p>
        </div>
      ) : (
        <button
          onClick={() => answer.trim() && doSubmit(answer)}
          disabled={!answer.trim() || remaining === 0}
          className="w-full py-3 rounded-lg bg-amber-400 hover:bg-amber-300 disabled:opacity-40 disabled:cursor-not-allowed text-gray-900 transition-colors font-bold text-base mb-4"
        >
          Submit
        </button>
      )}

      <Card className="p-3">
        <p className="text-gray-600 text-xs font-semibold uppercase tracking-wider mb-2">Power-ups</p>
        <PowerUpBar
          powerUps={locallyUsed.reduce((rem, used) => {
            const i = rem.indexOf(used)
            return i === -1 ? rem : rem.filter((_, j) => j !== i)
          }, [...(playerData.powerUps ?? [])])}
          activeUp={activeUp}
          hintRevealed={hintRevealed}
          freezeActive={freezeOffset > 0}
          disabled={submitted}
          onActivate={handleActivate}
        />
      </Card>

      <div className="mt-3 text-center text-xs text-gray-600">
        Score: <span className="text-amber-400 font-bold font-mono">{playerData.score.toLocaleString()}</span>
      </div>
    </div>
  )
}

function PlayerResultsScreen({
  puzzle, puzzleIndex, revealedAnswer, playerName, players, delta,
}: {
  puzzle: Pick<Puzzle, 'image' | 'hint'>
  puzzleIndex: number
  revealedAnswer: string
  playerName: string
  players: Record<string, PlayerData>
  delta: { points: number; correct: boolean } | null
}) {
  const medals = ['🥇', '🥈', '🥉']
  const sorted = Object.entries(players).sort(([, a], [, b]) => b.score - a.score)
  const rank = sorted.findIndex(([n]) => n === playerName) + 1
  const myScore = players[playerName]?.score ?? 0
  const top5 = sorted.slice(0, 5)
  const playerInTop5 = rank <= 5

  return (
    <div className="max-w-sm mx-auto p-4 animate-fade-in">
      <p className="text-gray-500 text-xs text-center uppercase tracking-wider mb-4 font-mono">Puzzle {puzzleIndex + 1}</p>

      <Card className="p-5 text-center mb-3">
        <img src={`/Rebus/${puzzle.image}`} alt="" className="max-h-24 object-contain mx-auto mb-2" />
        <div className="text-lg font-black text-green-400 uppercase tracking-wide">{revealedAnswer}</div>
        <div className="text-gray-500 text-xs italic mt-1">{puzzle.hint}</div>
      </Card>

      {delta && (
        <div className={`mb-3 p-4 rounded-lg border-l-4 bg-gray-800 ${delta.correct ? 'border-green-500' : 'border-red-500'}`}>
          <div className={`font-bold ${delta.correct ? 'text-green-400' : 'text-red-400'}`}>
            {delta.correct ? 'Correct' : 'Wrong'}
          </div>
          <div className={`text-xl font-black font-mono mt-0.5 ${delta.points >= 0 ? 'text-green-300' : 'text-red-300'}`}>
            {delta.points >= 0 ? '+' : ''}{delta.points.toLocaleString()}
          </div>
        </div>
      )}

      <Card className="mb-3">
        <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider px-4 pt-4 pb-2">Standings</p>
        {top5.map(([name, data], i) => (
          <div key={name} className={`flex items-center gap-2 px-4 py-2.5 ${name === playerName ? 'border-l-2 border-amber-400' : ''} ${i < top5.length - 1 || !playerInTop5 ? 'border-b border-gray-800' : ''}`}>
            <span className="text-xs w-5 text-gray-500">{medals[i] ?? i + 1}</span>
            <span className="flex-1 text-sm truncate">{name}{name === playerName ? ' (you)' : ''}</span>
            <span className="text-xs text-amber-400 font-bold font-mono">{data.score.toLocaleString()}</span>
          </div>
        ))}
        {!playerInTop5 && (
          <>
            <div className="text-center text-gray-700 text-xs py-1">···</div>
            <div className="flex items-center gap-2 px-4 py-2.5 border-l-2 border-amber-400">
              <span className="text-xs w-5 text-gray-500">#{rank}</span>
              <span className="flex-1 text-sm truncate">{playerName} (you)</span>
              <span className="text-xs text-amber-400 font-bold font-mono">{myScore.toLocaleString()}</span>
            </div>
          </>
        )}
      </Card>

      <div className="text-center text-gray-600 text-xs flex gap-1 justify-center">
        <span>Waiting for host</span>
        {[0, 1, 2].map(i => (
          <span key={i} className="animate-bounce inline-block" style={{ animationDelay: `${i * 0.2}s` }}>.</span>
        ))}
      </div>
    </div>
  )
}

function PlayerFinalScreen({ playerName, players, onExit }: { playerName: string; players: Record<string, PlayerData>; onExit: () => void }) {
  const sorted = Object.entries(players).sort(([, a], [, b]) => b.score - a.score)
  const rank = sorted.findIndex(([n]) => n === playerName) + 1
  const winner = sorted[0]
  const isWinner = winner?.[0] === playerName
  const medals = ['🥇', '🥈', '🥉']

  return (
    <div className="max-w-sm mx-auto p-6 animate-fade-in">
      <div className="text-center mb-6">
        <h2 className="text-3xl font-black text-white">
          {isWinner ? 'You won!' : `#${rank} place`}
        </h2>
        <p className="text-amber-400 font-mono font-bold text-lg mt-1">{(players[playerName]?.score ?? 0).toLocaleString()} pts</p>
      </div>

      <Card className="mb-6">
        <p className="text-gray-500 text-xs font-semibold uppercase tracking-wider px-4 pt-4 pb-2">Final Standings</p>
        {sorted.map(([name, data], i) => (
          <div
            key={name}
            className={`flex items-center gap-3 px-4 py-3 ${name === playerName ? 'border-l-2 border-amber-400' : ''} ${i < sorted.length - 1 ? 'border-b border-gray-800' : ''}`}
          >
            <span className="text-sm w-6 text-center">{medals[i] ?? i + 1}</span>
            <span className="flex-1 font-medium truncate text-sm">{name}{name === playerName ? ' (you)' : ''}</span>
            <span className={`font-bold font-mono text-sm ${name === playerName ? 'text-amber-400' : 'text-gray-300'}`}>
              {data.score.toLocaleString()}
            </span>
          </div>
        ))}
      </Card>

      <button onClick={onExit} className="w-full py-4 rounded-lg bg-gray-800 hover:bg-gray-700 border border-gray-700 text-white transition-colors font-semibold">
        ← Back to Home
      </button>
    </div>
  )
}

export default function PlayerApp({ onExit }: { onExit: () => void }) {
  const [phase, setPhase] = useState<PlayerPhase>('join')
  const [roomCode, setRoomCode] = useState('')
  const [playerId, setPlayerId] = useState('')
  const [playerName, setPlayerName] = useState('')
  const [roomSnapshot, setRoomSnapshot] = useState<SocketRoomSnapshot | null>(null)
  const [_hasSubmitted, setHasSubmitted] = useState(false)

  const socketApiRef = useRef<SocketApi | null>(null)
  const phaseRef = useRef<PlayerPhase>('join')
  const prevEventCountRef = useRef(0)
  const [sabotageToast, setSabotageToast] = useState<{ names: string[]; total: number } | null>(null)

  useEffect(() => {
    const stored = localStorage.getItem(PLAYER_SESSION_KEY)
    if (stored) {
      const { roomCode: savedCode, playerName: savedName } = JSON.parse(stored) as { roomCode: string; playerName: string }
      const savedId = getOrCreateStoredPlayerId(savedCode)
      setPhase('reconnecting')
      phaseRef.current = 'reconnecting' as PlayerPhase
      const api = createSocketApi()
      socketApiRef.current = api
      api.connect().then(async () => {
        try {
          await api.joinRoom({ code: savedCode, playerId: savedId, displayName: savedName })
          setRoomCode(savedCode)
          setPlayerId(savedId)
          setPlayerName(savedName)
          api.onRoomState(snap => setRoomSnapshot(snap))
        } catch {
          localStorage.removeItem(PLAYER_SESSION_KEY)
          setPhase('join')
          phaseRef.current = 'join'
        }
      })
    }
    return () => { socketApiRef.current?.disconnect() }
  }, [])

  const handleJoined = useCallback(async (code: string, name: string) => {
    const api = createSocketApi()
    socketApiRef.current = api
    await api.connect()
    const id = getOrCreateStoredPlayerId(code)
    await api.joinRoom({ code, playerId: id, displayName: name })
    localStorage.setItem(PLAYER_SESSION_KEY, JSON.stringify({ roomCode: code, playerName: name }))
    setRoomCode(code)
    setPlayerId(id)
    setPlayerName(name)
    setPhase('lobby')
    phaseRef.current = 'lobby'
    api.onRoomState(snap => setRoomSnapshot(snap))
  }, [])

  const currentPuzzleIndex = roomSnapshot?.state.currentPuzzleIndex ?? 0
  const currentPuzzle = roomSnapshot?.public.currentPuzzle ?? null
  const totalPuzzles = roomSnapshot?.public.meta.totalPuzzles ?? 0
  const revealedAnswer = roomSnapshot?.public.revealedAnswer ?? ''
  const rawPlayers = roomSnapshot?.players ?? {}
  const normalizedPlayers = normalizePlayers(rawPlayers)
  const players = playersByDisplayName(normalizedPlayers)
  const gamePhase = roomSnapshot?.state.phase

  const rawMyData = rawPlayers[playerId]
  const myData: PlayerData = rawMyData
    ? { score: rawMyData.score, powerUps: rawMyData.powerUps, joinedAt: rawMyData.joinedAt }
    : { score: 0, powerUps: [], joinedAt: 0 }
  const myDelta = roomSnapshot?.deltas?.[String(currentPuzzleIndex)]?.[playerId] ?? null

  useEffect(() => {
    const events = roomSnapshot?.powerupEvents ?? []
    const newEvents = events.slice(prevEventCountRef.current)
    prevEventCountRef.current = events.length
    const hits = newEvents.filter(e => e.powerup === 'sabotage' && e.target === playerName)
    if (hits.length > 0) {
      setSabotageToast({ names: hits.map(h => h.player), total: hits.length * 100 })
      setTimeout(() => setSabotageToast(null), 4000)
    }
  }, [roomSnapshot?.powerupEvents, playerName])

  useEffect(() => {
    if (!gamePhase) return
    if (gamePhase === 'lobby') {
      if (phaseRef.current === 'reconnecting') {
        setPhase('lobby')
        phaseRef.current = 'lobby'
      }
      return
    }
    if (gamePhase === 'puzzle-active') {
      setHasSubmitted(false)
      setPhase('puzzle-active')
    } else if (gamePhase === 'puzzle-revealed') {
      setPhase('puzzle-revealed')
    } else if (gamePhase === 'game-over') {
      setPhase('game-over')
    }
    phaseRef.current = gamePhase as PlayerPhase
  }, [gamePhase])

  if (phase === 'reconnecting') {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-amber-400 border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-400 text-sm">Reconnecting…</p>
        </div>
      </div>
    )
  }

  if (phase === 'join') return <JoinScreen onJoined={handleJoined} />

  return (
    <div className="min-h-screen">
      {sabotageToast && (
        <div className="fixed top-4 inset-x-4 z-50 bg-gray-900 border border-red-600 rounded-xl p-4 text-center animate-pop shadow-xl">
          <div className="text-xs text-red-400 uppercase tracking-widest mb-1 font-bold">Sabotaged!</div>
          <div className="font-bold text-white text-sm">
            {sabotageToast.names.length === 1
              ? `${sabotageToast.names[0]} took your points`
              : `${sabotageToast.names.slice(0, -1).join(', ')} and ${sabotageToast.names[sabotageToast.names.length - 1]} sabotaged you`}
          </div>
          <div className="text-red-400 text-sm font-mono font-bold mt-1">−{sabotageToast.total}</div>
        </div>
      )}
      {phase !== 'game-over' && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
          <span className="text-xs text-gray-600 font-mono">{roomCode}</span>
          <span className="text-xs text-gray-400 font-medium">{playerName}</span>
          <span className="text-xs font-bold text-amber-400 font-mono">{myData.score.toLocaleString()}</span>
        </div>
      )}

      {phase === 'lobby' && <WaitingLobby playerName={playerName} players={players} />}

      {phase === 'puzzle-active' && currentPuzzle && (
        <PlayerPuzzleScreen
          key={currentPuzzleIndex}
          puzzle={currentPuzzle}
          puzzleIndex={currentPuzzleIndex}
          totalPuzzles={totalPuzzles}
          timerStart={roomSnapshot?.state.timerStart ?? Date.now()}
          timerDuration={roomSnapshot?.state.timerDuration ?? 15000}
          playerId={playerId}
          roomCode={roomCode}
          playerData={myData}
          socketApi={socketApiRef.current!}
          onSubmitted={() => setHasSubmitted(true)}
        />
      )}

      {phase === 'puzzle-revealed' && currentPuzzle && (
        <PlayerResultsScreen
          puzzle={currentPuzzle}
          puzzleIndex={currentPuzzleIndex}
          revealedAnswer={revealedAnswer}
          playerName={playerName}
          players={players}
          delta={myDelta}
        />
      )}

      {phase === 'game-over' && (
        <PlayerFinalScreen playerName={playerName} players={players} onExit={onExit} />
      )}
    </div>
  )
}
