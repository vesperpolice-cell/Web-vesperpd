/* Signed Discord session cookie.

   The OAuth callback used to hand the browser its own Discord id in the URL
   and every write then echoed that id back in the request body. Anything the
   client sends it can also change, so the ownership check on /register/edit
   and /medical/edit was decorative: omitting the field skipped it outright,
   and supplying a victim's id — readable from the embed in Discord — passed
   it. The id has to come from something the client cannot forge instead.

   This mints an HMAC-signed value at the end of the OAuth exchange and puts
   it in an HttpOnly cookie. The payload is not encrypted (a Discord user id
   is not a secret) but it is signed, so the server can tell its own token
   from an invented one.

   No new environment variable: the key falls back to DISCORD_CLIENT_SECRET,
   which OAuth already requires, so an existing deployment keeps working
   without being reconfigured. Set SESSION_SECRET to rotate sessions on their
   own without touching the Discord app. */

import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '@/server/config';

export const SESSION_COOKIE = 'vespd_discord';

/** Long enough that editing an application days later still works, short
    enough that a leaked cookie does not last forever. */
export const SESSION_TTL_MS = 7 * 24 * 60 * 60_000;

function signingKey(): string {
  return process.env.SESSION_SECRET || config.DISCORD_CLIENT_SECRET || '';
}

function b64url(input: Buffer | string): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function unb64url(input: string): Buffer {
  const pad = (4 - (input.length % 4)) % 4;
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(pad), 'base64');
}

function sign(payload: string, key: string): string {
  return b64url(createHmac('sha256', key).update(payload).digest());
}

/** Builds the cookie value for a verified Discord user id. */
export function createSessionToken(userId: string): string {
  const key = signingKey();
  if (!key) throw new Error('Cannot sign a session: SESSION_SECRET / DISCORD_CLIENT_SECRET unset');

  const payload = b64url(`${userId}.${Date.now() + SESSION_TTL_MS}`);
  return `${payload}.${sign(payload, key)}`;
}

/** Serialised Set-Cookie value, used to log out: the cookie is HttpOnly, so
    the browser cannot clear it itself and has to ask the server. `maxAge` 0
    clears it. */
export function sessionCookieHeader(token: string, maxAgeSeconds: number, secure: boolean): string {
  const bits = [
    `${SESSION_COOKIE}=${token}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${maxAgeSeconds}`,
  ];
  if (secure) bits.push('Secure');
  return bits.join('; ');
}

/** Reads a cookie without pulling in a parser — the header is a flat list. */
function readCookie(request: Request | undefined, name: string): string | null {
  const raw = request?.headers.get('cookie');
  if (!raw) return null;

  for (const part of raw.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * The verified Discord user id for this request, or null when there is no
 * valid session. Fails closed: a missing key, a bad signature and an expired
 * token all read as "not logged in" rather than as a trusted id.
 */
export function readSessionUserId(request: Request | undefined): string | null {
  const key = signingKey();
  if (!key) return null;

  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;

  const [payload, signature] = token.split('.');
  if (!payload || !signature) return null;

  const expected = sign(payload, key);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const decoded = unb64url(payload).toString('utf8');
  const split = decoded.lastIndexOf('.');
  if (split < 1) return null;

  const userId = decoded.slice(0, split);
  const expiresAt = Number(decoded.slice(split + 1));
  if (!userId || !Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;

  return userId;
}
