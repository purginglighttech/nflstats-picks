'use client';

import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, getMe } from '@/lib/api';
import type { Me } from '@/lib/types';

export type SessionStatus = 'loading' | 'signed-in' | 'signed-out';

interface SessionValue {
  status: SessionStatus;
  me: Me | null;
  /** Re-fetch /api/v1/me (e.g. after profile edits). */
  refresh: () => Promise<void>;
}

const SessionContext = createContext<SessionValue>({
  status: 'loading',
  me: null,
  refresh: async () => {},
});

export function SessionProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [me, setMe] = useState<Me | null>(null);

  const refresh = async () => {
    try {
      const member = await getMe();
      setMe(member);
      setStatus('signed-in');
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setMe(null);
        setStatus('signed-out');
      } else {
        // Network or server error: treat as signed-out for UI purposes so
        // the shell still renders; the error surfaces on the page that needs it.
        setMe(null);
        setStatus('signed-out');
      }
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  return (
    <SessionContext.Provider value={{ status, me, refresh }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionValue {
  return useContext(SessionContext);
}
