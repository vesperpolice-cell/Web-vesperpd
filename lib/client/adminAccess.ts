'use client';

/* Site-wide admin access.

   This replaced the ADMIN_PIN session. The gate is now the Discord id
   allowlist the sheet holds for /rostermanage (NamePD!AA2/AB2), so every write
   is attributable to an account and access is taken away by editing one cell
   rather than by changing a code everyone shares and redistributing it.
   Nothing here authorises anything: the server re-reads the list on every
   call, and this only decides what the page bothers to draw.

   Two separate facts, deliberately. `allowed` is whether this account may
   edit; the stored flag is whether the person has switched editing on. The
   Discord session lasts a week, so without that second flag an admin would
   find edit controls on every page for days — which is the one thing the
   30-minute PIN session got right, by expiring. */

import { useCallback, useEffect, useState } from 'react';
import { mutations } from './queries';

const STORAGE_KEY = 'vespd_admin_mode';

/** Written by the PIN build. `vespd_payment_pin` held the PIN itself. */
const LEGACY_KEYS = ['vespd_admin_session', 'vespd_payment_pin'];

const TTL_MS = 30 * 60 * 1000;

function drop(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    /* storage unavailable */
  }
}

function readMarker(): boolean {
  for (const key of LEGACY_KEYS) drop(key);

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;

    const { timestamp } = JSON.parse(raw) as { timestamp: number };
    if (Date.now() - timestamp < TTL_MS) return true;

    drop(STORAGE_KEY);
  } catch {
    drop(STORAGE_KEY);
  }
  return false;
}

function writeMarker(on: boolean): void {
  if (!on) {
    drop(STORAGE_KEY);
    return;
  }
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ timestamp: Date.now() }));
  } catch {
    /* storage unavailable — editing simply won't survive a reload */
  }
}

export interface AdminGate {
  /** The access answer has not arrived yet. */
  checking: boolean;
  /** The Discord id the server read from the session cookie; null = signed out. */
  userId: string | null;
  allowed: boolean;
  /** Set when the allowlist could not be trusted — only ever alongside
      `allowed`, so it reaches someone who can go and fix the sheet. */
  problem: string;
  /** On the list *and* switched on: what the page gates its controls on. */
  adminMode: boolean;
  setAdminMode: (on: boolean) => void;
  logout: () => Promise<void>;
}

type Access = Pick<AdminGate, 'userId' | 'allowed' | 'problem'>;

const DENIED: Access = { userId: null, allowed: false, problem: '' };

/**
 * Asks the server who this browser is and whether that account may edit.
 *
 * The question has to be asked on load, on every page that offers editing: the
 * Discord session is an HttpOnly cookie the page cannot read, so without this
 * call a refresh would look like a logout. It costs nothing for the visitors
 * who are not signed in — the server answers those without touching the sheet.
 */
export function useAdminGate(): AdminGate {
  const [access, setAccess] = useState<Access>(DENIED);
  const [checking, setChecking] = useState(true);
  const [on, setOn] = useState(false);

  useEffect(() => {
    let active = true;
    setOn(readMarker());

    void mutations
      .adminAccess()
      .then((result) => {
        if (active) setAccess(result);
      })
      // An unanswered question is not a yes.
      .catch(() => {
        if (active) setAccess(DENIED);
      })
      .finally(() => {
        if (active) setChecking(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const setAdminMode = useCallback((next: boolean) => {
    writeMarker(next);
    setOn(next);
  }, []);

  const logout = useCallback(async () => {
    try {
      await mutations.discordLogout();
    } catch {
      /* the cookie expires on its own; nothing useful to show */
    }
    writeMarker(false);
    setOn(false);
    setAccess(DENIED);
  }, []);

  return {
    checking,
    userId: access.userId,
    allowed: access.allowed,
    problem: access.problem,
    adminMode: access.allowed && on,
    setAdminMode,
    logout,
  };
}
