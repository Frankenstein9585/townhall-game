import { useState, useEffect } from 'react'
import HostApp from './HostApp'
import PlayerApp from './PlayerApp'
import { HOST_SESSION_KEY, PLAYER_SESSION_KEY } from './constants'

type Mode = 'host' | 'player' | 'rules' | null

const hostSecret = import.meta.env.VITE_HOST_SECRET as string | undefined
const isHostAllowed = hostSecret
  ? new URLSearchParams(window.location.search).get('host') === hostSecret
  : true

function RulesScreen({ onBack }: { onBack: () => void }) {
  return (
    <div className="min-h-screen p-6 max-w-lg mx-auto animate-fade-in">
      <button onClick={onBack} className="text-gray-400 hover:text-white text-sm mb-6 flex items-center gap-1 transition-colors">
        ← Back
      </button>

      <h1 className="text-3xl font-black mb-6 text-center tracking-tight">HOW TO PLAY</h1>

      <div className="bg-gray-900 rounded-lg border border-gray-700 p-5 mb-4 text-center">
        <p className="text-gray-400 text-sm mb-3">Each round you'll see a rebus image like this:</p>
        <img src="/Rebus/think-outside-the-box.jpeg" alt="think outside the box" className="max-h-32 object-contain mx-auto" />
        <div className="flex flex-wrap gap-x-2 gap-y-2 justify-center mt-3">
          {['THINK', 'OUTSIDE', 'THE', 'BOX'].map((word, wi) => (
            <div key={wi} className="flex gap-1">
              {word.split('').map((letter, li) => (
                <div key={li} className="w-7 h-9 border-2 border-gray-400 flex items-center justify-center text-xs font-bold text-white rounded">
                  {letter}
                </div>
              ))}
            </div>
          ))}
        </div>
        <p className="text-gray-400 text-sm mt-3">Decode the image and type your answer before time runs out!</p>
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-700 p-5 mb-4">
        <h2 className="font-bold text-white mb-3 uppercase tracking-wide text-sm">📊 Scoring</h2>
        <ul className="space-y-2 text-sm text-gray-300">
          <li>✅ Correct: <span className="text-white font-semibold">1,000 pts</span> + speed bonus up to +500</li>
          <li>❌ Wrong: <span className="text-white font-semibold">0 pts</span></li>
          <li>⚡ Sudden Death wrong: <span className="text-red-400 font-semibold">−200 pts</span></li>
        </ul>
      </div>

      <div className="bg-gray-900 rounded-lg border border-gray-700 p-5 mb-4">
        <h2 className="font-bold text-white mb-3 uppercase tracking-wide text-sm">⚡ Power-ups</h2>
        <p className="text-sm text-gray-400 mb-4">
          Awarded during the game. Hold up to 2 at a time. Unused ones expire after a few rounds.
        </p>
        <div className="space-y-3">
          {[
            { icon: '🎲', name: 'Double Down', color: 'text-amber-400', desc: '2× points if correct — lose your entire score if wrong.' },
            { icon: '✂️', name: '50/50', color: 'text-gray-200', desc: 'Reveals the puzzle hint.' },
            { icon: '❄️', name: 'Time Freeze', color: 'text-blue-400', desc: 'Adds 6 seconds to your personal timer.' },
            { icon: '💀', name: 'Sabotage', color: 'text-red-400', desc: 'Steal 100 points from the current leader.' },
          ].map(({ icon, name, color, desc }) => (
            <div key={name} className="flex gap-3 items-start">
              <span className="text-lg w-6 flex-shrink-0">{icon}</span>
              <div>
                <p className={`text-sm font-bold ${color}`}>{name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <p className="text-center text-gray-600 text-xs mt-4">May the fastest decoder win.</p>
    </div>
  )
}

export default function App() {
  const [mode, setMode] = useState<Mode>(null)

  useEffect(() => {
    if (mode !== null) return
    if (localStorage.getItem(HOST_SESSION_KEY)) setMode('host')
    else if (localStorage.getItem(PLAYER_SESSION_KEY)) setMode('player')
  }, [])

  function exitHost() {
    localStorage.removeItem(HOST_SESSION_KEY)
    setMode(null)
  }

  function exitPlayer() {
    localStorage.removeItem(PLAYER_SESSION_KEY)
    setMode(null)
  }

  if (mode === 'host') return <HostApp onExit={exitHost} />
  if (mode === 'player') return <PlayerApp onExit={exitPlayer} />
  if (mode === 'rules') return <RulesScreen onBack={() => setMode(null)} />

  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-6 animate-fade-in">
      <div className="mb-12 text-center">
        <h1 className="text-6xl font-black tracking-tight uppercase text-white">
          Rebus
        </h1>
        <h2 className="text-2xl font-bold tracking-widest uppercase text-amber-400 mt-1">
          Showdown
        </h2>
        <p className="mt-4 text-gray-500 text-sm">Decode the images. Beat your colleagues.</p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        {isHostAllowed && (
          <button
            onClick={() => setMode('host')}
            className="w-full py-4 px-6 rounded-lg bg-amber-400 hover:bg-amber-300 text-gray-900 transition-colors font-bold text-lg"
          >
            Host a Game
          </button>
        )}
        <button
          onClick={() => setMode('player')}
          className="w-full py-4 px-6 rounded-lg bg-gray-800 hover:bg-gray-700 text-white border border-gray-700 transition-colors font-bold text-lg"
        >
          Join a Game
        </button>
      </div>

      <button
        onClick={() => setMode('rules')}
        className="mt-8 text-sm text-gray-600 hover:text-gray-400 transition-colors"
      >
        How to play
      </button>
    </div>
  )
}
