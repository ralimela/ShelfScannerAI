'use client'

import { useState } from 'react'
import type { Recommendation } from '@/lib/types'

function RecommendationCard({ recommendation }: { recommendation: Recommendation }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="border rounded-xl p-4 flex flex-col gap-2">
      <div className="flex justify-between items-start gap-2">
        <div>
          <p className="font-medium">
            #{recommendation.rank} {recommendation.title}
          </p>
          {recommendation.author && <p className="text-sm text-gray-600">{recommendation.author}</p>}
        </div>
        <span className="text-xs rounded-full border px-2 py-1 shrink-0 text-zinc-600 dark:text-zinc-400">
          {Math.round(recommendation.matchScore * 100)}% match
        </span>
      </div>

      {recommendation.similarTo && (
        <p className="text-xs text-gray-400">
          Similar to <span className="italic">{recommendation.similarTo.title}</span>
          {recommendation.similarTo.author && ` by ${recommendation.similarTo.author}`}
        </p>
      )}

      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="text-sm text-left text-zinc-700 dark:text-zinc-300 underline underline-offset-2 w-fit"
      >
        {expanded ? 'Hide reasoning' : 'Why this book?'}
      </button>

      {expanded && (
        <p className="text-sm text-gray-600 dark:text-zinc-400">{recommendation.reasoning}</p>
      )}
    </div>
  )
}

export default function RecommendationList({ recommendations }: { recommendations: Recommendation[] }) {
  if (recommendations.length === 0) {
    return <p className="text-sm text-gray-500">No strong matches found among the scanned books.</p>
  }

  return (
    <div className="w-full max-w-md flex flex-col gap-3">
      {recommendations.map((recommendation) => (
        <RecommendationCard key={recommendation.title} recommendation={recommendation} />
      ))}
    </div>
  )
}
