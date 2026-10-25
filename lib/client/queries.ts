'use client';

/* Typed API calls. Every path, param and result here is inferred from the
   Elysia server — change a route and these stop compiling. */

import { client, unwrap } from './eden';
import type { CaseItem, ConductItem, FineItem, RuleItem, RulesType } from '@/lib/types';

/* /rules-data/:type serves four shapes behind one route, so Eden infers the
   union of all of them. The literal passed in determines which arm comes
   back, which only these wrappers know — hence the narrowing here. */
type RulesUnion = ConductItem[] | RuleItem[] | CaseItem[];

const narrow = <T extends RulesUnion>(p: Promise<RulesUnion>) => p as Promise<T>;

/** Filters the log endpoints accept; every field optional. */
export interface LogQueryInput {
  /** Comma-separated levels, e.g. 'ERROR,WARN'. */
  level?: string;
  context?: string;
  q?: string;
  limit?: number;
}

export const queries = {
  officers: () => unwrap(client.api.officers.get()),

  weeks: () => unwrap(client.api.weeks.get()),

  weekData: (name: string) => unwrap(client.api['week-data'].get({ query: { name } })),

  /** Every week's state, the totals, and each week's row — for one officer, in
      one request. The profile page used to ask for `/week-data` per week. */
  officerSummary: (name: string) =>
    unwrap(client.api['officer-summary'].get({ query: { name } })),

  weekTop10: () => unwrap(client.api['week-top10'].get()),

  scheduleConfig: () => unwrap(client.api['schedule-config'].get()),

  cases: () => narrow<CaseItem[]>(unwrap(client.api['rules-data']({ type: 'cases' }).get())),

  conduct: () =>
    narrow<ConductItem[]>(unwrap(client.api['rules-data']({ type: 'conduct' }).get())),

  fines: () => narrow<FineItem[]>(unwrap(client.api['rules-data']({ type: 'fines' }).get())),
};

export const mutations = {
  /** Ends the Discord session — only the server can clear an HttpOnly cookie. */
  discordLogout: () => unwrap(client.api.discord.logout.post()),

  markPaid: (
    input: { weekName: string; officerName: string; idempotencyKey?: string },
    signal?: AbortSignal
  ) => unwrap(client.api['mark-paid'].post(input, { fetch: { signal } })),

  /** Used to resolve a payment whose response was lost to a timeout. */
  paymentStatus: (key: string) =>
    unwrap(client.api['mark-paid'].status.get({ query: { key } })),

  register: (input: Parameters<typeof client.api.register.post>[0]) =>
    unwrap(client.api.register.post(input)),

  editRegister: (input: Parameters<(typeof client.api.register)['edit']['patch']>[0]) =>
    unwrap(client.api.register.edit.patch(input)),

  fetchRegister: (messageId: string, discordUserId?: string) =>
    unwrap(client.api.register.fetch({ messageId }).get({ query: { discordUserId } })),

  /** The signed-in account's own application, found without them having to
      know its Discord message id. 404 when the row predates that being kept. */
  myRegistration: () => unwrap(client.api.register.mine.get()),

  medical: (input: Parameters<typeof client.api.medical.post>[0]) =>
    unwrap(client.api.medical.post(input)),

  editMedical: (input: Parameters<(typeof client.api.medical)['edit']['patch']>[0]) =>
    unwrap(client.api.medical.edit.patch(input)),

  fetchMedical: (messageId: string, discordUserId?: string) =>
    unwrap(client.api.medical.fetch({ messageId }).get({ query: { discordUserId } })),

  /** The signed-in account's own medical application. 404 when there is none. */
  myMedical: () => unwrap(client.api.medical.mine.get()),

  /* ---- admin ----
     Every admin call is gated by a Discord allowlist rather than a PIN, so
     nothing below carries a credential: the signed session cookie rides along
     on its own and the server matches it against the list in the sheet. The
     approving proctor is read from that cookie too, not sent from here.

     Each page asks its access endpoint on load, because the cookie is HttpOnly
     and the page cannot read it for itself. */

  proctorAccess: () => unwrap(client.api.pending.access.get()),

  listPending: () => unwrap(client.api.pending.post()),

  approvePending: (row: number) => unwrap(client.api.pending.approve({ row }).post()),

  rejectPending: (row: number) => unwrap(client.api.pending.reject({ row }).post()),

  /** The one list the whole site's admin reads — /rostermanage, the
      rules/fines/conduct editors, the payment confirmation and /police. */
  adminAccess: () => unwrap(client.api.roster.access.get()),

  namePD: () => unwrap(client.api.roster.namepd.post()),

  outDC: () => unwrap(client.api.roster.outdc.post()),

  setRosterStatus: (row: number, status: string) =>
    unwrap(client.api.roster.status({ row }).put({ status })),

  /** Ticked several people in the console and picked one status for all of them. */
  setRosterStatusBulk: (rows: number[], status: string) =>
    unwrap(client.api.roster['status-bulk'].put({ rows, status })),

  moveOut: (row: number, reason: string) =>
    unwrap(client.api.roster['move-out']({ row }).post({ reason })),

  /** Ticked several people and moved the lot out; each keeps their own reason. */
  moveOutBulk: (rows: number[]) => unwrap(client.api.roster['move-out-bulk'].post({ rows })),

  /* ---- log viewer (/police/logs) ----
     Reads, but they live here with the other admin calls because they carry the
     same session cookie and are refused without it. */

  webLogs: (input: LogQueryInput = {}) => unwrap(client.api.logs.web.get({ query: input })),

  /** The bot's important lines, kept in the sheet for 30 days. */
  botLogs: (input: LogQueryInput = {}) => unwrap(client.api.logs.bot.get({ query: input })),

  /** The bot's full trail for the last 24h, straight from its memory. */
  botLiveLogs: (input: LogQueryInput = {}) =>
    unwrap(client.api.logs.bot.live.get({ query: input })),

  /* ---- conduct/rules/fines admin CRUD ---- */

  addRuleItem: (type: RulesType, data: Record<string, string>) =>
    unwrap(client.api['rules-data']({ type }).post(data)),

  updateRuleItem: (type: RulesType, id: string, data: Record<string, string>) =>
    unwrap(client.api['rules-data']({ type })({ id }).put(data)),

  deleteRuleItem: (type: RulesType, id: string) =>
    unwrap(client.api['rules-data']({ type })({ id }).delete()),
};
