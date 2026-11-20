'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState } from 'react'
import { BookOpenText, Menu, X } from 'lucide-react'
import { signOutLocally } from '@/lib/auth'
import { useAuth } from '@/lib/AuthContext'

const NAV_LINKS = [
  { href: '/', label: 'Home' },
  { href: '/scan', label: 'Scan' },
  { href: '/ask', label: 'Ask' },
  { href: '/profile', label: 'Profile' },
]

interface AuthActionProps {
  email: string | undefined
  onSignOut: () => void
  onNavigate?: () => void
}

function AuthAction({ email, onSignOut, onNavigate }: AuthActionProps) {
  if (!email) {
    return (
      <Link href="/login" onClick={onNavigate} className="hover:text-foreground transition-colors">
        Log in
      </Link>
    )
  }

  return (
    <div className="flex items-center gap-3">
      <span className="w-6 h-6 rounded-full bg-brand/15 text-brand text-xs font-medium flex items-center justify-center shrink-0">
        {email.charAt(0).toUpperCase()}
      </span>
      <button type="button" onClick={onSignOut} className="hover:text-foreground transition-colors">
        Log out
      </button>
    </div>
  )
}

export default function Header() {
  const router = useRouter()
  const { user, signOut } = useAuth()
  const [menuOpen, setMenuOpen] = useState(false)

  const handleSignOut = () => {
    if (user?.email) {
      signOutLocally(user.email)
    }
    signOut()
    setMenuOpen(false)
    router.push('/')
  }

  return (
    <header className="border-b border-border bg-background/85 backdrop-blur-md">
      <div className="max-w-5xl mx-auto flex items-center justify-between px-4 sm:px-6 py-4">
        <Link
          href="/"
          onClick={() => setMenuOpen(false)}
          className="flex items-center gap-2 font-semibold text-foreground"
        >
          <BookOpenText className="w-5 h-5 text-brand shrink-0" />
          ShelfScannerAI
        </Link>

        <nav className="hidden sm:flex items-center gap-6 text-sm text-muted-foreground">
          {NAV_LINKS.map((link) => (
            <Link key={link.href} href={link.href} className="hover:text-foreground transition-colors">
              {link.label}
            </Link>
          ))}
          <AuthAction email={user?.email} onSignOut={handleSignOut} />
        </nav>

        <button
          type="button"
          onClick={() => setMenuOpen((prev) => !prev)}
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          aria-expanded={menuOpen}
          className="sm:hidden p-2 -mr-2 text-foreground"
        >
          {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
        </button>
      </div>

      {menuOpen && (
        <nav className="sm:hidden flex flex-col gap-1 px-4 pb-4 text-sm text-muted-foreground">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              onClick={() => setMenuOpen(false)}
              className="py-2 hover:text-foreground transition-colors"
            >
              {link.label}
            </Link>
          ))}
          <div className="py-2 border-t border-border mt-1 pt-3">
            <AuthAction email={user?.email} onSignOut={handleSignOut} onNavigate={() => setMenuOpen(false)} />
          </div>
        </nav>
      )}
    </header>
  )
}
