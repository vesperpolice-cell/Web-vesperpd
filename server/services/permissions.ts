/* Page access lists kept in the spreadsheet — a Discord id allowlist.

   Everything administrative used to be gated by ADMIN_PIN: one shared code
   that opened every admin endpoint at once, could not say who had used it, and
   had to be changed and redistributed to take access away from a single
   person. The gate is now the signed Discord session cookie plus a list of
   user ids held in the sheet, so access is granted or revoked by editing one
   cell and every write is attributable to a named account.

   ROSTER_MANAGE below is that list for the whole site, not just its own
   console: the rules/fines/conduct editors, the payment confirmation and
   /police read it too, because the same handful of people do all of it. A
   separate group would mean a second PermissionSource, not a second reader.

   The list is not a credential. Knowing an allowed id grants nothing, because
   the id has to come from a Discord login this server verified (see
   services/session.ts) — which is what makes a sheet other people can read a
   safe place to keep it. ADMIN_PIN never was.

   Read through the Sheets API rather than the GViz export on purpose: GViz is
   CDN-cached, so an id deleted from the sheet could keep working for minutes. */

import { config } from '@/server/config';
import { ApiError } from '@/server/errors';
import { cached } from './cache';
import { getSheets } from './googleAuth';
import { readSessionUserId } from './session';

export interface PermissionSource {
  /** Cache key, and the name this list is known by. */
  readonly name: string;
  readonly spreadsheetId: string;
  readonly sheetName: string;
  /** Two cells on one row: the key cell, then the ids cell. */
  readonly range: string;
  /** What the key cell has to contain. Checked so a row inserted above it
      surfaces as a named misconfiguration rather than silently reading
      whatever data has slid into its place. */
  readonly key: string;
  /** Standby ids from the environment, always merged in. They are what keeps a
      mistyped or shifted sheet from locking the last admin out. */
  readonly fallback: string;
}

/** Where the site's admin list lives: NamePD!AA2 holds the key, AB2 the ids.
    Positional like the rest of the sheet layer — moving those two cells breaks
    this, which is why the key cell is verified rather than assumed. */
export const ROSTER_MANAGE: PermissionSource = {
  name: 'rostermanage',
  get spreadsheetId() {
    return config.ROSTER_SHEET_ID;
  },
  sheetName: config.ROSTER_SHEET_NAME,
  range: 'AA2:AB2',
  key: 'ROSTERMANAGE_IDDC',
  get fallback() {
    return config.ROSTERMANAGE_IDDC;
  },
};

/** Where the /proctor list lives: Pending!L1 holds the key, M1 the ids.

    Moved off I1/J1 when column I became the submission's Discord message id:
    the pending data range now reaches I, and a config cell inside it would
    arrive as a column header and ship the allowlist to the browser with every
    row. J and K are left empty as room for the data row to grow again. */
export const PROCTOR: PermissionSource = {
  name: 'proctor',
  get spreadsheetId() {
    return config.PENDING_SPREADSHEET_ID;
  },
  get sheetName() {
    return config.PENDING_SHEET_NAME;
  },
  range: 'L1:M1',
  key: 'PROCTOR_IDDC',
  get fallback() {
    return config.PROCTOR_IDDC;
  },
};

/* Every separator anyone might type — comma, semicolon, space, newline — plus
   the <@id> form a Discord copy produces, all handled by picking out runs of
   digits the length of a snowflake instead of splitting on a chosen character. */
function parseIds(raw: string): string[] {
  return raw.match(/\d{15,25}/g) ?? [];
}

interface Allowlist {
  ids: Set<string>;
  /** Non-empty when the sheet could not be trusted, so the page can say "the
      sheet is misconfigured" instead of "you have no access". */
  problem: string;
}

async function readAllowlist(source: PermissionSource): Promise<Allowlist> {
  /* Parsed first and merged into every return below, including the failure
     paths: a standby id that only worked when the sheet was readable would be
     no use for the one case it exists to cover. */
  const fallback = parseIds(source.fallback);
  const keyCell = `${source.sheetName}!${source.range.split(':')[0]}`;

  try {
    const response = await getSheets().spreadsheets.values.get({
      spreadsheetId: source.spreadsheetId,
      range: `${source.sheetName}!${source.range}`,
    });

    const row = (response.data.values?.[0] as string[] | undefined) ?? [];
    const label = (row[0] ?? '').trim();

    if (label.toUpperCase() !== source.key) {
      return {
        ids: new Set(fallback),
        problem:
          `ช่อง ${keyCell} ต้องเขียนว่า "${source.key}" แต่พบ "${label}" — ` +
          'อาจมีการแทรกแถวหรือย้ายเซลล์ กรุณาแก้ในชีต',
      };
    }

    const ids = parseIds(row[1] ?? '');
    return {
      ids: new Set([...ids, ...fallback]),
      problem:
        ids.length === 0 && fallback.length === 0
          ? `ยังไม่ได้ใส่ Discord ID ในช่องถัดจาก ${keyCell} ของชีต`
          : '',
    };
  } catch (err) {
    return {
      ids: new Set(fallback),
      problem: `อ่านสิทธิ์จากชีตไม่สำเร็จ: ${(err as Error).message}`,
    };
  }
}

/** Cached for CACHE_TTL, so a burst of clicks costs one Sheets read and an id
    removed from the sheet stops working within seconds — no redeploy. */
function allowlist(source: PermissionSource): Promise<Allowlist> {
  return cached(`permission:${source.name}`, async () => {
    const result = await readAllowlist(source);

    /* Logged once per cache fill rather than per request. The page shows this
       only to someone already through the gate, and a sheet broken badly
       enough can leave nobody through — so the log is the path that always
       reports it. */
    if (result.problem) console.warn(`[permissions] ${source.name}: ${result.problem}`);

    return result;
    /* Instance-only on purpose: a shared entry would keep an id that has just
       been removed from the sheet working until it expired, and revocation is
       the one thing here that has to take effect immediately. */
  }, { shared: false });
}

/**
 * Who this request is and whether they are on the list. Never throws: the page
 * asks this on load, where "not signed in" and "sheet misconfigured" are both
 * answers it needs to render, not errors.
 */
export async function checkPermission(
  request: Request | undefined,
  source: PermissionSource
): Promise<{ userId: string | null; allowed: boolean; problem: string }> {
  const userId = readSessionUserId(request);
  if (!userId) return { userId: null, allowed: false, problem: '' };

  const { ids, problem } = await allowlist(source);
  const allowed = ids.has(userId);

  /* The diagnostic names the sheet and the cell it expects. That is worth
     saying to someone who can go and fix it, and is nobody else's business —
     so it travels with a yes and never with a no. */
  return { userId, allowed, problem: allowed ? problem : '' };
}

/**
 * The guard every gated route calls. Returns the actor's Discord id so the
 * caller can attribute the action — the thing a shared PIN could never do.
 */
export async function requirePermission(
  request: Request | undefined,
  source: PermissionSource
): Promise<string> {
  const { userId, allowed } = await checkPermission(request, source);

  if (!userId) {
    throw new ApiError('กรุณาเชื่อมต่อ Discord ก่อนใช้งานหน้านี้', 401);
  }

  if (!allowed) {
    /* The id is echoed back because it is the one thing the person needs in
       order to be granted access — it goes to whoever grants it. Nothing about
       where the list is kept: that is not theirs to know. */
    throw new ApiError(`ไม่มีสิทธิ์ใช้งานหน้านี้ (Discord ID: ${userId})`, 403);
  }

  return userId;
}
