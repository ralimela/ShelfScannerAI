'use client'

import { useMemo, type CSSProperties } from 'react'
import { buildRisingWords, buildTasteBackdrop } from '@/lib/backdrop'

interface ReadingSceneProps {
  seedKey: string
  signals: string[]
  words: string[]
}

const FLIPPING_PAGES = 3
const FLIP_CYCLE_SECONDS = 6

export default function ReadingScene({ seedKey, signals, words }: ReadingSceneProps) {
  const signalsKey = signals.join('|')
  const wordsKey = words.join('|')
  const { risingWords, hue } = useMemo(() => {
    const signalList = signalsKey ? signalsKey.split('|') : []
    const wordList = wordsKey ? wordsKey.split('|') : []
    return {
      risingWords: buildRisingWords(seedKey, wordList),
      hue: buildTasteBackdrop(seedKey, signalList)[0].hue,
    }
  }, [seedKey, signalsKey, wordsKey])

  return (
    <div
      className="motion-scene relative w-full max-w-md h-72 overflow-hidden flex items-end justify-center [mask-image:linear-gradient(to_top,black_70%,transparent)]"
      aria-hidden="true"
    >
      <div
        className="absolute left-1/2 bottom-14 h-16 w-72 -translate-x-1/2 rounded-full"
        style={{
          background: `radial-gradient(ellipse at center, hsl(${hue} 85% 58% / 0.5), transparent 70%)`,
          filter: 'blur(22px)',
        }}
      />

      {risingWords.map((word, i) => (
        <span
          key={i}
          className="scene-word absolute left-1/2 bottom-36 whitespace-nowrap font-serif italic text-sm sm:text-base text-foreground"
          style={
            {
              '--offset': `${word.offset}px`,
              '--drift': `${word.drift}px`,
              animationDelay: `${word.delay}s`,
              animationDuration: `${word.duration}s`,
            } as CSSProperties
          }
        >
          {word.text}
        </span>
      ))}

      <div className="book-perspective mb-12">
        <div className="book">
          <div className="book-cover" style={{ background: `hsl(${hue} 40% 20%)` }} />
          <div className="book-page book-page-left" />
          <div className="book-page book-page-right" />
          {Array.from({ length: FLIPPING_PAGES }, (_, i) => (
            <div
              key={i}
              className="book-page book-page-right book-page-flip"
              style={{
                animationDuration: `${FLIP_CYCLE_SECONDS}s`,
                animationDelay: `${(i * FLIP_CYCLE_SECONDS) / FLIPPING_PAGES}s`,
              }}
            />
          ))}
          <div className="book-spine" />
        </div>
      </div>
    </div>
  )
}
