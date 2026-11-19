'use client'

import { useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import Pill, { type PillVariant } from '@/components/ui/Pill'

interface TagSectionProps {
  icon: LucideIcon
  title: string
  items: string[]
  variant?: PillVariant
  collapsedCount?: number
}

export default function TagSection({ icon: Icon, title, items, variant = 'default', collapsedCount = 6 }: TagSectionProps) {
  const [expanded, setExpanded] = useState(false)
  if (items.length === 0) return null

  const visible = expanded ? items : items.slice(0, collapsedCount)
  const hiddenCount = items.length - visible.length

  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-medium text-muted-foreground flex items-center gap-1.5">
        <Icon className="w-3.5 h-3.5" />
        {title}
      </p>
      <div className="flex flex-wrap gap-2">
        {visible.map((item) => (
          <Pill key={item} variant={variant}>
            {item}
          </Pill>
        ))}
        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={() => setExpanded(true)}
            className="text-xs rounded-full px-3 py-1 border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
          >
            +{hiddenCount} more
          </button>
        )}
        {expanded && items.length > collapsedCount && (
          <button
            type="button"
            onClick={() => setExpanded(false)}
            className="text-xs rounded-full px-3 py-1 border border-dashed border-border text-muted-foreground hover:text-foreground hover:border-foreground transition-colors"
          >
            Show less
          </button>
        )}
      </div>
    </div>
  )
}
