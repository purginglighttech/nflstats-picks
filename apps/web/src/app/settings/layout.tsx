import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { SettingsTabs } from '@/components/SettingsTabs';

export const metadata: Metadata = { title: 'Settings' };

/**
 * Settings section shell: profile and theme/display sub-pages.
 * Sibling C's middleware protects these routes for members.
 */
export default function SettingsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Settings</h1>
      <nav aria-label="Settings sections" className="mt-4 border-b" style={{ borderColor: 'var(--border)' }}>
        <SettingsTabs />
      </nav>
      <div className="mt-6">{children}</div>
    </div>
  );
}
