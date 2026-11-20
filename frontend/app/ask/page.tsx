'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { ArrowUp, BookOpenText, RotateCcw, Sparkles } from 'lucide-react'
import RecommendationList from '@/components/RecommendationList'
import { buttonClasses } from '@/components/ui/Button'
import TasteBackdrop from '@/components/TasteBackdrop'
import { chatWithAgent } from '@/lib/api'
import { useAuth } from '@/lib/AuthContext'
import { getOrCreateUserId } from '@/lib/user'
import type { ChatMessage, Recommendation } from '@/lib/types'

interface ThreadMessage extends ChatMessage {
  picks?: Recommendation[]
  hasTasteSignal?: boolean
}

function PersonalizeNudge({ signedIn }: { signedIn: boolean }) {
  return (
    <div className="flex flex-col gap-3 rounded-card border border-brand/25 bg-brand/5 p-4 backdrop-blur-md sm:flex-row sm:items-center">
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand/15">
        <Sparkles className="h-4 w-4 text-brand" />
      </span>
      <p className="flex-1 text-sm text-foreground/85">
        {signedIn
          ? 'These picks aren’t personalized yet. Add a few favorite genres and authors to get matches scored against your taste.'
          : 'These picks aren’t personalized yet. Create a free account and set your preferences to get matches scored against your taste.'}
      </p>
      <div className="flex shrink-0 gap-2">
        {!signedIn && (
          <Link href="/login" className={buttonClasses('primary', 'sm')}>
            Create account
          </Link>
        )}
        <Link href="/profile" className={buttonClasses(signedIn ? 'primary' : 'outline', 'sm')}>
          Set preferences
        </Link>
      </div>
    </div>
  )
}

const STORAGE_KEY = 'shelfscannerai_chat'

const STARTERS = [
  "I'm torn between The Shining and Pet Sematary. Which first?",
  'Something creepy but under 300 pages',
  'Dune or Project Hail Mary for a long weekend?',
]

function toApiMessages(thread: ThreadMessage[]): ChatMessage[] {
  // The backend is stateless, so earlier picks ride along as text to keep
  // follow-ups like "which of those is shortest?" answerable.
  return thread.map(({ role, content, picks }) => ({
    role,
    content: picks?.length ? `${content}\n\n[Books shown: ${picks.map((p) => p.title).join(', ')}]` : content,
  }))
}

function loadThread(): ThreadMessage[] {
  try {
    const saved = sessionStorage.getItem(STORAGE_KEY)
    return saved ? (JSON.parse(saved) as ThreadMessage[]) : []
  } catch {
    return []
  }
}

function saveThread(thread: ThreadMessage[]) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(thread))
  } catch {
    // storage can be unavailable (private mode); the chat still works without it
  }
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-3 text-sm text-muted-foreground">
      <span className="flex gap-1">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-brand"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </span>
      Weighing that against your reading history…
    </div>
  )
}

