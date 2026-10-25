/* Operational log — what the /police/logs page reads.
 *
 * Two sources, deliberately kept apart:
 *
 *   Log-Debug-web   this app appends here (errors + who did what)
 *   Log-Debug-Bot   the Discord bot appends there; we only read it
 *
 * Both tabs live in the bot's Settings spreadsheet, beside its `config` tab —
 * not in a data file. A tab that grows inside NamePD or the weekly sheets slows
 * down the file people actually work in and eats the same 10M-cell ceiling. One
 * tab per writer means the two never contend for the same append range and each
 * can be read or cleared alone.
 *
 * Neither tab grows without bound: each keeps its newest `LOG_MAX_ROWS` rows.
 * The bot trims both on a timer (it is the only side with one), and this app
 * also trims its own tab when the page is opened, so a sleeping bot cannot let
 * it drift.
 *
 * Why the sheet at all, for a serverless app: this runtime has no memory that
 * survives a request. `cache.ts` and `rateLimit.ts` are already instance-local
 * for that reason — a log buffer here would be too, and would answer "what
 * happened an hour ago" with whatever this one instance happens to remember.
 * So only the lines worth keeping go out to the sheet, and the bot's verbose
 * debug stays in the bot's own memory where it is free (see its /logs).
 *
 * Volume is the constraint, not size: the bot and this app share one Google
 * service account, so they share its write quota (~60/min). Admin actions and
 * errors are tens per day, which is nothing. Logging every request would not
 * be — do not add one.
 */

import { config } from '@/server/config';
import { getSheets } from './sheetsApi';
import { ApiError } from '@/server/errors';

export type LogLevel = 'INFO' | 'WARN' | 'ERROR';

export interface LogRow {
  /** 'YYYY-MM-DD HH:mm:ss' in Bangkok time, as stored. */
  at: string;
  level: string;
  context: string;
  actor: string;
  message: string;
  detail: string;
}

export interface LogQuery {
  levels?: string[];
  context?: string;
  search?: string;
  limit?: number;
}

const HEADER = ['เวลา', 'ระดับ', 'หมวด', 'ใครทำ', 'ข้อความ', 'รายละเอียด'];
const TZ = 'Asia/Bangkok';

/** Ceiling on one read, so a long-lived tab cannot return a huge payload. */
export const MAX_ROWS = 2000;

/** A slow sheet must not hold up the request that is only logging to it. */
const WRITE_TIMEOUT_MS = 4_000;

/* ==================== time ==================== */

/**
 * Bangkok-local `YYYY-MM-DD HH:mm:ss`.
 *
 * Built from parts rather than a locale format string: `hour: '2-digit'` with
 * `hour12: false` drops the leading zero on some ICU builds, and an unpadded
 * hour is what makes the round-trip below fail.
 *
 * The bot writes the same shape into its own tab, so the page can sort and
 * compare across both. Changing it here means changing it there too.
 */
export function formatLogTime(at: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(at));

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const p2 = (s: string) => s.padStart(2, '0');

  return (
    `${get('year')}-${p2(get('month'))}-${p2(get('day'))} ` +
    `${p2(get('hour'))}:${p2(get('minute'))}:${p2(get('second'))}`
  );
}

/* Timestamps are only ever written and displayed, never parsed back: trimming
   counts rows instead of reading dates, so nothing here depends on how Google
   chooses to display a cell. */

/* ==================== redaction ==================== */

/**
 * Strips secrets before anything is stored or shown.
 *
 * Error text from Google or Discord drags keys and tokens along with it, and
 * these rows end up in a spreadsheet and on a page other admins can open. It
 * has to happen on the way in: filtering at display time means the secret was
 * already written to the sheet.
 *
 * The bot carries its own copy of this — the two deploy separately, so there
 * is no shared module to put it in. Change both.
 */
