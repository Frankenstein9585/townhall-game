function normalize(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '').trim()
}

export function isCorrect(input: string, acceptedAnswers: string[]): boolean {
  const n = normalize(input)
  if (!n) return false
  return acceptedAnswers.some(a => normalize(a) === n)
}

export function validatePuzzleJson(raw: string): { puzzles: unknown[] | null; error: string | null } {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { puzzles: null, error: 'Invalid JSON — check for missing commas or brackets.' }
  }

  if (!Array.isArray(parsed)) return { puzzles: null, error: 'JSON must be an array of puzzles.' }
  if (parsed.length < 1) return { puzzles: null, error: 'Need at least 1 puzzle.' }

  for (const item of parsed as Record<string, unknown>[]) {
    const id = item.id as number
    const missing = ['id', 'tier', 'type', 'image', 'answers', 'hint'].filter(f => !(f in item))
    if (missing.length) return { puzzles: null, error: `Puzzle ${id ?? '?'}: missing fields: ${missing.join(', ')}.` }
    if (!['general', 'fintech'].includes(item.tier as string)) return { puzzles: null, error: `Puzzle ${id}: tier must be "general" or "fintech".` }
    if (!['normal', 'sudden-death'].includes(item.type as string)) return { puzzles: null, error: `Puzzle ${id}: type must be "normal" or "sudden-death".` }
    if (!Array.isArray(item.answers) || (item.answers as unknown[]).length < 1) return { puzzles: null, error: `Puzzle ${id}: answers must be a non-empty array.` }
    if ((item.answers as string[]).some(a => typeof a !== 'string')) return { puzzles: null, error: `Puzzle ${id}: all answers must be strings.` }
  }

  return { puzzles: parsed, error: null }
}
