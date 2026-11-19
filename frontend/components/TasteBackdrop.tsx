'use client'

import { useMemo, type CSSProperties } from 'react'
import { buildFloatingGlyphs, buildTasteBackdrop } from '@/lib/backdrop'

interface TasteBackdropProps {
  seedKey: string
  signals: string[]
}

export default function TasteBackdrop({ seedKey, signals }: TasteBackdropProps) {
  const signalsKey = signals.join('|')
  const { blobs, glyphs } = useMemo(() => {
    const list = signalsKey ? signalsKey.split('|') : []
    return { blobs: buildTasteBackdrop(seedKey, list), glyphs: buildFloatingGlyphs(seedKey) }
  }, [seedKey, signalsKey])
  const tint = blobs[0].hue

  return (
    <div className="motion-scene pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      {blobs.map((blob, i) => (
        <div
          key={i}
          className="glow-blob absolute rounded-full"
          style={{
            left: `${blob.x}%`,
            top: `${blob.y}%`,
            width: blob.size,
            height: blob.size,
            background: `radial-gradient(circle, hsl(${blob.hue} 85% 58% / ${blob.opacity}), transparent 70%)`,
            animationDelay: `${-i * 7}s`,
          }}
        />
      ))}

      {glyphs.map((g, i) => (
        <span
          key={i}
          className="floating-glyph absolute bottom-0 font-serif select-none"
          style={
            {
              left: `${g.left}%`,
              fontSize: g.size,
              color: `hsl(${tint} 60% var(--glyph-lightness) / ${g.opacity})`,
              animationDuration: `${g.duration}s`,
              animationDelay: `${g.delay}s`,
              '--sway': `${g.sway}px`,
            } as CSSProperties
          }
        >
          {g.glyph}
        </span>
      ))}
    </div>
  )
}
