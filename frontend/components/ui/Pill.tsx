import type { HTMLAttributes } from 'react'

export type PillVariant = 'default' | 'brand' | 'accent'

const VARIANTS: Record<PillVariant, string> = {
  default: 'border border-border text-muted-foreground',
  brand: 'bg-brand/10 text-brand border border-brand/20',
  accent: 'bg-accent/10 text-accent border border-accent/20',
}

interface PillProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: PillVariant
}

export default function Pill({ variant = 'default', className = '', ...props }: PillProps) {
  return <span className={`text-xs rounded-full px-3 py-1 ${VARIANTS[variant]} ${className}`.trim()} {...props} />
}
