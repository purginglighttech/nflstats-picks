import type { Metadata } from 'next';
import { EmptyState } from '@/components/EmptyState';

export const metadata: Metadata = { title: 'Forum' };

/**
 * Forum shell (Phase 1, member-only via sibling C middleware).
 * Categories, topics, and replies arrive in a later phase.
 */
export default function ForumPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">Forum</h1>
      <p className="mt-2 max-w-2xl" style={{ color: 'var(--text-muted)' }}>
        Moderated member discussion of teams and games.
      </p>
      <div className="mt-8">
        <EmptyState
          title="The forum opens in a later phase"
          body="Members will browse categories, create topics, and reply here — subject to moderation and community rules. Voting, direct messages, and attachments are deferred."
        />
      </div>
    </div>
  );
}
