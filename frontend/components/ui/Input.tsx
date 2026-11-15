import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

const FIELD_CLASSES =
  'w-full border border-border rounded-lg px-3 py-2 text-sm bg-surface text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-brand/40'

export default function Input({ className = '', ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={`${FIELD_CLASSES} ${className}`.trim()} {...props} />
}

export function Textarea({ className = '', ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={`${FIELD_CLASSES} ${className}`.trim()} {...props} />
}
