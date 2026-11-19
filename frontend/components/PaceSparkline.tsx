'use client'

import { useId, useState } from 'react'
import type { PaceSession } from '@/lib/types'

const WIDTH = 100
const HEIGHT = 36
const PAD_X = 4
const PAD_Y = 6

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function PaceSparkline({ sessions }: { sessions: PaceSession[] }) {
  const gradientId = useId()
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const chronological = sessions.slice().reverse()

  if (chronological.length === 1) {
    const only = chronological[0]
    return (
      <div className="flex items-center justify-between rounded-lg border border-border px-3 py-2">
        <div>
          <p className="text-xs text-muted-foreground">First reading session logged</p>
          <p className="text-sm text-foreground font-medium">{formatDate(only.startedAt)}</p>
        </div>
        <span className="text-lg font-semibold text-brand">{Math.round(only.pagesPerHour)}</span>
      </div>
    )
  }

  const rates = chronological.map((s) => s.pagesPerHour)
  const min = Math.min(...rates)
  const max = Math.max(...rates)
  const range = max - min || 1

  const points = chronological.map((session, i) => {
    const x = PAD_X + (i / (chronological.length - 1)) * (WIDTH - PAD_X * 2)
    const y = HEIGHT - PAD_Y - ((session.pagesPerHour - min) / range) * (HEIGHT - PAD_Y * 2)
    return { x, y, session }
  })

  const linePath = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ')
  const areaPath = `${linePath} L ${points[points.length - 1].x} ${HEIGHT - PAD_Y} L ${points[0].x} ${HEIGHT - PAD_Y} Z`
  const active = hoverIndex != null ? points[hoverIndex] : points[points.length - 1]

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <p className="text-xs text-muted-foreground">Recent pace (pages/hour)</p>
        <p className="text-xs text-muted-foreground tabular-nums">
          {formatDate(active.session.startedAt)} ·{' '}
          <span className="text-foreground font-medium">{Math.round(active.session.pagesPerHour)}</span>
        </p>
      </div>
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="w-full h-16"
        preserveAspectRatio="none"
        onMouseLeave={() => setHoverIndex(null)}
      >
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: 'var(--brand)' }} stopOpacity="0.2" />
            <stop offset="100%" style={{ stopColor: 'var(--brand)' }} stopOpacity="0" />
          </linearGradient>
        </defs>

        <line
          x1={PAD_X}
          y1={HEIGHT - PAD_Y}
          x2={WIDTH - PAD_X}
          y2={HEIGHT - PAD_Y}
          className="stroke-border"
          strokeWidth={0.5}
        />

        <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
        <path
          d={linePath}
          fill="none"
          className="stroke-brand"
          strokeWidth={1.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />

        {points.map((p, i) => (
          <g key={`${p.session.startedAt}-${i}`}>
            <circle
              cx={p.x}
              cy={p.y}
              r={i === hoverIndex || (hoverIndex === null && i === points.length - 1) ? 2.4 : 1.6}
              className="fill-brand stroke-surface"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
            />
            <rect
              x={p.x - (WIDTH / chronological.length) / 2}
              y={0}
              width={WIDTH / chronological.length}
              height={HEIGHT}
              fill="transparent"
              onMouseEnter={() => setHoverIndex(i)}
            />
          </g>
        ))}
      </svg>
    </div>
  )
}
