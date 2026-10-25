/* One officer's whole picture, worked out on the server.

   The profile page used to fetch `/week-data` once per week — one function
   invocation and one full sheet parse per week, to read a single row out of
   each — then total the columns in the browser. On a season of forty weeks that
   is forty invocations to draw one page, and the totals are the same for
   everyone looking at that officer.

   This answers all of it in one request, from the week data the cache already
   holds, so a repeated look costs nothing at the sheet. It is deliberately not
   cached as its own key: it is cheap arithmetic over cached weeks, and deriving
   it on each call means a week's write (which drops `week_<name>`) is reflected
   immediately rather than after another TTL. */

import { findOfficerWeekData, isOfficerMatch } from '@/lib/format';
import { toWeekStatus, type WeekState } from '@/lib/weekStatus';
import type { Officer, WeekOfficerData } from '@/lib/types';
import { getOfficers, getWeekData, getWeekNames } from './sheets';

export interface OfficerWeek {
  week: string;
  state: WeekState;
  amount: number;
  /** The officer's row in that week, null when they are not on it. */
  entry: WeekOfficerData | null;
}

export interface OfficerSummary {
  /** Null when the roster has nobody by that name. */
  officer: Officer | null;
  totals: {
    cases: number;
    take2: number;
    interrogations: number;
  };
  /** In sheet order, oldest first — the order the week selector uses. */
  weeks: OfficerWeek[];
}

function count(value: string): number {
  return parseInt(value, 10) || 0;
}

export async function getOfficerSummary(name: string): Promise<OfficerSummary> {
  const [officers, weekNames] = await Promise.all([getOfficers(), getWeekNames()]);

  const officer =
    officers.find((o) => isOfficerMatch(o.fullName, name) || isOfficerMatch(o.name, name)) ?? null;

  if (!officer) {
    return { officer: null, totals: { cases: 0, take2: 0, interrogations: 0 }, weeks: [] };
  }

  /* One unreadable week must not take the page down with it: the officer's
     other weeks are still worth showing, and the state says which one failed
     rather than pretending the week is empty. */
  const settled = await Promise.allSettled(weekNames.map((week) => getWeekData(week)));

  const totals = { cases: 0, take2: 0, interrogations: 0 };
  const weeks: OfficerWeek[] = [];

  settled.forEach((result, i) => {
    const week = weekNames[i];

    if (result.status === 'rejected') {
      weeks.push({ week, state: 'error', amount: 0, entry: null });
      return;
    }

    const entry = findOfficerWeekData(result.value, name);
    if (!entry) {
      weeks.push({ week, state: 'unpaid-zero', amount: 0, entry: null });
      return;
    }

    totals.cases += count(entry.totalCases);
    totals.take2 += count(entry.take2);
    totals.interrogations += count(entry.interrogations);

    const amount = Number(entry.totalAmount) || 0;
    weeks.push({ week, ...toWeekStatus(entry.paid, amount), entry });
  });

  return { officer, totals, weeks };
}
