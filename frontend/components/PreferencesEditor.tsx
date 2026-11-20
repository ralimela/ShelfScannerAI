'use client'

import { useId, useState } from 'react'
import { X } from 'lucide-react'
import Button from '@/components/ui/Button'
import { submitOnboarding } from '@/lib/api'
import type { TasteProfile } from '@/lib/types'

type PreferenceField = 'favoriteGenres' | 'favoriteAuthors' | 'writingStylePrefs' | 'dislikedGenres' | 'avoidThemes'
type PreferenceValues = Record<PreferenceField, string[]>

const FIELDS: { key: PreferenceField; label: string; placeholder: string; hint?: string; tone: 'brand' | 'danger' }[] = [
  { key: 'favoriteGenres', label: 'Favorite genres', placeholder: 'e.g. Horror, Literary fiction', tone: 'brand' },
  { key: 'favoriteAuthors', label: 'Favorite authors', placeholder: 'e.g. Stephen King', tone: 'brand' },
  {
    key: 'writingStylePrefs',
    label: 'Styles you enjoy',
    placeholder: 'e.g. atmospheric, fast-paced',
    hint: 'Includes styles picked up from your book feedback. Remove any that don’t fit.',
    tone: 'brand',
  },
  {
    key: 'dislikedGenres',
    label: 'Genres to skip',
    placeholder: 'e.g. Romance',
    hint: 'Never recommended, in scans or in chat.',
    tone: 'danger',
  },
  { key: 'avoidThemes', label: 'Themes to avoid', placeholder: 'e.g. graphic gore', tone: 'danger' },
]

function addUnique(list: string[], items: string[]): string[] {
  const seen = new Set(list.map((v) => v.toLowerCase()))
  const next = [...list]
  for (const item of items) {
    const text = item.trim().replace(/\s+/g, ' ')
    if (text && !seen.has(text.toLowerCase())) {
      seen.add(text.toLowerCase())
      next.push(text)
    }
  }
  return next
}

interface TagInputProps {
  label: string
  placeholder: string
  hint?: string
  tone: 'brand' | 'danger'
  values: string[]
  onChange: (values: string[]) => void
}

export function TagInput({ label, placeholder, hint, tone, values, onChange }: TagInputProps) {
  const [draft, setDraft] = useState('')
  const inputId = useId()

  const commit = (text: string) => {
    if (text.trim()) onChange(addUnique(values, text.split(',')))
    setDraft('')
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={inputId} className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
        {label}
      </label>
      <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-border bg-background/40 p-2 focus-within:border-brand/50">
        {values.map((value) => (
          <span
            key={value}
            className={`flex items-center gap-1 rounded-full py-1 pl-3 pr-1.5 text-sm ${
              tone === 'danger' ? 'bg-danger/10 text-danger' : 'bg-brand/10 text-foreground'
            }`}
          >
            {value}
            <button
              type="button"
              onClick={() => onChange(values.filter((v) => v !== value))}
              aria-label={`Remove ${value}`}
              className="rounded-full p-0.5 text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        <input
          id={inputId}
          value={draft}
          onChange={(e) => {
            const text = e.target.value
            if (text.includes(',')) {
              const parts = text.split(',')
              onChange(addUnique(values, parts.slice(0, -1)))
              setDraft(parts[parts.length - 1])
            } else {
              setDraft(text)
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit(draft)
            } else if (e.key === 'Backspace' && !draft && values.length > 0) {
              onChange(values.slice(0, -1))
            }
          }}
          onBlur={() => commit(draft)}
          placeholder={values.length === 0 ? placeholder : 'Add another…'}
          className="min-w-[8rem] flex-1 bg-transparent px-1.5 py-1 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
        />
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  )
}

interface PreferencesEditorProps {
  userId: string
  idToken?: string | null
  initial: TasteProfile | null
  variant: 'onboarding' | 'edit'
  onSaved: () => void
  onCancel?: () => void
}

export default function PreferencesEditor({ userId, idToken = null, initial, variant, onSaved, onCancel }: PreferencesEditorProps) {
  const [values, setValues] = useState<PreferenceValues>(() => ({
    favoriteGenres: initial?.favoriteGenres ?? [],
    favoriteAuthors: initial?.favoriteAuthors ?? [],
    writingStylePrefs: initial?.writingStylePrefs ?? [],
    dislikedGenres: initial?.dislikedGenres ?? [],
    avoidThemes: initial?.avoidThemes ?? [],
  }))
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    setError(null)
    try {
      await submitOnboarding(userId, values, idToken)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Saving your preferences failed')
    } finally {
      setIsSaving(false)
    }
  }

  const visibleFields = variant === 'onboarding' ? FIELDS.map((f) => ({ ...f, hint: f.key === 'writingStylePrefs' ? undefined : f.hint })) : FIELDS

  return (
    <section className="w-full max-w-md rounded-card border border-border bg-surface/80 p-6 shadow-[0_24px_60px_-30px_rgb(0_0_0/0.55)] backdrop-blur-xl sm:p-8">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <header>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">
            {variant === 'onboarding' ? 'Get started' : 'Your preferences'}
          </p>
          <h2 className="mt-1 font-serif text-[1.75rem] leading-tight">
            {variant === 'onboarding' ? 'Tell us what you like' : 'Edit what you like'}
          </h2>
          <p className="mt-2 text-sm text-muted-foreground">
            {variant === 'onboarding'
              ? 'These shape your recommendations from the very first scan, and they keep counting as you log books.'
              : 'Recommendations blend these with what you’ve read, so changes apply to your next scan or chat.'}
          </p>
        </header>

        {visibleFields.map((field) => (
          <TagInput
            key={field.key}
            label={field.label}
            placeholder={field.placeholder}
            hint={field.hint}
            tone={field.tone}
            values={values[field.key]}
            onChange={(next) => setValues((current) => ({ ...current, [field.key]: next }))}
          />
        ))}

        <div className="flex gap-2 pt-1">
          <Button type="submit" disabled={isSaving} className="flex-1">
            {isSaving ? 'Saving…' : 'Save preferences'}
          </Button>
          {onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel} disabled={isSaving}>
              Cancel
            </Button>
          )}
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
      </form>
    </section>
  )
}
