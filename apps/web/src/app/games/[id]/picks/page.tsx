'use client';

import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { EmptyState } from '@/components/EmptyState';
import { ApiError, getRevealParticipants } from '@/lib/api';
import type { RevealParticipantListResponse } from '@/lib/types';
import { getTeamTheme } from '@/lib/theme/teams';

type DetailState =
  | { kind: 'loading' }
  | { kind: 'signed-out' }
  | { kind: 'sealed' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; list: RevealParticipantListResponse; loadingMore: boolean };

function teamName(teamId: string): string {
  return getTeamTheme(teamId)?.name ?? teamId.toUpperCase();
}

/**
 * Post-lock reveal detail (Phase 3). Opened in a new tab/window from a
 * locked game card's team button; the ballot keeps its position. Lists
 * every revealed participant who picked the team — display names only,
 * never email. Server-side pagination keeps the card compact at any
 * headcount without reducing the complete result set.
 */
export default function RevealDetailPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const gameId = params.id;
  const teamId = searchParams.get('team_id') ?? '';
  const [state, setState] = useState<DetailState>({ kind: 'loading' });

  const load = useCallback(
    async (cursor?: string) => {
      try {
        const list = await getRevealParticipants(gameId, teamId, 25, cursor);
        setState((prev) => {
          if (prev.kind === 'ready' && cursor) {
            return {
              kind: 'ready',
              loadingMore: false,
              list: {
                ...list,
                participants: [...prev.list.participants, ...list.participants],
              },
            };
          }
          return { kind: 'ready', list, loadingMore: false };
        });
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) {
          setState({ kind: 'signed-out' });
        } else if (err instanceof ApiError && err.status === 409) {
          setState({ kind: 'sealed' });
        } else {
          setState({
            kind: 'error',
            message: 'Could not load the pick list. Please try again.',
          });
        }
      }
    },
    [gameId, teamId],
  );

  useEffect(() => {
    if (!teamId) {
      setState({ kind: 'error', message: 'No team selected.' });
      return;
    }
    setState({ kind: 'loading' });
    void load();
  }, [load, teamId]);

  const loadMore = () => {
    if (state.kind !== 'ready' || !state.list.next_cursor || state.loadingMore) return;
    setState({ ...state, loadingMore: true });
    void load(state.list.next_cursor);
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="text-3xl font-extrabold tracking-tight">
        Who picked {teamId ? teamName(teamId) : '…'}
      </h1>

      <div className="mt-8">
        {state.kind === 'loading' ? (
          <p role="status" style={{ color: 'var(--text-muted)' }}>
            Loading…
          </p>
        ) : state.kind === 'signed-out' ? (
          <EmptyState
            title="Sign in to see picks"
            body="Locked picks are visible to signed-in participants."
            action={
              <Link href="/signin" className="btn btn-primary">
                Sign in
              </Link>
            }
          />
        ) : state.kind === 'sealed' ? (
          <EmptyState
            title="Picks are still sealed"
            body="This game's picks reveal when it locks, five minutes before kickoff."
          />
        ) : state.kind === 'error' ? (
          <EmptyState title="Something went wrong" body={state.message} />
        ) : (
          <section aria-label={`Participants who picked ${teamName(teamId)}`}>
            <p className="mb-4 text-sm" style={{ color: 'var(--text-muted)' }}>
              {state.list.total} {state.list.total === 1 ? 'participant' : 'participants'} picked{' '}
              {teamName(state.list.team_id)}.
            </p>
            {state.list.participants.length === 0 ? (
              <EmptyState
                title="No picks for this team"
                body="Nobody picked this team — the shares on the game card already told that story."
              />
            ) : (
              <ul className="divide-y" style={{ borderColor: 'var(--border)' }}>
                {state.list.participants.map((p) => (
                  <li key={p.user_id} className="py-3 font-medium">
                    {p.display_name}
                  </li>
                ))}
              </ul>
            )}
            {state.list.next_cursor && (
              <button
                type="button"
                onClick={loadMore}
                disabled={state.loadingMore}
                className="btn mt-4"
              >
                {state.loadingMore ? 'Loading…' : 'Show more'}
              </button>
            )}
          </section>
        )}
      </div>
    </div>
  );
}
