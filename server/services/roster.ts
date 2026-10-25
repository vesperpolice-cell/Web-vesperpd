/* Roster management — NamePD and OutDC sheets, columns B–N:
   B=phone C=code D=name E=discordId F=rank G=cases H=startDate
   I=days J=lastDuty K=lastTime L=duration M=steam N=status/reason */

import { config } from '@/server/config';
import { getSheets } from './sheetsApi';
import { invalidate } from './cache';
import { ApiError } from '@/server/errors';

export const EXIT_REASONS = [
  'ออกจาก Discord',
  'ถูกปลดออก',
  'ติดต่อขอออก',
  'เกิน 15 วัน',
] as const;

export type ExitReason = (typeof EXIT_REASONS)[number];

export const isExitReason = (value: string): value is ExitReason =>
  (EXIT_REASONS as readonly string[]).includes(value);

/* The two departures that are announced in Discord. The other two are not, and
   that difference is what a batch's size is really limited by — so it is named
   once here and read by both the route that posts and the batch that counts. */
const ANNOUNCED_REASONS: readonly ExitReason[] = ['ถูกปลดออก', 'ติดต่อขอออก'];

export const isAnnounced = (reason: ExitReason) => ANNOUNCED_REASONS.includes(reason);

export interface RosterMember {
  row: number;
  code: string;
  name: string;
  phone: string;
  discordId: string;
  rank: string;
  cases: string;
  startDate: string;
  days: string;
  lastDuty: string;
  lastTime: string;
  duration: string;
  steam: string;
  status: string;
}

function mapMembers(rows: string[][]): RosterMember[] {
  const cell = (row: string[], i: number) => (row[i] ?? '').trim();
  const members: RosterMember[] = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i] ?? [];
    const code = cell(row, 1);
    if (!code || code.length > 3 || !/^\d+$/.test(code)) continue;

    const name = cell(row, 2);
    if (!name) continue;

    members.push({
      row: i + 1,
      code,
      name,
      phone: cell(row, 0),
      discordId: cell(row, 3),
      rank: cell(row, 4),
      cases: cell(row, 5),
      startDate: cell(row, 6),
      days: cell(row, 7),
      lastDuty: cell(row, 8),
      lastTime: cell(row, 9),
      duration: cell(row, 10),
      steam: cell(row, 11),
      status: cell(row, 12),
    });
  }

  return members;
}

async function readSheet(sheetName: string): Promise<RosterMember[]> {
  const response = await getSheets().spreadsheets.values.get({
    spreadsheetId: config.ROSTER_SHEET_ID,
    range: `${sheetName}!B:N`,
  });
  return mapMembers((response.data.values as string[][]) || []);
}

export const getNamePDMembers = () => readSheet(config.ROSTER_SHEET_NAME);
export const getOutDCMembers = () => readSheet(config.ROSTER_OUT_SHEET_NAME);

/* One cell per call would be one Sheets write per person, and this app shares
   its write quota with the bot — so the console's "tick several, set one status"
   action arrives here as a batch and leaves as a single write. */
export async function updateStatusMany(rows: number[], status: string): Promise<void> {
  if (rows.length === 0) return;

  await getSheets().spreadsheets.values.batchUpdate({
    spreadsheetId: config.ROSTER_SHEET_ID,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: rows.map((row) => ({
        range: `${config.ROSTER_SHEET_NAME}!N${row}`,
        values: [[status]],
      })),
    },
  });

  /* NamePD is also what `/officers` reads, through the GViz export rather than
     this API. Without this the public roster keeps showing yesterday's status
     until its cache expires. */
  invalidate('officers');
}

export const updateStatus = (row: number, status: string) => updateStatusMany([row], status);

/**
 * The first `count` blank rows in OutDC from row 3 down, judged by the name
 * column.
 *
 * Blank rows are collected one by one rather than as a run starting at the
 * first gap: OutDC has gaps in it, so a batch written consecutively from the
 * first blank row would land on top of whoever sits below that gap.
 */
