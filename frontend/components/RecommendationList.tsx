'use client'

import { useState } from 'react'
import Card from '@/components/ui/Card'
import Pill from '@/components/ui/Pill'
import type { Recommendation } from '@/lib/types'

function RecommendationCard({ recommendation }: { recommendation: Recommendation }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <Card className="flex flex-col gap-2">
      <div className="flex justify-between items-start gap-2">
        <div>
          <p className="font-medium">
            #{recommendation.rank} {recommendation.title}
          </p>
          {recommendation.author && <p className="text-sm text-muted-foreground">{recommendation.author}</p>}
        </div>
        {recommendation.matchScore != null && (
          <Pill variant="brand" className="shrink-0">
            {Math.round(recommendation.matchScore * 100)}% match
          </Pill>
        )}
      </div>

      {recommendation.similarTo && (
        <p className="text-xs text-muted-foreground">
          Similar to <span className="italic">{recommendation.similarTo.title}</span>
          {recommendation.similarTo.author && ` by ${recommendation.similarTo.author}`}
        </p>
      )}

      {recommendation.estimatedHours != null && (
        <Pill variant="accent" className="w-fit">
          ~{recommendation.estimatedHours}h to finish at your pace
        </Pill>
      )}

      {recommendation.matchedSignals.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {recommendation.matchedSignals.map((signal) => (
            <Pill key={signal}>{signal}</Pill>
          ))}
        </div>
      )}

      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="text-sm text-left text-foreground underline underline-offset-2 w-fit"
      >
        {expanded ? 'Hide reasoning' : 'Why this book?'}
      </button>

      {expanded && <p className="text-sm text-muted-foreground">{recommendation.reasoning}</p>}
    </Card>
  )
}

export default function RecommendationList({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) {
    return <p className="text-sm text-muted-foreground">No strong matches found among the scanned books.</p>
  }

  return (
    <div className="w-full max-w-md flex flex-col gap-3">
      {recommendations.map((recommendation) => (
        <RecommendationCard key={recommendation.title} recommendation={recommendation} />
      ))}
    </div>
  )
}