export function redact(text: string): string {
  return (
    text
      // Google service-account PEM key
      .replace(/-----BEGIN[\s\S]*?-----END[^-]*-----/g, '[ตัดกุญแจออก]')
      // Discord bot token — three dot-separated parts
      .replace(/\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{25,}\b/g, '[ตัดโทเคนออก]')
      // name=value where the name says it is a secret; eats an Authorization scheme
      .replace(
        /\b(token|secret|password|api[_-]?key|private[_-]?key|authorization)\b\s*[:=]\s*(?:bearer\s+|basic\s+)?\S+/gi,
        (_m, name: string) => `${name}=[ตัดออก]`
      )
      .replace(/\bbearer\s+[A-Za-z0-9._~+/-]{8,}=*/gi, 'Bearer [ตัดออก]')
  );
}

/* ==================== writing ==================== */

/* Per-instance: whether this instance has confirmed the tab exists. Only
   consulted after an append fails, so the happy path costs no extra call. */
let tabChecked = false;

/* A burst of the same failure must not become a burst of sheet writes. The
   quota it would spend is the quota the bot needs to record case counts, and
   losing those is a worse outcome than losing the hundredth copy of one error.
   Over budget, lines still reach stdout; only the sheet copy is dropped, and
   the next line that gets through says how many were. */
const MAX_WRITES_PER_MINUTE = 20;
let windowStart = 0;
let writesInWindow = 0;
let droppedInWindow = 0;

/** true when this line may be written to the sheet; also rolls the window. */
function takeWriteBudget(): boolean {
  const now = Date.now();
  if (now - windowStart >= 60_000) {
    windowStart = now;
    writesInWindow = 0;
    droppedInWindow = 0;
  }
  if (writesInWindow >= MAX_WRITES_PER_MINUTE) {
    droppedInWindow++;
    return false;
  }
  writesInWindow++;
  return true;
}

/** Non-empty when the previous minute dropped lines, so the next one can say so. */
function dropNotice(): string {
  if (droppedInWindow === 0) return '';
  const n = droppedInWindow;
  droppedInWindow = 0;
  return ` [ข้าม log อีก ${n} บรรทัดในนาทีนี้ เพื่อไม่ให้แย่งโควต้า Google]`;
}

async function ensureTab(): Promise<void> {
  const sheets = getSheets();
  const meta = await sheets.spreadsheets.get({ spreadsheetId: config.LOG_SHEET_ID });
  const exists = (meta.data.sheets ?? []).some(
    (s) => s.properties?.title === config.LOG_SHEET_NAME
  );
  if (exists) return;

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.LOG_SHEET_ID,
    requestBody: {
      requests: [
        {
          addSheet: {
            properties: {
              title: config.LOG_SHEET_NAME,
              gridProperties: { rowCount: 1000, columnCount: HEADER.length, frozenRowCount: 1 },
            },
          },
        },
      ],
    },
  });

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.LOG_SHEET_ID,
    range: `${config.LOG_SHEET_NAME}!A1`,
    valueInputOption: 'RAW',
    requestBody: { values: [HEADER] },
  });
}

async function append(row: string[]): Promise<void> {
  await getSheets().spreadsheets.values.append({
    spreadsheetId: config.LOG_SHEET_ID,
    range: `${config.LOG_SHEET_NAME}!A1`,
    // RAW, not USER_ENTERED: the latter turns the timestamp into a Google date
    // value, and reading it back then returns the cell's display format rather
    // than what we wrote — which silently breaks cleanup.
    valueInputOption: 'RAW',
    requestBody: { values: [row] },
  });
}

export interface LogOptions {
  /** Discord id of whoever caused this, when there is one. */
  actor?: string;
  /** Anything extra; stored as JSON in the last column. */
  detail?: Record<string, unknown>;
}

/**
 * Records one line: to stdout always, and to the sheet as well.
 *
 * Never throws and never rejects. A log line failing must not turn a working
 * request into an error — the console copy is still there either way, and the
 * caller has real work to finish.
 */