async function findEmptyOutDCRows(count: number): Promise<number[]> {
  const res = await getSheets().spreadsheets.values.get({
    spreadsheetId: config.ROSTER_SHEET_ID,
    range: `${config.ROSTER_OUT_SHEET_NAME}!D3:D`,
    valueRenderOption: 'FORMATTED_VALUE',
  });

  const rows = res.data.values || [];
  const found: number[] = [];

  for (let i = 0; i < rows.length && found.length < count; i++) {
    if (!rows[i]?.[0] || !String(rows[i][0]).trim()) found.push(3 + i);
  }

  // Past the end of the used range every row is blank.
  for (let i = rows.length; found.length < count; i++) found.push(3 + i);

  return found;
}

/* What a departure vacates on NamePD. C (code), F (rank), I (days) and
   L (duration) are deliberately kept, which is what breaks this into five
   spans instead of one — and spans rather than 16 single cells because a bulk
   move clears every selected row in one request. */
const VACATED_SPANS = ['B', 'D:E', 'G:H', 'J:K', 'M:U'] as const;

const vacatedRanges = (row: number) =>
  VACATED_SPANS.map((span) => {
    const [from, to] = span.split(':');
    return `${config.ROSTER_SHEET_NAME}!${from}${row}:${to ?? from}${row}`;
  });

