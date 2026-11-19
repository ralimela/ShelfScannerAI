'use client'

import { useMemo } from 'react'
import { buildTasteBackdrop } from '@/lib/backdrop'

interface TasteBackdropProps {
  seedKey: string
  signals: string[]
}

export default function TasteBackdrop({ seedKey, signals }: TasteBackdropProps) {
  const signalsKey = signals.join('|')
  const blobs = useMemo(() => buildTasteBackdrop(seedKey, signalsKey.split('|').filter(Boolean)), [seedKey, signalsKey])

  return (
    <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden" aria-hidden="true">
      {blobs.map((blob, i) => (
        <div
          key={i}
          className="absolute rounded-full"
          style={{
            left: `${blob.x}%`,
            top: `${blob.y}%`,
            width: blob.size,
            height: blob.size,
            transform: 'translate(-50%, -50%)',
            background: `radial-gradient(circle, hsl(${blob.hue} 85% 58% / ${blob.opacity}), transparent 70%)`,
            filter: 'blur(45px)',
          }}
        />
      ))}
    </div>
  )
}