export async function logEvent(
  level: LogLevel,
  context: string,
  message: string,
  options: LogOptions = {}
): Promise<void> {
  const safe = redact(message);
  const actor = options.actor ?? '';
  const detail = options.detail ? redact(JSON.stringify(options.detail)) : '';

  /* Keeps the old `[context] message` shape, so Vercel's own log view reads
     the same as it did before any of this existed. */
  const line = `[${context}] ${safe}${actor ? ` (โดย ${actor})` : ''}`;
  if (level === 'ERROR') console.error(line);
  else if (level === 'WARN') console.warn(line);
  else console.log(line);

  if (!takeWriteBudget()) return;

  const row = [formatLogTime(Date.now()), level, context, actor, safe + dropNotice(), detail];

  try {
    await Promise.race([
      (async () => {
        try {
          await append(row);
          tabChecked = true;
        } catch (err) {
          // Most likely cause of a first failure is a missing tab (someone
          // deleted it). Rebuild once and retry; anything else rethrows.
          if (tabChecked) throw err;
          await ensureTab();
          tabChecked = true;
          await append(row);
        }
      })(),
      new Promise<void>((_, reject) =>
        setTimeout(() => reject(new Error('log write timed out')), WRITE_TIMEOUT_MS)
      ),
    ]);
  } catch (err) {
    tabChecked = false;
    console.error(`[opslog] ไม่สามารถเขียน log ลงชีตได้: ${(err as Error).message}`);
  }
}

/* ==================== reading ==================== */

function matches(row: LogRow, q: LogQuery): boolean {
  if (q.levels && q.levels.length > 0 && !q.levels.includes(row.level)) return false;
  if (q.context && row.context.toLowerCase() !== q.context.toLowerCase()) return false;
  if (q.search) {
    const hay = `${row.context} ${row.actor} ${row.message} ${row.detail}`.toLowerCase();
    if (!hay.includes(q.search.toLowerCase())) return false;
  }
  return true;
}

/** Shapes raw sheet values into rows, newest last — the order they were written. */
export function toLogRows(values: string[][]): LogRow[] {
  const out: LogRow[] = [];
  // Row 1 is the header.
  for (let i = 1; i < values.length; i++) {
    const r = values[i] ?? [];
    const at = (r[0] ?? '').trim();
    if (!at) continue;
    out.push({
      at,
      level: (r[1] ?? '').trim(),
      context: (r[2] ?? '').trim(),
      actor: (r[3] ?? '').trim(),
      message: (r[4] ?? '').trim(),
      detail: (r[5] ?? '').trim(),
    });
  }
  return out;
}

/** Applies a query and keeps the newest matches, so `limit` counts what is shown. */
export function selectLogRows(rows: LogRow[], q: LogQuery): LogRow[] {
  const limit = q.limit && q.limit > 0 ? Math.min(q.limit, MAX_ROWS) : MAX_ROWS;
  return rows.filter((r) => matches(r, q)).slice(-limit);
}

async function readTab(tab: string): Promise<string[][]> {
  /* The Sheets API, not the GViz CSV export the big read-only sheets use:
     GViz answers from a CDN cache, so a log page would show stale lines for
     minutes — the one thing it must not do. */
  const res = await getSheets().spreadsheets.values.get({
    spreadsheetId: config.LOG_SHEET_ID,
    range: `${tab}!A:F`,
  });
  return (res.data.values as string[][] | undefined) ?? [];
}

export interface LogResult {
  rows: LogRow[];
  /** Total stored lines before the query narrowed them. */
  total: number;
}

/**
 * This app's own log, tidied on the way out.
 *
 * One read serves both the answer and the trim, which keeps a page load to a
 * single fetch. The bot trims this tab on its own timer as well; doing it here
 * too costs nothing on a read we already made and covers the bot being down.
 */
export async function readWebLog(q: LogQuery): Promise<LogResult> {
  const values = await readTab(config.LOG_SHEET_NAME);
  const all = toLogRows(values);

  const removed = await cleanupWebLog(values);
  const kept = removed > 0 ? all.slice(removed) : all;

  return { rows: selectLogRows(kept, q), total: kept.length };
}

/** The bot's log, as it stands in the sheet (newest rows, important lines only). */
export async function readBotSheetLog(q: LogQuery): Promise<LogResult> {
  const rows = toLogRows(await readTab(config.BOT_LOG_SHEET_NAME));
  return { rows: selectLogRows(rows, q), total: rows.length };
}

/* ==================== the bot's live log ==================== */

export interface BotLiveResult {
  bot: { ready: boolean; uptime: number; wsPing: number };
  buffer: { lines: number; oldest: number | null; newest: number | null };
  pendingSheetRows: number;
  pendingCountOps: number;
  entries: { at: number; level: string; context: string; message: string; meta?: unknown }[];
}