export async function moveToOutDC(row: number, reason: ExitReason) {
  const sheets = getSheets();

  const source = await sheets.spreadsheets.values.get({
    spreadsheetId: config.ROSTER_SHEET_ID,
    range: `${config.ROSTER_SHEET_NAME}!B${row}:N${row}`,
  });

  const values = source.data.values?.[0];
  if (!values || values.length < 13) {
    throw new ApiError('ไม่พบข้อมูลแถวนี้ใน NamePD', 404);
  }

  const [phone, code, name, discordId, rank, cases, startDate, days, lastDuty, lastTime, duration, steam, status] =
    values as string[];

  // The sheet's own status column wins when set; the request's reason is the fallback.
  const finalReason = status || reason;
  const [targetRow] = await findEmptyOutDCRows(1);

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.ROSTER_SHEET_ID,
    range: `${config.ROSTER_OUT_SHEET_NAME}!B${targetRow}:N${targetRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        [
          phone, code, name, discordId, rank, cases,
          startDate, days, lastDuty, lastTime, duration, steam, finalReason,
        ],
      ],
    },
  });

  /* One batchClear replaces the 16 sequential writes the v2 service made. */
  await sheets.spreadsheets.values.batchClear({
    spreadsheetId: config.ROSTER_SHEET_ID,
    requestBody: { ranges: vacatedRanges(row) },
  });

  invalidate('officers');
  return { code, name, discordId };
}

export interface MovedMember {
  row: number;
  code: string;
  name: string;
  discordId: string;
  reason: ExitReason;
}

/**
 * The bulk departure behind the console's "ย้ายออกที่ติ๊ก" button.
 *
 * Looping the single-row move would spend three Sheets round trips per person,
 * which is both the shared write quota and the function's 10s budget gone by
 * the fifth one. This reads every source row in one call, places them all in
 * one write and vacates them all in one clear — four calls whatever the
 * headcount.
 *
 * Nothing is written until every row has been read and checked, so a batch
 * that cannot be completed in full leaves both sheets untouched. Each person's
 * reason is their own status cell and nothing else: the caller cannot hand one
 * in, and someone still marked ปกติ is refused by name rather than moved out
 * for an invented reason.
 */
export async function moveManyToOutDC(
  rows: number[],
  { maxAnnounced }: { maxAnnounced: number }
): Promise<MovedMember[]> {
  if (rows.length === 0) return [];

  const sheets = getSheets();

  const read = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: config.ROSTER_SHEET_ID,
    ranges: rows.map((row) => `${config.ROSTER_SHEET_NAME}!B${row}:N${row}`),
  });

  const valueRanges = read.data.valueRanges || [];
  const members: MovedMember[] = [];
  const payload: string[][] = [];
  const refused: string[] = [];

  rows.forEach((row, i) => {
    /* Sheets drops trailing empty cells, so a short row is padded back to
       B–N rather than read with the columns shifted along. */
    const values = (valueRanges[i]?.values?.[0] as string[] | undefined) ?? [];
    const cells = Array.from({ length: 13 }, (_, c) => (values[c] ?? '').trim());
    const [, code, name, discordId, , , , , , , , , status] = cells;

    if (!name) {
      refused.push(`แถว ${row}: ไม่พบข้อมูลใน NamePD`);
      return;
    }
    if (!isExitReason(status)) {
      refused.push(`${code} ${name}: ยังไม่ได้ตั้งสาเหตุที่ย้ายออก`);
      return;
    }

    members.push({ row, code, name, discordId, reason: status });
    payload.push(cells);
  });

  /* Joined with a separator rather than newlines, and cut short: this lands
     in a one-line toast on the console, which would run the lines together
     anyway and has no room for twenty of them. */
  if (refused.length > 0) {
    const shown = refused.slice(0, 5).join(' • ');
    const rest = refused.length - 5;
    throw new ApiError(shown + (rest > 0 ? ` • และอีก ${rest} รายการ` : ''), 400);
  }

  /* The Sheets work is a fixed four calls, so what actually limits a batch is
     the Discord posts — and only two of the four reasons have one. Counted
     here, where the reasons are finally known, and still before anything has
     been written: a batch too large to announce moves nobody. */
  const announced = members.filter((m) => isAnnounced(m.reason)).length;
  if (announced > maxAnnounced) {
    throw new ApiError(
      `"ถูกปลดออก" และ "ติดต่อขอออก" ต้องประกาศใน Discord ทีละคน ` +
        `จึงย้ายได้ครั้งละไม่เกิน ${maxAnnounced} คน (ติ๊กมา ${announced} คน)`,
      400
    );
  }

  const targets = await findEmptyOutDCRows(members.length);

  /* OutDC first, then NamePD — the same order the single move uses. A failure
     between the two leaves a duplicate, which is recoverable; the other order
     would lose the row. */
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.ROSTER_SHEET_ID,
    requestBody: {
      valueInputOption: 'USER_ENTERED',
      data: targets.map((target, i) => ({
        range: `${config.ROSTER_OUT_SHEET_NAME}!B${target}:N${target}`,
        values: [payload[i]],
      })),
    },
  });

  await sheets.spreadsheets.values.batchClear({
    spreadsheetId: config.ROSTER_SHEET_ID,
    requestBody: { ranges: members.flatMap((m) => vacatedRanges(m.row)) },
  });

  invalidate('officers');
  return members;
}

/** Announces a departure in Discord. Failure is reported, never thrown. */
export async function sendExitWebhook(
  reason: ExitReason,
  discordId: string
): Promise<{ success: boolean; error?: string }> {
  const webhookUrl = config.DISCORD_OUTPD_WEBHOOK_URL;
  if (!webhookUrl) return { success: false, error: 'DISCORD_OUTPD_WEBHOOK_URL not configured' };

  const now = new Date();
  const dateStr = now.toLocaleDateString('th-TH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });

  const label = reason === 'ถูกปลดออก' ? 'ถูกปลดออก' : 'ลาออก';

  try {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: `<@${discordId}>`,
        embeds: [
          {
            title: '📢 ประกาศลาออกจากการเป็นเจ้าหน้าที่',
            description:
              `ต่อจากนี้ คุณ <@${discordId}> ได้${label}จากการเป็นเจ้าหน้าที่\n` +
              `ต่อจากนี้การกระทำใดๆก็แล้วแต่จะไม่ข้องเกี่ยวกับ สน อีกต่อไป\n\n` +
              `ณ วันที่ ${dateStr} (คูลดาวน์ 3 วัน)\n\nขอบคุณสำหรับการทำงานที่ผ่านมา`,
            color: reason === 'ถูกปลดออก' ? 0xef4444 : 0x3b82f6,
            timestamp: now.toISOString(),
          },
        ],
      }),
      signal: AbortSignal.timeout(config.REQUEST_TIMEOUT),
    });

    return res.ok ? { success: true } : { success: false, error: `status=${res.status}` };
  } catch (err) {
    return { success: false, error: (err as Error).message };
  }
}
