'use client';

/**
 * Theme model (spec decision #21): two independent axes.
 *
 * - accent: team identity. When the member's accent source is 'team', the
 *   accent resolves from the top-ranked active team follow (the effective
 *   favorite, same derivation rule). Otherwise — signed-out users, members
 *   with no follows, or accent source 'neutral' — the neutral product-brand
 *   default applies. Each team carries luminance-tuned variants so contrast
 *   holds in both modes.
 * - luminance: personal display preference, 'light' | 'dark' | 'system'.
 *   Signed-in members persist it via PATCH /api/v1/me/settings; signed-out
 *   visitors follow the OS setting with no override UI in Phase 1.
 *
 * Applies `data-luminance` plus --accent / --accent-contrast on
 * documentElement. Surfaces/text/borders switch in CSS via
 * [data-luminance="dark"] (see globals.css).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { ApiError, getSettings, getTeamFollows, patchSettings } from '@/lib/api';
import type { AccentSource, Luminance, TeamFollow } from '@/lib/types';
import { useSession } from '@/lib/session';
import { NEUTRAL_THEME, getTeamTheme, type TeamThemeTokens } from './teams';

export type EffectiveLuminance = 'light' | 'dark';

interface ThemeValue {
  accentSource: AccentSource;
  luminance: Luminance;
  /** Resolved light/dark after applying the OS preference for 'system'. */
  effectiveLuminance: EffectiveLuminance;
  /** Resolved accent token set (team or neutral). */
  resolvedAccent: TeamThemeTokens;
  /** Hex accent for the effective luminance. */
  accent: string;
  /** AA-verified text color on a filled accent. */
  accentContrast: string;
  /** Top-ranked active follow driving the team accent, if any. */
  favoriteTeam: TeamFollow | null;
  setAccentSource: (source: AccentSource) => Promise<void>;
  setLuminance: (luminance: Luminance) => Promise<void>;
  themeError: string | null;
}

const ThemeContext = createContext<ThemeValue | null>(null);

function osPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  );
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const { status } = useSession();
  const [accentSource, setAccentSourceState] = useState<AccentSource>('team');
  const [luminance, setLuminanceState] = useState<Luminance>('system');
  const [follows, setFollows] = useState<TeamFollow[] | null>(null);
  const [osDark, setOsDark] = useState<boolean>(false);
  const [themeError, setThemeError] = useState<string | null>(null);

  // Track the OS preference; authoritative when luminance === 'system' and
  // always authoritative for signed-out visitors.
  useEffect(() => {
    setOsDark(osPrefersDark());
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setOsDark(e.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  // Load persisted settings + follows once auth state is known.
  useEffect(() => {
    if (status !== 'signed-in') {
      setFollows(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [settings, teamFollows] = await Promise.all([
          getSettings(),
          getTeamFollows(),
        ]);
        if (cancelled) return;
        setAccentSourceState(settings.accent_source);
        setLuminanceState(settings.luminance);
        setFollows(teamFollows);
      } catch (err) {
        if (cancelled) return;
        if (!(err instanceof ApiError && err.status === 401)) {
          setThemeError('Could not load theme settings; using defaults.');
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [status]);

  const signedIn = status === 'signed-in';
  const effectiveLuminance: EffectiveLuminance =
    signedIn && luminance !== 'system' ? luminance : osDark ? 'dark' : 'light';

  const favoriteTeam = useMemo<TeamFollow | null>(() => {
    if (!follows) return null;
    const active = follows
      .filter((f) => f.active)
      .sort((a, b) => a.rank_position - b.rank_position);
    return active[0] ?? null;
  }, [follows]);

  const resolvedAccent = useMemo<TeamThemeTokens>(() => {
    if (signedIn && accentSource === 'team' && favoriteTeam) {
      return getTeamTheme(favoriteTeam.team_id) ?? NEUTRAL_THEME;
    }
    return NEUTRAL_THEME;
  }, [signedIn, accentSource, favoriteTeam]);

  const accent =
    effectiveLuminance === 'dark'
      ? resolvedAccent.accentDark
      : resolvedAccent.accentLight;
  const accentContrast =
    effectiveLuminance === 'dark'
      ? resolvedAccent.accentContrastDark
      : resolvedAccent.accentContrastLight;

  // Apply to the document element.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.luminance = effectiveLuminance;
    root.style.setProperty('--accent', accent);
    root.style.setProperty('--accent-contrast', accentContrast);
  }, [effectiveLuminance, accent, accentContrast]);

  const persist = useCallback(
    async (patch: { accent_source?: AccentSource; luminance?: Luminance }) => {
      setThemeError(null);
      if (!signedIn) return;
      try {
        const updated = await patchSettings(patch);
        setAccentSourceState(updated.accent_source);
        setLuminanceState(updated.luminance);
      } catch {
        setThemeError('Could not save theme settings. Please try again.');
        throw new Error('theme-persist-failed');
      }
    },
    [signedIn],
  );

  const setAccentSource = useCallback(
    async (source: AccentSource) => {
      // Optimistic: the accent visibly follows the radio immediately.
      const prev = accentSource;
      setAccentSourceState(source);
      try {
        await persist({ accent_source: source });
      } catch {
        setAccentSourceState(prev);
      }
    },
    [accentSource, persist],
  );

  const setLuminance = useCallback(
    async (next: Luminance) => {
      const prev = luminance;
      setLuminanceState(next);
      try {
        await persist({ luminance: next });
      } catch {
        setLuminanceState(prev);
      }
    },
    [luminance, persist],
  );

  const value: ThemeValue = {
    accentSource,
    luminance,
    effectiveLuminance,
    resolvedAccent,
    accent,
    accentContrast,
    favoriteTeam,
    setAccentSource,
    setLuminance,
    themeError,
  };

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
