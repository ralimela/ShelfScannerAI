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

export function hashString(str: string): number {
  let hash = 2166136261
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

export function mulberry32(seed: number) {
  let state = seed
  return function random() {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export function hueForGenre(genre: string, fallback: number): number {
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
    x: 10 + random() * 80,
    y: 10 + random() * 70,
    size: 360 + random() * 260,
    hue,
    opacity: 0.4 - i * 0.08,
  }))
}

export interface RisingWord {
  text: string
  offset: number
  drift: number
  delay: number
  duration: number
}

const FALLBACK_WORDS = ['once upon a time', 'chapter one', 'plot twist', 'page-turner', 'the end?', 'one more chapter']

export function buildRisingWords(seedKey: string, words: string[], count = 8): RisingWord[] {
  const random = mulberry32(hashString(`${seedKey}:words`))
  const pool = words.filter((w) => w.length <= 26)
  const source = pool.length >= 4 ? pool : [...pool, ...FALLBACK_WORDS]
  const duration = 8

  return Array.from({ length: count }, (_, i) => ({
    text: source[i % source.length],
    offset: (random() - 0.5) * 100,
    drift: (random() - 0.5) * 160,
    delay: -(i * duration) / count,
    duration,
  }))
}

export interface FloatingGlyph {
  glyph: string
  left: number
  size: number
  duration: number
  delay: number
  opacity: number
  sway: number
}

const GLYPHS = ['A', 'a', 'R', 'e', 'g', 'Q', 'k', '¶', '§', '&', '?', '!', '“', '”', '*', '~']

export function buildFloatingGlyphs(seedKey: string, count = 26): FloatingGlyph[] {
  const random = mulberry32(hashString(`${seedKey}:glyphs`))
  return Array.from({ length: count }, () => {
    const duration = 18 + random() * 18
    return {
      glyph: GLYPHS[Math.floor(random() * GLYPHS.length)],
      left: random() * 100,
      size: 16 + random() * 30,
      duration,
      delay: -random() * duration,
      opacity: 0.1 + random() * 0.18,
      sway: (random() - 0.5) * 120,
    }
  })
}
