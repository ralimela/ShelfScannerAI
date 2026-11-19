'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BookOpenText } from 'lucide-react'
import { signOutLocally } from '@/lib/auth'
import { useAuth } from '@/lib/AuthContext'

const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/scan', label: 'Scan' },
  { href: '/profile', label: 'Profile' },
]

export default function Header() {
  const router = useRouter()
  const { user, signOut } = useAuth()

  const handleSignOut = () => {
    if (user?.email) {
      signOutLocally(user.email)
    }
    signOut()
    router.push('/')
  }

  return (
    <header className="border-b border-border">
      <div className="max-w-5xl mx-auto flex items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 font-semibold text-foreground">
          <BookOpenText className="w-5 h-5 text-brand" />
          ShelfScannerAI
        </Link>
        <nav className="flex items-center gap-6 text-sm text-muted-foreground">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-foreground transition-colors">
              {link.label}
            </Link>
          ))}
          {user ? (
            <div className="flex items-center gap-3">
              <span className="w-6 h-6 rounded-full bg-brand/15 text-brand text-xs font-medium flex items-center justify-center">
                {(user.email ?? '?').charAt(0).toUpperCase()}
              </span>
              <button type="button" onClick={handleSignOut} className="hover:text-foreground transition-colors">
                Log out
              </button>
            </div>
          ) : (
            <Link href="/login" className="hover:text-foreground transition-colors">
              Log in
            </Link>
          )}
        </nav>
      </div>
    </header>
  )
}
