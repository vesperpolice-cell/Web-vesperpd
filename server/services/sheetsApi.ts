/* The Google Sheets calls this app makes, and the token that authorises them.

   This used to be `googleapis`: a generated client for every Google API, of
   which the app used eight methods on one resource. It was the largest thing in
   the deployment by a wide margin — tens of megabytes of API descriptors that
   had to be resolved on every cold start, for routes whose own work is a couple
   of HTTP requests.

   What it actually did was sign a JWT with the service account's key, exchange
   that for an access token, and call REST endpoints. That is the whole of it,
   and it is forty lines of node:crypto, so the calls are made directly and the
   dependency is gone.

   The shape is deliberately the same as before — `getSheets().spreadsheets
   .values.get({ spreadsheetId, range })` returning `{ data: { values } }` — so
   the services that use it did not have to change. Only the methods that are
   actually used are implemented. */

import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { config } from '@/server/config';

const SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const API = 'https://sheets.googleapis.com/v4/spreadsheets';

/** Renewed this long before it expires, so a request cannot outlive the token. */
const TOKEN_SKEW_SECONDS = 60;

export type CellValue = string | number | boolean | null;
export type ValueInputOption = 'RAW' | 'USER_ENTERED';
export type ValueRenderOption = 'FORMATTED_VALUE' | 'UNFORMATTED_VALUE' | 'FORMULA';

export interface SheetProperties {
  properties?: { title?: string; sheetId?: number };
}

interface ServiceAccount {
  client_email: string;
  private_key: string;
}

/* ---------- credentials ---------- */

let account: ServiceAccount | null = null;

/* The service account arrives one of two ways: GOOGLE_JSON_KEY carrying the
   whole JSON on a single line, or GOOGLE_APPLICATION_CREDENTIALS carrying a
   path to that JSON on disk. The file form exists because hosting panels mangle
   a 2 KB value set through their own UI: DirectAdmin writes it into .htaccess
   as a SetEnv line, where the value stops at the first space, and the app then
   reports "not valid JSON". */
function readCredentials(): ServiceAccount {
  if (account) return account;

  const inline = process.env.GOOGLE_JSON_KEY;
  const path = process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (!inline && !path) {
    throw new Error(
      'Set GOOGLE_JSON_KEY to the service-account JSON, or GOOGLE_APPLICATION_CREDENTIALS to its path'
    );
  }

  let parsed: Partial<ServiceAccount>;
  try {
    parsed = JSON.parse(inline ?? readFileSync(path as string, 'utf8'));
  } catch {
    throw new Error('GOOGLE_JSON_KEY is not valid JSON');
  }

  const email = parsed.client_email;
  const key = parsed.private_key;

  if (!email || !key) {
    throw new Error('The service account JSON is missing client_email or private_key');
  }

  /* A key pasted through an environment variable arrives with the newlines
     escaped, and an RSA key without them cannot be parsed. */
  account = { client_email: email, private_key: key.replace(/\\n/g, '\n') };
  return account;
}

/* ---------- access token ---------- */

let token: { value: string; expiresAt: number } | null = null;

function base64Url(input: string | Buffer): string {
  return Buffer.from(input)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

/* One token per container, reused until it is nearly expired: the token
   endpoint is the slowest part of the first Sheets call after a cold start. */
async function accessToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt) return token.value;

  const { client_email, private_key } = readCredentials();

  const issuedAt = Math.floor(Date.now() / 1000);
  const claims = {
    iss: client_email,
    scope: SCOPE,
    aud: TOKEN_URL,
    iat: issuedAt,
    exp: issuedAt + 3600,
  };

  const signingInput =
    `${base64Url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.` +
    base64Url(JSON.stringify(claims));
  const signature = createSign('RSA-SHA256').update(signingInput).sign(private_key);

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${signingInput}.${base64Url(signature)}`,
    }),
    cache: 'no-store',
    signal: AbortSignal.timeout(config.REQUEST_TIMEOUT),
  });

  const body = (await res.json().catch(() => null)) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  } | null;

  if (!res.ok || !body?.access_token) {
    const reason = body?.error_description || body?.error || `HTTP ${res.status}`;
    throw new Error(`Google refused the service account: ${reason}`);
  }

  const lifetime = Math.max((body.expires_in ?? 3600) - TOKEN_SKEW_SECONDS, 30);
  token = { value: body.access_token, expiresAt: Date.now() + lifetime * 1000 };
  return token.value;
}

/* ---------- requests ---------- */

/** A1 ranges carry spaces, Thai, full stops and single quotes — the last of
    which is what a week name needs, and the one that has to be escaped. */
function encodePath(value: string): string {
  return encodeURIComponent(value).replace(/'/g, '%27');
}

function sheetsError(status: number, body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    if (parsed.error?.message) return `Sheets API ${status}: ${parsed.error.message}`;
  } catch {
    // Not the JSON error envelope; the status alone will have to do.
  }
  return `Sheets API ${status}`;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT';
  path: string;
  query?: Record<string, string | string[] | undefined>;
  body?: unknown;
}

async function request<T>({ method = 'GET', path, query, body }: RequestOptions): Promise<T> {
  const url = new URL(`${API}${path}`);

  for (const [key, value] of Object.entries(query ?? {})) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((item) => url.searchParams.append(key, item));
    else url.searchParams.set(key, value);
  }

  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${await accessToken()}`,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    // Not the Data Cache's business: services/cache.ts decides what may be
    // stale, and a write must never be answered from a cache.
    cache: 'no-store',
    signal: AbortSignal.timeout(config.REQUEST_TIMEOUT),
  });

  const text = await res.text();
  if (!res.ok) throw new Error(sheetsError(res.status, text));

  return (text ? JSON.parse(text) : {}) as T;
}

