/* CDN caching for the reads every visitor asks for the same way.
 *
 * Every route here is `force-dynamic`, so without these headers each page load
 * and each poll lands on a function whose CPU is billed by the second. But the
 * data behind them is shared — everyone asking for "28 มิ.ย. - 5 ก.ค." wants
 * the same week — so the CDN can answer the repeats and the function can stay
 * asleep. That is the cheapest CPU there is: none.
 *
 * Two headers, answering two different readers. `Vercel-CDN-Cache-Control` is
 * read only by Vercel's CDN and overrides whatever the framework says about the
 * function itself, which is what makes a dynamic route cacheable there at all.
 * The standard header keeps the browser from holding a copy of its own, so a
 * refresh always asks the edge rather than the previous page.
 *
 * `?fresh=1` is the escape hatch. A page that has just written to the sheet
 * cannot wait the window out, so it asks for a bypass and is told `no-store`.
 *
 * Nothing carrying a session belongs on this list: `/roster/access`, `/logs/*`
 * and `/pending/*` answer differently per reader and must never be shared.
 */

const CDN_MAX_AGE = 30;
const CDN_STALE_WHILE_REVALIDATE = 300;

export function publicReadHeaders(fresh: boolean): Record<string, string> {
  if (fresh) {
    return {
      'Cache-Control': 'no-store',
      'Vercel-CDN-Cache-Control': 'no-store',
    };
  }

  return {
    'Cache-Control': `public, max-age=0, s-maxage=${CDN_MAX_AGE}, stale-while-revalidate=${CDN_STALE_WHILE_REVALIDATE}`,
    'Vercel-CDN-Cache-Control': `public, s-maxage=${CDN_MAX_AGE}, stale-while-revalidate=${CDN_STALE_WHILE_REVALIDATE}`,
  };
}

/** `?fresh=1` or `?fresh=true`, which is what a post-write reload sends. */
export function wantsFresh(value: unknown): boolean {
  const flag = String(value ?? '').toLowerCase();
  return flag === '1' || flag === 'true';
}
