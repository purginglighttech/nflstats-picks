import Link from 'next/link';

export function Footer() {
  return (
    <footer
      className="border-t"
      style={{ borderColor: 'var(--border)', background: 'var(--surface-2)' }}
    >
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
        <div>
          <p className="font-bold">Purging Light Pick&apos;em</p>
          <p className="quiet-count mt-1">
            A Purging Light Technology project · Beta — Phase 1
          </p>
        </div>
        <nav aria-label="Secondary">
          <ul className="flex flex-wrap gap-1">
            <li>
              <Link href="/rankings" className="nav-link">
                Rankings
              </Link>
            </li>
            <li>
              <Link href="/reports" className="nav-link">
                Reports
              </Link>
            </li>
            <li>
              <Link href="/settings/theme" className="nav-link">
                Theme &amp; display
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </footer>
  );
}
