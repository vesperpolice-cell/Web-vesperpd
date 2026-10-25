/* Pending registration sheet — columns A–I:
   timestamp, discordId, discordName, icName, icPhone, ocAge, steamUrl, status,
   and I: the id of the Discord message the submission created.

   Column I is what lets someone edit an application without having kept that
   id themselves — it is found from the Discord account they are signed in as.
   Rows written before the column existed have it empty, which reads as "no
   record" and sends the page back to asking for the id by hand.

   The proctor listing still reads A:H on purpose. It maps by header name, so a
   ninth column would put the message id in front of reviewers who have no use
   for it. The permission cells sit further along that row again, at L1/M1 —
   see services/permissions.ts. */

import { config } from '@/server/config';
import { getSheets } from './sheetsApi';
import { findLatestSubmission, type ApplicationSheet } from './applicationSheet';

const STATUS_PENDING = 'รอตรวจ';

const REGISTER_SHEET: ApplicationSheet = {
  get spreadsheetId() {
    return config.PENDING_SPREADSHEET_ID;
  },
  get sheetName() {
    return config.PENDING_SHEET_NAME;
  },
  discordColumn: 'B',
  messageColumn: 'I',
};

interface PendingRow {
  [key: string]: string | number;
  _row: number;
}

export async function addPendingRegistration(data: {
  discordId: string;
  discordName: string;
  icName: string;
  icPhone: string;
  ocAge: number;
  steamUrl: string;
  /** Empty only if Discord somehow returned no id; the row is still worth
      writing, it just cannot be found again without the id typed by hand. */
  messageId?: string;
}): Promise<void> {
  const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

  await getSheets().spreadsheets.values.append({
    spreadsheetId: config.PENDING_SPREADSHEET_ID,
    range: `${config.PENDING_SHEET_NAME}!A:I`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        [
          timestamp,
          data.discordId,
          data.discordName || '',
          data.icName,
          data.icPhone,
          String(data.ocAge),
          data.steamUrl,
          STATUS_PENDING,
          data.messageId ?? '',
        ],
      ],
    },
  });
}

export async function getPendingRegistrations(): Promise<PendingRow[]> {
  const response = await getSheets().spreadsheets.values.get({
    spreadsheetId: config.PENDING_SPREADSHEET_ID,
    range: `${config.PENDING_SHEET_NAME}!A:H`,
  });

  const rows = response.data.values || [];
  if (rows.length <= 1) return [];

  const headers = (rows[0] || []) as string[];

  return rows.slice(1).map((row, index) => {
    const item: PendingRow = { _row: index + 2 };
    headers.forEach((header, i) => {
      item[header] = String(row[i] ?? '').trim();
    });
    return item;
  });
}

async function setStatus(rowNumber: number, status: string): Promise<void> {
  await getSheets().spreadsheets.values.update({
    spreadsheetId: config.PENDING_SPREADSHEET_ID,
    range: `${config.PENDING_SHEET_NAME}!H${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[status]] },
  });
}

export const approvePending = (row: number) => setStatus(row, 'อนุมัติ');
export const rejectPending = (row: number) => setStatus(row, 'ปฏิเสธ');

/** The Discord message behind this account's latest application, or null when
    there is no row for it or the row predates column I. */
export async function findPendingMessageId(discordId: string): Promise<string | null> {
  const found = await findLatestSubmission(REGISTER_SHEET, discordId);
  return found?.messageId || null;
}

/**
 * The phone on this account's latest application, or '' when there is no row.
 *
 * The embed deliberately no longer carries it — a channel anyone can scroll
 * back through is the wrong place for an applicant's number. The sheet is
 * therefore the only copy the edit form can read it back from, so dropping
 * this lookup would silently blank the field on every edit.
 */
export async function findPendingPhone(discordId: string): Promise<string> {
  const found = await findLatestSubmission(REGISTER_SHEET, discordId);
  if (!found) return '';

  const response = await getSheets().spreadsheets.values.get({
    spreadsheetId: config.PENDING_SPREADSHEET_ID,
    range: `${config.PENDING_SHEET_NAME}!E${found.row}`,
  });

  return String(response.data.values?.[0]?.[0] ?? '').trim();
}

/** Updates columns D–G on whichever row holds this Discord id. */
export async function updatePendingRegistration(
  discordId: string,
  data: { icName: string; icPhone: string; ocAge: number; steamUrl: string }
): Promise<void> {
  const found = await findLatestSubmission(REGISTER_SHEET, discordId);

  // Not found is expected once a registration has been approved and removed.
  if (!found) return;

  await getSheets().spreadsheets.values.update({
    spreadsheetId: config.PENDING_SPREADSHEET_ID,
    range: `${config.PENDING_SHEET_NAME}!D${found.row}:G${found.row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [[data.icName, data.icPhone, String(data.ocAge), data.steamUrl]],
    },
  });
}
