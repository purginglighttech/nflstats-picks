'use client';

/**
 * App header: brand, primary navigation (spec table), Make Picks as the
 * strongest header action, and a profile menu (account settings + sign out)
 * when authenticated. Mobile-first: hamburger below lg, full nav at lg+.
 */
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { signOut } from '@/lib/api';
import { useSession } from '@/lib/session';

interface NavItem {
  href: string;
  label: string;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/', label: 'Home' },
  { href: '/weeks', label: 'Weekly Games' },
  { href: '/features', label: 'Games of the Week' },
  { href: '/reports', label: 'Reports' },
  { href: '/standings', label: 'Standings' },
  { href: '/compare', label: 'Compare' },
  { href: '/forum', label: 'Forum' },
];

const MAKE_PICKS_HREF = '/picks';

function isActive(pathname: string, href: string): boolean {
  if (href === '/') return pathname === '/';
  return pathname === href || pathname.startsWith(`${href}/`);
}

function ProfileMenu() {
  const { me } = useSession();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onClick);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onClick);
    };
  }, [open ]);

  if (!me) return null;
  const initial = me.display_name.charAt(0).toUpperCase() || '?';

  const handleSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } catch {
      // Even if the API call fails, drop the local session view.
    } finally {
      window.location.href = '/';
    }
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        className="nav-link"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((v) => !v)}
      >
        <span
          aria-hidden="true"
          className="mr-2 inline-flex h-7 w-7 items-center justify-center rounded-full text-sm font-bold"
          style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
        >
          {initial}
        </span>
        <span className="hidden min-[480px]:inline max-w-28 truncate">{me.display_name}</span>
      </button>
      {open ? (
        <div
          role="menu"
          aria-label="Account"
          className="absolute right-0 z-50 mt-2 w-56 rounded-xl border p-2 shadow-lg"
          style={{
            background: 'var(--surface)',
            borderColor: 'var(--border)',
          }}
        >
          <Link
            href="/settings/profile"
            role="menuitem"
            className="nav-link w-full"
            onClick={() => setOpen(false)}
          >
            Account settings
          </Link>
          <Link
            href="/settings/theme"
            role="menuitem"
            className="nav-link w-full"
            onClick={() => setOpen(false)}
          >
            Theme &amp; display
          </Link>
          <button
            type="button"
            role="menuitem"
            className="nav-link w-full text-left"
            disabled={signingOut}
            onClick={handleSignOut}
          >
            {signingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Header() {
  const pathname = usePathname();
  const { status } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);

  // Close the mobile menu on navigation.
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  const signInHref = `/signin?next=${encodeURIComponent(pathname || '/')}`;

  return (
    <header
      className="sticky top-0 z-40 border-b"
      style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
    >
      <div className="mx-auto flex h-16 max-w-7xl items-center gap-2 px-4 sm:px-6">
        <Link
          href="/"
          className="mr-1 flex items-center gap-2 text-lg font-bold tracking-tight"
          aria-label="Purging Light Pick'em — home"
        >
          <span
            aria-hidden="true"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-base font-black"
            style={{ background: 'var(--accent)', color: 'var(--accent-contrast)' }}
          >
            PL
          </span>
          <span className="hidden sm:inline">Pick&apos;em</span>
        </Link>

        {/* Desktop nav */}
        <nav aria-label="Primary" className="hidden min-w-0 flex-1 items-center gap-1 lg:flex">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="nav-link"
              aria-current={isActive(pathname, item.href) ? 'page' : undefined}
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-2">
          {/* Make Picks: the strongest header action, desktop and mobile. */}
          <Link
            href={MAKE_PICKS_HREF}
            className="btn btn-primary btn-sm"
            aria-current={isActive(pathname, MAKE_PICKS_HREF) ? 'page' : undefined}
          >
            Make Picks
          </Link>

          {status === 'signed-in' ? (
            <ProfileMenu />
          ) : status === 'signed-out' ? (
            <Link href={signInHref} className="nav-link">
              Sign in
            </Link>
          ) : null}

          {/* Mobile hamburger */}
          <button
            type="button"
            className="nav-link lg:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
            onClick={() => setMenuOpen((v) => !v)}
          >
            <span aria-hidden="true" className="text-xl leading-none">
              {menuOpen ? '✕' : '☰'}
            </span>
          </button>
        </div>
      </div>

      {/* Mobile nav panel */}
      {menuOpen ? (
        <nav
          id="mobile-nav"
          aria-label="Primary"
          className="border-t px-4 py-3 lg:hidden"
          style={{ borderColor: 'var(--border)', background: 'var(--surface)' }}
        >
          <ul className="flex flex-col gap-1">
            {NAV_ITEMS.map((item) => (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className="nav-link w-full"
                  aria-current={isActive(pathname, item.href) ? 'page' : undefined}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      ) : null}
    </header>
  );
}
