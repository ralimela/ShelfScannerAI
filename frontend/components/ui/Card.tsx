import type { HTMLAttributes } from 'react'

export default function Card({ className = '', ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`bg-surface border border-border rounded-card p-4 ${className}`.trim()} {...props} />
}
