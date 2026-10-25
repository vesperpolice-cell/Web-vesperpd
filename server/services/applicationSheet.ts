/* Finding an applicant's own submission.

   Both application sheets are keyed the same way: the applicant's Discord id
   in one column, and the id of the Discord message their submission created in
   another. That pair is what lets someone edit an application without having
   kept the message id — it is found from the account they are signed in as.
   The two sheets differ only in which columns those are. */

import { getSheets } from './sheetsApi';

export interface ApplicationSheet {
  readonly spreadsheetId: string;
  readonly sheetName: string;
  /** Column holding the applicant's Discord id. */
  readonly discordColumn: string;
  /** Column holding the id of the message the submission created. */
  readonly messageColumn: string;
}

/** 'A' → 0, 'K' → 10. */
function columnIndex(letter: string): number {
  return [...letter.toUpperCase()].reduce((n, ch) => n * 26 + (ch.charCodeAt(0) - 64), 0) - 1;
}

export interface Submission {
  /** 1-based, so it can be written back to directly. */
  row: number;
  /** Empty on rows written before the sheet recorded it. */
  messageId: string;
}

/**
 * The applicant's most recent row, read across the two keyed columns.
 *
 * Most recent, not first: a rejected applicant can apply again, and fourteen
 * ids in the police sheet already appear more than once. An edit belongs to
 * the application they last sent, and so does a write back to it.
 */
export async function findLatestSubmission(
  sheet: ApplicationSheet,
  discordId: string
): Promise<Submission | null> {
  const messageAt = columnIndex(sheet.messageColumn) - columnIndex(sheet.discordColumn);

  const response = await getSheets().spreadsheets.values.get({
    spreadsheetId: sheet.spreadsheetId,
    range: `${sheet.sheetName}!${sheet.discordColumn}:${sheet.messageColumn}`,
  });

  const rows = response.data.values || [];
  const wanted = discordId.trim();

  // From the bottom, stopping before the header row.
  for (let i = rows.length - 1; i >= 1; i--) {
    if (String(rows[i]?.[0] ?? '').trim() !== wanted) continue;
    return { row: i + 1, messageId: String(rows[i]?.[messageAt] ?? '').trim() };
  }

  return null;
}
