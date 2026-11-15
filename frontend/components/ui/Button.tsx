import type { ButtonHTMLAttributes } from 'react'

export type ButtonVariant = 'primary' | 'outline' | 'ghost'
export type ButtonSize = 'sm' | 'md'

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-full font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-brand-foreground hover:opacity-90',
  outline: 'border border-border text-foreground hover:bg-surface',
  ghost: 'text-foreground hover:bg-surface',
}

const SIZES: Record<ButtonSize, string> = {
  sm: 'px-4 py-2 text-sm',
  md: 'px-6 py-3 text-sm',
}

export function buttonClasses(variant: ButtonVariant = 'primary', size: ButtonSize = 'md', className = '') {
  return `${BASE} ${VARIANTS[variant]} ${SIZES[size]} ${className}`.trim()
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
}

export default function Button({ variant = 'primary', size = 'md', className = '', ...props }: ButtonProps) {
  return <button className={buttonClasses(variant, size, className)} {...props} />
}
