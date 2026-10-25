import { Elysia, t } from 'elysia';
import {
  getLatestWeekTop10,
  getOfficers,
  getWeekData,
  getWeekNames,
} from '@/server/services/sheets';
import { getOfficerSummary } from '@/server/services/officerSummary';
import { publicReadHeaders, wantsFresh } from '@/server/httpCache';

/* `fresh` is here so a page that has just written can ask for a bypass; it is
   declared on every query object below because Elysia drops params a schema
   does not name. */
const freshQuery = t.Optional(t.String());

/* Roster + weekly case data.
 *
 * All five are the same read for every visitor, which is what makes them worth
 * caching at the CDN — see httpCache.ts. The data itself is still cached in
 * memory and in the shared Data Cache behind them. */
export const rosterRoutes = new Elysia({ name: 'roster' })
  .get(
    '/officers',
    ({ query, set }) => {
      Object.assign(set.headers, publicReadHeaders(wantsFresh(query.fresh)));
      return getOfficers();
    },
    { query: t.Object({ fresh: freshQuery }) }
  )

  .get(
    '/weeks',
    ({ query, set }) => {
      Object.assign(set.headers, publicReadHeaders(wantsFresh(query.fresh)));
      return getWeekNames();
    },
    { query: t.Object({ fresh: freshQuery }) }
  )

  .get(
    '/week-data',
    ({ query, set }) => {
      Object.assign(set.headers, publicReadHeaders(wantsFresh(query.fresh)));
      return getWeekData(query.name);
    },
    {
      query: t.Object({ name: t.String({ minLength: 1 }), fresh: freshQuery }),
    }
  )

  .get(
    '/week-top10',
    ({ query, set }) => {
      Object.assign(set.headers, publicReadHeaders(wantsFresh(query.fresh)));
      return getLatestWeekTop10();
    },
    { query: t.Object({ fresh: freshQuery }) }
  )

  /* Everything the profile page draws for one officer: every week's state, the
     totals across them, and the row for each week it opens. One request instead
     of one per week — see services/officerSummary.ts. */
  .get(
    '/officer-summary',
    ({ query, set }) => {
      Object.assign(set.headers, publicReadHeaders(wantsFresh(query.fresh)));
      return getOfficerSummary(query.name);
    },
    { query: t.Object({ name: t.String({ minLength: 1 }), fresh: freshQuery }) }
  );

