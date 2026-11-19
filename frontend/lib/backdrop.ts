export interface BackdropBlob {
  x: number
  y: number
  size: number
  hue: number
  opacity: number
}

const GENRE_HUES: Record<string, number> = {
  horror: 355,
  thriller: 22,
  mystery: 192,
  crime: 205,
  fantasy: 262,
  'science fiction': 208,
  'sci-fi': 208,
  scifi: 208,
  romance: 332,
  literary: 150,
  classics: 150,
  'non-fiction': 42,
  nonfiction: 42,
  biography: 42,
  history: 48,
  historical: 48,
  adventure: 30,
  humor: 55,
  comedy: 55,
  drama: 215,
  poetry: 285,
  ya: 300,
  'young adult': 300,
}

function hashString(str: string): number {
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function mulberry32(seed: number) {
  let state = seed
  return function random() {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hueForGenre(genre: string, fallback: number): number {
  const lower = genre.toLowerCase()
  for (const key of Object.keys(GENRE_HUES)) {
    if (lower.includes(key)) return GENRE_HUES[key]
  }
  return fallback % 360
}

/**
 * Deterministic 3-blob gradient mesh seeded from the user's own taste
 * signals — same person always sees the same backdrop, different people
 * (different genres/authors) visibly differ, and it shifts as their
 * profile grows.
 */
export function buildTasteBackdrop(seedKey: string, signals: string[]): BackdropBlob[] {
  const seed = hashString(seedKey || 'shelfscannerai')
  const random = mulberry32(seed)

  const primaryHue = signals[0] ? hueForGenre(signals[0], seed) : 152
  const secondaryHue = signals[1] ? hueForGenre(signals[1], seed >>> 3) : (primaryHue + 45) % 360
  const tertiaryHue = signals[2] ? hueForGenre(signals[2], seed >>> 7) : (primaryHue + 200) % 360

  return [primaryHue, secondaryHue, tertiaryHue].map((hue, i) => ({
    x: 10 + random() * 75,
    y: 5 + random() * 55 + i * 8,
    size: 240 + random() * 200,
    hue,
    opacity: 0.24 - i * 0.05,
  }))
}