export default function AskPage() {
  const { user, idToken } = useAuth()
  const [anonymousUserId, setAnonymousUserId] = useState<string | null>(null)
  const userId = user?.userId ?? anonymousUserId

  const [thread, setThread] = useState<ThreadMessage[]>([])
  const [draft, setDraft] = useState('')
  const [isThinking, setIsThinking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    // sessionStorage/localStorage only exist client-side, so these load after mount.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThread(loadThread())
    if (!user) setAnonymousUserId(getOrCreateUserId())
  }, [user])

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [thread, isThinking])

  const send = async (nextThread: ThreadMessage[]) => {
    if (!userId) return
    setThread(nextThread)
    saveThread(nextThread)
    setIsThinking(true)
    setError(null)
    try {
      const response = await chatWithAgent(userId, toApiMessages(nextThread), idToken)
      const withReply = [
        ...nextThread,
        {
          role: 'assistant' as const,
          content: response.reply,
          picks: response.picks,
          hasTasteSignal: response.hasTasteSignal,
        },
      ]
      setThread(withReply)
      saveThread(withReply)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong')
    } finally {
      setIsThinking(false)
    }
  }

  const submit = (text: string) => {
    const content = text.trim()
    if (!content || isThinking) return
    setDraft('')
    send([...thread, { role: 'user', content }])
  }

  const startOver = () => {
    setThread([])
    saveThread([])
    setError(null)
    inputRef.current?.focus()
  }

  const isEmpty = thread.length === 0
  const lastAssistantIndex = thread.findLastIndex((m) => m.role === 'assistant')

  return (
    <main className="flex flex-1 flex-col items-center px-6">
      <TasteBackdrop seedKey={userId ?? 'guest'} signals={[]} />

      <div className="flex w-full max-w-2xl flex-1 flex-col">
        <header className={`flex flex-col items-center text-center ${isEmpty ? 'pt-20 pb-10' : 'pt-10 pb-6'}`}>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Reading companion</p>
          <h1 className={`mt-2 font-serif tracking-tight ${isEmpty ? 'text-5xl' : 'text-3xl'}`}>What should you read next?</h1>
          {isEmpty && (
            <p className="mt-4 max-w-md text-muted-foreground">
              Name the books you&apos;re torn between, or describe what you&apos;re in the mood for. I&apos;ll weigh them
              against everything you&apos;ve read.
            </p>
          )}
        </header>

        {isEmpty && (
          <div className="flex flex-col items-center gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
            {STARTERS.map((starter) => (
              <button
                key={starter}
                type="button"
                onClick={() => submit(starter)}
                disabled={!userId}
                className="rounded-full border border-border bg-surface/70 px-4 py-2 text-sm text-foreground/85 backdrop-blur-md transition-colors hover:border-brand/50 hover:text-foreground"
              >
                {starter}
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-8 pb-6">
          {thread.map((message, i) =>
            message.role === 'user' ? (
              <div key={i} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-line rounded-2xl rounded-br-md bg-brand/15 px-4 py-2.5 text-foreground">
                  {message.content}
                </p>
              </div>
            ) : (
              <div key={i} className="flex gap-3">
                <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface ring-1 ring-border">
                  <BookOpenText className="h-4 w-4 text-brand" />
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-4">
                  <p className="whitespace-pre-line leading-relaxed text-foreground/90">{message.content}</p>
                  {message.picks && message.picks.length > 0 && <RecommendationList recommendations={message.picks} />}
                  {message.hasTasteSignal === false && i === lastAssistantIndex && <PersonalizeNudge signedIn={Boolean(user)} />}
                </div>
              </div>
            )
          )}

          {isThinking && (
            <div className="flex gap-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface ring-1 ring-border">
                <BookOpenText className="h-4 w-4 text-brand" />
              </span>
              <TypingIndicator />
            </div>
          )}

          {error && (
            <div className="flex items-center gap-3 text-sm">
              <p className="text-danger">{error}</p>
              <button
                type="button"
                onClick={() => send(thread)}
                className="font-medium text-foreground underline underline-offset-4"
              >
                Try again
              </button>
            </div>
          )}
          <div ref={endRef} />
        </div>

        <div className="sticky bottom-0 mt-auto bg-gradient-to-t from-background via-background/95 to-transparent pb-6 pt-4">
          <form
            onSubmit={(e) => {
              e.preventDefault()
              submit(draft)
            }}
            className="flex items-end gap-2 rounded-3xl border border-border bg-surface/90 p-2 pl-5 shadow-[0_12px_40px_-20px_rgb(0_0_0/0.6)] backdrop-blur-xl focus-within:border-brand/50"
          >
            <textarea
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault()
                  submit(draft)
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="e.g. Hyperion or The Name of the Wind?"
              aria-label="Message the reading companion"
              className="max-h-40 flex-1 resize-none bg-transparent py-2 text-foreground placeholder:text-muted-foreground focus:outline-none [field-sizing:content]"
            />
            <button
              type="submit"
              disabled={!draft.trim() || isThinking || !userId}
              aria-label="Send"
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand text-brand-foreground transition-opacity disabled:opacity-40"
            >
              <ArrowUp className="h-5 w-5" />
            </button>
          </form>
          {!isEmpty && (
            <button
              type="button"
              onClick={startOver}
              className="mx-auto mt-3 flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
            >
              <RotateCcw className="h-3 w-3" />
              Start a new conversation
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
