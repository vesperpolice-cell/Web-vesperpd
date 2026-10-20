'use client';

import { useCallback, useEffect, useState } from 'react';

export interface DiscordUser {
  /** Numeric snowflake — what the API stores and mentions. */
  userId: string;
  name: string;
  avatarHash: string;
}

export interface DiscordAuthState {
  user: DiscordUser | null;
  failed: boolean;
  loginUrl: string;
  disconnect: () => void;
  avatarUrl: string | null;
}

const PROFILE_KEY = 'vespd_discord_profile';

/* Display only. The OAuth redirect is the one moment the name and avatar hash
   are known, and it strips its own params immediately afterwards — so without
   this, a reload left the admin consoles showing a default avatar and no name
   even while the session itself was perfectly valid.

   Nothing authorises on it. The server decides from the signed cookie, so the
   worst a stale or hand-edited entry can do is mislabel a session — which is
   why every caller checks it against the id the server verified. */
function readProfile(): DiscordUser | null {
  try {
    const raw = localStorage.getItem(PROFILE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<DiscordUser>;
    if (!parsed.userId) return null;

    return {
      userId: parsed.userId,
      name: parsed.name ?? '',
      avatarHash: parsed.avatarHash ?? '',
    };
  } catch {
    return null; // absent, unreadable or not ours — no avatar, nothing worse
  }
}

function writeProfile(user: DiscordUser | null): void {
  try {
    if (user) localStorage.setItem(PROFILE_KEY, JSON.stringify(user));
    else localStorage.removeItem(PROFILE_KEY);
  } catch {
    /* storage unavailable — the avatar just falls back to the default */
  }
}

/** Discord's CDN path for a user's avatar, or their default one. */
export function avatarUrlFor(user: DiscordUser | null): string | null {
  if (!user) return null;
  return user.avatarHash
    ? `https://cdn.discordapp.com/avatars/${user.userId}/${user.avatarHash}.png?size=64`
    : 'https://cdn.discordapp.com/embed/avatars/0.png';
}

/** Shown when there is no profile to draw on — a browser that has not been
    through the OAuth redirect, or one with storage blocked. An empty src would
    make the browser re-request the page itself. */
const DEFAULT_AVATAR = 'https://cdn.discordapp.com/embed/avatars/0.png';

/**
 * The name and avatar to label a session with — but only when the cached
 * profile belongs to the account the server actually verified. The cache is
 * per-browser and survives a change of account, and labelling a session with
 * someone else's name is worse than showing no name at all.
 */
export function displayFor(userId: string | null, user: DiscordUser | null) {
  const match = userId && user && user.userId === userId ? user : null;
  return {
    name: match?.name ?? '',
    avatar: avatarUrlFor(match) ?? DEFAULT_AVATAR,
  };
}

/** What the OAuth callback appends. Removed by name rather than by clearing
    the query outright: a profile page carries the officer in `?name=`, and
    wiping it would leave a refresh on a page with nobody on it. */
const AUTH_PARAMS = [
  'auth',
  'error',
  'discord_id',
  'discord_userId',
  'discord_name',
  'discord_avatar',
];

/**
 * Reads the Discord identity the OAuth callback appended to the URL, then
 * strips those params so a refresh or shared link cannot replay them.
 *
 * `persist` keeps the name and avatar for later loads. Off by default: the
 * public forms show the box only as feedback for a login that just happened,
 * and reviving one there would claim a connection the page has not checked.
 */
export function useDiscordAuth(state: string, persist = false): DiscordAuthState {
  const [user, setUser] = useState<DiscordUser | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('auth');

    if (!status) {
      // No OAuth round trip on this load — fall back to what the last one left.
      if (persist) setUser(readProfile());
      return;
    }

    const userId = params.get('discord_userId');
    if (status === 'success' && userId) {
      const arrived: DiscordUser = {
        userId,
        name: params.get('discord_name') ?? '',
        avatarHash: params.get('discord_avatar') ?? '',
      };
      setUser(arrived);
      if (persist) writeProfile(arrived);
    } else if (status === 'failed') {
      setFailed(true);
    }

    const url = new URL(window.location.href);
    for (const key of AUTH_PARAMS) url.searchParams.delete(key);
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}`);
  }, [persist]);

  const disconnect = useCallback(() => {
    setUser(null);
    writeProfile(null);
  }, []);

  return {
    user,
    failed,
    loginUrl: `/auth/discord?state=${encodeURIComponent(state)}`,
    disconnect,
    avatarUrl: avatarUrlFor(user),
  };
}