/* ---------- the client ---------- */

interface ValuesResponse {
  values?: CellValue[][];
}

interface BatchGetResponse {
  valueRanges?: ValuesResponse[];
}

interface SpreadsheetMeta {
  sheets?: SheetProperties[];
}

interface WriteParams {
  spreadsheetId: string;
  range: string;
  valueInputOption?: ValueInputOption;
  requestBody: { values: CellValue[][] };
}

export interface SheetsClient {
  spreadsheets: {
    /** Tabs and their ids; `fields` keeps the answer to just that. */
    get(params: { spreadsheetId: string }): Promise<{ data: SpreadsheetMeta }>;
    /** Structural edits: addSheet, deleteDimension. */
    batchUpdate(params: {
      spreadsheetId: string;
      requestBody: { requests: unknown[] };
    }): Promise<{ data: unknown }>;
    values: {
      get(params: {
        spreadsheetId: string;
        range: string;
        valueRenderOption?: ValueRenderOption;
      }): Promise<{ data: ValuesResponse }>;
      batchGet(params: {
        spreadsheetId: string;
        ranges: string[];
      }): Promise<{ data: BatchGetResponse }>;
      update(params: WriteParams): Promise<{ data: ValuesResponse }>;
      append(params: WriteParams): Promise<{ data: ValuesResponse }>;
      batchUpdate(params: {
        spreadsheetId: string;
        requestBody: {
          valueInputOption?: ValueInputOption;
          data: { range: string; values: CellValue[][] }[];
        };
      }): Promise<{ data: unknown }>;
      batchClear(params: {
        spreadsheetId: string;
        requestBody: { ranges: string[] };
      }): Promise<{ data: unknown }>;
    };
  };
}

/* Every caller reads `response.data`, exactly as it did with googleapis, so the
   parsed body is wrapped here rather than at each of the dozen call sites. */
async function call<T>(options: RequestOptions): Promise<{ data: T }> {
  return { data: await request<T>(options) };
}

const client: SheetsClient = {
  spreadsheets: {
    get: ({ spreadsheetId }) =>
      call<SpreadsheetMeta>({
        path: `/${encodeURIComponent(spreadsheetId)}`,
        query: { fields: 'sheets.properties' },
      }),

    batchUpdate: ({ spreadsheetId, requestBody }) =>
      call<unknown>({
        method: 'POST',
        path: `/${encodeURIComponent(spreadsheetId)}:batchUpdate`,
        body: requestBody,
      }),

    values: {
      get: ({ spreadsheetId, range, valueRenderOption }) =>
        call<ValuesResponse>({
          path: `/${encodeURIComponent(spreadsheetId)}/values/${encodePath(range)}`,
          query: { valueRenderOption },
        }),

      batchGet: ({ spreadsheetId, ranges }) =>
        call<BatchGetResponse>({
          path: `/${encodeURIComponent(spreadsheetId)}/values:batchGet`,
          query: { ranges },
        }),

      update: ({ spreadsheetId, range, valueInputOption, requestBody }) =>
        call<ValuesResponse>({
          method: 'PUT',
          path: `/${encodeURIComponent(spreadsheetId)}/values/${encodePath(range)}`,
          query: { valueInputOption: valueInputOption ?? 'USER_ENTERED' },
          body: { range, values: requestBody.values },
        }),

      append: ({ spreadsheetId, range, valueInputOption, requestBody }) =>
        call<ValuesResponse>({
          method: 'POST',
          path: `/${encodeURIComponent(spreadsheetId)}/values/${encodePath(range)}:append`,
          query: { valueInputOption: valueInputOption ?? 'USER_ENTERED' },
          body: { values: requestBody.values },
        }),

      batchUpdate: ({ spreadsheetId, requestBody }) =>
        call<unknown>({
          method: 'POST',
          path: `/${encodeURIComponent(spreadsheetId)}/values:batchUpdate`,
          body: {
            valueInputOption: requestBody.valueInputOption ?? 'USER_ENTERED',
            data: requestBody.data,
          },
        }),

      batchClear: ({ spreadsheetId, requestBody }) =>
        call<unknown>({
          method: 'POST',
          path: `/${encodeURIComponent(spreadsheetId)}/values:batchClear`,
          body: requestBody,
        }),
    },
  },
};

export function getSheets(): SheetsClient {
  return client;
}
