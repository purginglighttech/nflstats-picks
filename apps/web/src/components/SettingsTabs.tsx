'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const TABS = [
  { href: '/settings/profile', label: 'Profile' },
  { href: '/settings/theme', label: 'Theme & display' },
];

export function SettingsTabs() {
  const pathname = usePathname();
  return (
    <ul className="flex gap-1">
      {TABS.map((tab) => {
        const active = pathname === tab.href;
        return (
          <li key={tab.href}>
            <Link
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className="inline-block border-b-2 px-3 py-2 font-semibold"
              style={{
                borderColor: active ? 'var(--accent)' : 'transparent',
                color: active ? 'var(--accent)' : 'var(--text-muted)',
              }}
            >
              {tab.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
