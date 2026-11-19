import { Star } from 'lucide-react'
import type { RecentBook } from '@/lib/types'

function Stars({ rating }: { rating: number }) {
  return (
    <span className="flex shrink-0 gap-0.5" role="img" aria-label={`${rating} out of 5`}>
      {[1, 2, 3, 4, 5].map((value) => (
        <Star
          key={value}
          className={value <= rating ? 'h-3.5 w-3.5 fill-accent text-accent' : 'h-3.5 w-3.5 text-border'}
        />
      ))}
    </span>
  )
}

export default function RecentBooks({ books }: { books: RecentBook[] }) {
  return (
    <section className="flex flex-col gap-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Recently finished</p>
      <ul className="divide-y divide-border overflow-hidden rounded-card border border-border bg-surface/80 backdrop-blur-xl">
        {books.map((book) => (
          <li key={`${book.bookId}-${book.readAt}`} className="flex items-center justify-between gap-4 px-5 py-4">
            <div className="min-w-0">
              <p className="truncate font-serif text-lg leading-tight">{book.title ?? 'Untitled'}</p>
              {book.author && <p className="truncate text-sm text-muted-foreground">{book.author}</p>}
            </div>
            {book.rating != null && <Stars rating={book.rating} />}
          </li>
        ))}
      </ul>
    </section>
  )
}
