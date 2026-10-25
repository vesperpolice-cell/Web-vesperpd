/* Sheets data layer — ported from server/services/sheetsService.js */

import { config } from '@/server/config';
import { cached, invalidate } from './cache';
import { getSheets } from './sheetsApi';
import { parseCSV, mapOfficers, mapWeekData, mapWeekNames } from './csv';
import type {
  CaseItem,
  ConductItem,
  FineItem,
  Officer,
  RuleItem,
  RulesType,
  WeekData,
  WeekTop10,
} from '@/lib/types';

function normalizeOfficerName(name: string): string {
  return String(name || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** Google's GViz CSV export — used for the large read-only sheets.
 *
 * No cache-busting `_t=` any more: every read goes through services/cache.ts,
 * which decides how stale an answer may be and can be dropped by tag when the
 * sheet changes. A timestamp in the URL would make each read a different
 * resource, which is exactly what stops Google's own edge from helping. */
async function fetchGvizCSV(sheetId: string, sheetName: string): Promise<string> {
  const url =
    `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq` +
    `?tqx=out:csv&tq&sheet=${encodeURIComponent(sheetName)}`;

  const res = await fetch(url, {
    cache: 'no-store',
    signal: AbortSignal.timeout(config.REQUEST_TIMEOUT),
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} for sheet ${sheetName}`);
  }

  return res.text();
}

function sheetNameFor(type: RulesType): string {
  if (type === 'conduct') return config.CONDUCT_SHEET_NAME;
  if (type === 'rules') return config.RULES_SHEET_NAME;
  return config.FINES_SHEET_NAME;
}

export async function getOfficers(): Promise<Officer[]> {
  return cached('officers', async () => {
    const csv = await fetchGvizCSV(config.SHEET_ID, config.SHEET_NAME);
    return mapOfficers(parseCSV(csv));
  });
}

export async function getWeekNames(): Promise<string[]> {
  return cached('weekNames', async () => {
    const csv = await fetchGvizCSV(config.CASES_SHEET_ID, config.CASES_SHEET_NAME);
    return mapWeekNames(parseCSV(csv));
  });
}

export async function getWeekData(weekName: string): Promise<WeekData> {
  return cached(`week_${weekName}`, async () => {
    const csv = await fetchGvizCSV(config.CASES_SHEET_ID, weekName);
    return mapWeekData(parseCSV(csv));
  });
}

export async function getLatestWeekTop10(): Promise<WeekTop10> {
  return cached('week_top10', async () => {
    const weeks = await getWeekNames();
    const realWeeks = weeks.filter((w) => w.toLowerCase() !== 'test');
    if (realWeeks.length === 0) return { weekName: '', top10: [] };

    const latestWeek = realWeeks[realWeeks.length - 1];
    const weekData = await getWeekData(latestWeek);

    const top10 = Object.values(weekData)
      .sort((a, b) => (parseFloat(b.totalCases) || 0) - (parseFloat(a.totalCases) || 0))
      .slice(0, 10)
      .map((o) => ({
        name: o.name,
        rank: o.rank,
        totalCases: parseFloat(o.totalCases) || 0,
      }));

    return { weekName: latestWeek, top10 };
  });
}

/* ==================== Rules / Conduct / Fines ==================== */

/** Sheet layout: data starts at row 3; C=id, D=title|category, E=text, F=amount, G=time */
export async function getRulesData(type: 'conduct'): Promise<ConductItem[]>;
export async function getRulesData(type: 'rules'): Promise<RuleItem[]>;
export async function getRulesData(type: 'fines'): Promise<FineItem[]>;
export async function getRulesData(
  type: RulesType
): Promise<ConductItem[] | RuleItem[] | FineItem[]>;
export async function getRulesData(
  type: RulesType
): Promise<ConductItem[] | RuleItem[] | FineItem[]> {
  return cached(`rules_${type}`, async () => {
    const sheets = getSheets();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: config.RULES_SHEET_ID,
      range: `${sheetNameFor(type)}!C:G`,
    });

    const rows = (response.data.values || []).slice(2);
    const cell = (row: unknown[], i: number) => (row[i] ? String(row[i]).trim() : '');

    const items = [];
    for (const row of rows) {
      const id = cell(row, 0);
      if (!id) continue;

      if (type === 'conduct') {
        items.push({ id, title: cell(row, 1), text: cell(row, 2) } satisfies ConductItem);
      } else if (type === 'rules') {
        items.push({ id, category: cell(row, 1), text: cell(row, 2) } satisfies RuleItem);
      } else {
        items.push({
          id,
          category: cell(row, 1),
          text: cell(row, 2),
          amount: cell(row, 3),
          time: cell(row, 4),
        } satisfies FineItem);
      }
    }

    return items as ConductItem[] | RuleItem[] | FineItem[];
  });
}

/** Separate sheet: A=id, B=title, C=description (HTML), D=video_url */
export async function getCases(): Promise<CaseItem[]> {
  return cached('cases_data', async () => {
    const sheets = getSheets();
    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: config.CASES_DATA_SHEET_ID,
      range: 'Cases!A:D',
    });

    const rows = (response.data.values || []).slice(1);
    const cell = (row: unknown[], i: number) => (row[i] ? String(row[i]).trim() : '');

    return rows
      .filter((row) => cell(row, 0))
      .map((row) => ({
        id: cell(row, 0),
        title: cell(row, 1),
        description: cell(row, 2),
        video_url: cell(row, 3),
      }));
  });
}

function buildRowData(type: RulesType, data: Record<string, string>): string[] {
  if (type === 'conduct') return [data.id, data.title || '', data.text || ''];
  if (type === 'rules') return [data.id, data.category || '', data.text || ''];
  return [data.id, data.category || '', data.text || '', data.amount || '', data.time || ''];
}

async function findRuleRow(type: RulesType, id: string): Promise<number> {
  const sheets = getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.RULES_SHEET_ID,
    range: `${sheetNameFor(type)}!C:G`,
  });

  const rows = response.data.values || [];
  for (let i = 2; i < rows.length; i++) {
    const value = rows[i]?.[0] ? String(rows[i][0]).trim() : '';
    if (value === id) return i + 1;
  }
  return -1;
}

export async function addRule(type: RulesType, data: Record<string, string>) {
  const sheets = getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.RULES_SHEET_ID,
    range: `${sheetNameFor(type)}!C:G`,
  });

  const rows = response.data.values || [];
  let nextRow = 3;
  for (let i = 2; i < rows.length; i++) {
    if (!rows[i]?.[0] || String(rows[i][0]).trim() === '') {
      nextRow = i + 1;
      break;
    }
    nextRow = i + 2;
  }

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.RULES_SHEET_ID,
    range: `${sheetNameFor(type)}!C${nextRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [buildRowData(type, data)] },
  });

  invalidate(`rules_${type}`);
  return { id: data.id, row: nextRow };
}

export async function updateRule(type: RulesType, id: string, data: Record<string, string>) {
  const row = await findRuleRow(type, id);
  if (row === -1) throw new Error('ไม่พบข้อมูลที่ต้องการแก้ไข');

  await getSheets().spreadsheets.values.update({
    spreadsheetId: config.RULES_SHEET_ID,
    range: `${sheetNameFor(type)}!C${row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [buildRowData(type, data)] },
  });

  invalidate(`rules_${type}`);
  return { id, row };
}

export async function deleteRule(type: RulesType, id: string) {
  const row = await findRuleRow(type, id);
  if (row === -1) throw new Error('ไม่พบข้อมูลที่ต้องการลบ');

  await getSheets().spreadsheets.values.update({
    spreadsheetId: config.RULES_SHEET_ID,
    range: `${sheetNameFor(type)}!C${row}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [['', '', '', '', '']] },
  });

  invalidate(`rules_${type}`);
  return { id, row };
}