/**
 * The bot's last 24 hours, straight from its memory.
 *
 * Asked server-side so the shared secret never reaches the browser, and sent
 * as a header rather than a query string so it stays out of access logs.
 */
export async function fetchBotLiveLog(q: LogQuery): Promise<BotLiveResult> {
  if (!config.BOT_URL || !config.BOT_LOG_TOKEN) {
    throw new ApiError('ยังไม่ได้ตั้งค่า BOT_URL หรือ BOT_LOG_TOKEN — ยังดู log สดของบอทไม่ได้', 503);
  }

  const url = new URL('/logs', config.BOT_URL);
  if (q.levels?.length) url.searchParams.set('level', q.levels.join(','));
  if (q.context) url.searchParams.set('context', q.context);
  if (q.search) url.searchParams.set('q', q.search);
  url.searchParams.set('limit', String(Math.min(q.limit || MAX_ROWS, MAX_ROWS)));

  let res: Response;
  try {
    res = await fetch(url, {
      headers: { 'x-log-token': config.BOT_LOG_TOKEN },
      cache: 'no-store',
      signal: AbortSignal.timeout(config.REQUEST_TIMEOUT),
    });
  } catch {
    // A sleeping or restarting bot is the normal reason — say so plainly
    // instead of surfacing a fetch failure the reader cannot act on.
    throw new ApiError('ต่อบอทไม่ได้ (อาจกำลังรีสตาร์ทหรือหลับอยู่)', 503);
  }

  if (res.status === 401) throw new ApiError('บอทปฏิเสธรหัสผ่าน — BOT_LOG_TOKEN ไม่ตรงกัน', 502);
  if (res.status === 503) throw new ApiError('บอทยังไม่ได้ตั้ง LOG_API_TOKEN จึงปิดช่องนี้ไว้', 503);
  if (!res.ok) throw new ApiError(`บอทตอบกลับ HTTP ${res.status}`, 502);

  return (await res.json()) as BotLiveResult;
}

/* ==================== cleanup ==================== */

/**
 * How many rows at the top are over the ceiling.
 *
 * Rows are only ever appended, so the oldest sit at the top and dropping that
 * many leaves exactly the newest `maxRows`. Row 1 is the header and is not
 * counted as data. A ceiling of 0 or less means "keep everything", never
 * "delete everything".
 */
export function countRowsToDrop(values: string[][], maxRows: number): number {
  if (maxRows <= 0) return 0;
  const data = Math.max(values.length - 1, 0);
  return data > maxRows ? data - maxRows : 0;
}

/**
 * Trims this app's tab down to the newest `LOG_MAX_ROWS` rows.
 *
 * Runs when an admin opens the page rather than on a schedule: this runtime has
 * no scheduler. The bot does have one and trims both tabs there, so this is the
 * backstop for the bot being asleep, not the only thing keeping the tab small.
 *
 * Never throws; tidying is not worth failing a page load over.
 */
export async function cleanupWebLog(known?: string[][]): Promise<number> {
  try {
    // The caller usually just read the tab; re-reading it would double the
    // cost of every page load for no new information.
    const values = known ?? (await readTab(config.LOG_SHEET_NAME));
    const expired = countRowsToDrop(values, config.LOG_MAX_ROWS);
    if (expired < 1) return 0;

    const sheets = getSheets();
    const meta = await sheets.spreadsheets.get({ spreadsheetId: config.LOG_SHEET_ID });
    const tabId = (meta.data.sheets ?? []).find(
      (s) => s.properties?.title === config.LOG_SHEET_NAME
    )?.properties?.sheetId;
    if (tabId === undefined || tabId === null) return 0;

    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.LOG_SHEET_ID,
      requestBody: {
        requests: [
          {
            // Index 1 skips the header row; the end index is exclusive.
            deleteDimension: {
              range: { sheetId: tabId, dimension: 'ROWS', startIndex: 1, endIndex: expired + 1 },
            },
          },
        ],
      },
    });
    return expired;
  } catch (err) {
    console.error(`[opslog] ลบ log เก่าไม่สำเร็จ: ${(err as Error).message}`);
    return 0;
  }
}
