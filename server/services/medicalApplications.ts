/* Medical applications — the `Medical` tab, columns A–K, row 1 headers:
   A=timestamp B=discordId C=discordName D=icName E=ocAge F=timeStart
   G=timeEnd H=experience I=reason J=status K=messageId

   The same shape as the police sheet, and for the same reason: column K is
   what lets an applicant edit what they sent without having kept the Discord
   message id. There is no console to review these in yet — the status column
   is written on submit and read by nothing, so that a review page can be added
   later without every column having to move along. */

import { config } from '@/server/config';
import { getSheets } from './sheetsApi';
import { findLatestSubmission, type ApplicationSheet } from './applicationSheet';

const STATUS_PENDING = 'รอตรวจ';

const MEDICAL_SHEET: ApplicationSheet = {
  get spreadsheetId() {
    return config.PENDING_SPREADSHEET_ID;
  },
  get sheetName() {
    return config.MEDICAL_SHEET_NAME;
  },
  discordColumn: 'B',
  messageColumn: 'K',
};

export interface MedicalApplication {
  discordId: string;
  discordName: string;
  icName: string;
  ocAge: number;
  timeStart: string;
  timeEnd: string;
  medicalExperience: string;
  joinReason: string;
}

export async function addMedicalApplication(
  data: MedicalApplication & { messageId?: string }
): Promise<void> {
  const timestamp = new Date().toLocaleString('th-TH', { timeZone: 'Asia/Bangkok' });

  await getSheets().spreadsheets.values.append({
    spreadsheetId: config.PENDING_SPREADSHEET_ID,
    range: `${config.MEDICAL_SHEET_NAME}!A:K`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        [
          timestamp,
          data.discordId,
          data.discordName || '',
          data.icName,
          String(data.ocAge),
          data.timeStart,
          data.timeEnd,
          data.medicalExperience,
          data.joinReason,
          STATUS_PENDING,
          data.messageId ?? '',
        ],
      ],
    },
  });
}

/** The Discord message behind this account's latest medical application. */
export async function findMedicalMessageId(discordId: string): Promise<string | null> {
  const found = await findLatestSubmission(MEDICAL_SHEET, discordId);
  return found?.messageId || null;
}

/** Keeps the sheet in step with an edit — columns D–I, the answers themselves. */
export async function updateMedicalApplication(
  discordId: string,
  data: Omit<MedicalApplication, 'discordId' | 'discordName'>
): Promise<void> {
  const found = await findLatestSubmission(MEDICAL_SHEET, discordId);
  if (!found) return;

  await getSheets().spreadsheets.values.update({
    spreadsheetId: config.PENDING_SPREADSHEET_ID,
    range: `${config.MEDICAL_SHEET_NAME}!D${found.row}:I${found.row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: {
      values: [
        [
          data.icName,
          String(data.ocAge),
          data.timeStart,
          data.timeEnd,
          data.medicalExperience,
          data.joinReason,
        ],
      ],
    },
  });
}