/* ==================== Payments ==================== */

export async function markOfficerAsPaid(weekName: string, officerName: string) {
  const sheets = getSheets();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: config.CASES_SHEET_ID,
    // Week names carry spaces and full stops ("28 มิ.ย. - 5 ก.ค."), which A1
    // notation only accepts inside single quotes — as the write below does.
    range: `'${weekName}'!A:A`,
  });

  const rows = response.data.values;
  if (!rows) throw new Error('ไม่พบข้อมูลในชีต');

  const searchName = normalizeOfficerName(officerName);
  if (!searchName) throw new Error('ไม่พบชื่อเจ้าหน้าที่ในชีตสัปดาห์นี้');

  const DATA_START_ROW_INDEX = 3;
  const exact: number[] = [];
  const fuzzy: number[] = [];

  for (let i = DATA_START_ROW_INDEX; i < rows.length; i++) {
    // Cells read back as strings, numbers or booleans; the name column may be
    // either a text cell or a number someone typed into it.
    const cellValue = normalizeOfficerName(String(rows[i]?.[0] ?? ''));
    if (!cellValue) continue;

    if (cellValue === searchName) exact.push(i + 1);
    else if (cellValue.includes(searchName) || searchName.includes(cellValue)) fuzzy.push(i + 1);
  }

  // Exact matches win; an ambiguous match is refused rather than risking the wrong row.
  let rowIndex = -1;
  if (exact.length === 1) rowIndex = exact[0];
  else if (exact.length > 1)
    throw new Error(`พบชื่อเจ้าหน้าที่ซ้ำกัน ${exact.length} แถว กรุณาตรวจสอบข้อมูล`);
  else if (fuzzy.length === 1) rowIndex = fuzzy[0];
  else if (fuzzy.length > 1)
    throw new Error(`พบชื่อเจ้าหน้าที่ซ้ำกัน ${fuzzy.length} แถว กรุณาตรวจสอบข้อมูล`);

  if (rowIndex === -1) throw new Error('ไม่พบชื่อเจ้าหน้าที่ในชีตสัปดาห์นี้');

  await sheets.spreadsheets.values.update({
    spreadsheetId: config.CASES_SHEET_ID,
    range: `'${weekName}'!X${rowIndex}:X${rowIndex}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[true]] },
  });

  invalidate(`week_${weekName}`);
  return { rowIndex };
}

