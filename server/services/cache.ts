/* Two caches, because there are two different problems here.

   The first is the one the v2 file cache was for: a sheet read is a network
   round trip plus a CSV parse, and both cost more than the answer is worth when
   the same page asks twice in a minute. That one lives in this instance's
   memory, keyed by name, and dies with the container.

   The second is the one the in-memory cache cannot answer. With traffic this
   sparse, most requests arrive on an instance that has never seen them, so a
   cold container starts from nothing even though the same sheet was parsed a
   minute ago somewhere else. Next's Data Cache is shared by every instance in
   the region, so it hands that work back — and a parse a shared entry skips is
   Fluid Active CPU the deployment never spends.

   Shared entries carry a `sheet:<key>` tag, so a write can drop one by tag
   rather than leaving the next reader to wait the TTL out. */

import { revalidateTag, unstable_cache } from 'next/cache';
import { config } from '@/server/config';

interface Entry {
  data: unknown;
  timestamp: number;
}

const store = new Map<string, Entry>();
const MAX_KEYS = 100;

/** Seconds a shared entry stays fresh. Long enough that a page load and the
    requests following it share one read, short enough that a sheet edited by
    hand shows up on its own. */
const SHARED_TTL = 60;

const tagFor = (key: string) => `sheet:${key}`;

/* Next 16 asks for a cacheLife profile on the second argument; Next 15's types
   do not take one at all. Cast rather than call either way directly, so this
   file builds against both majors. */
const purgeTag = revalidateTag as (tag: string, profile?: string) => void;

interface Reader {
  run: () => Promise<unknown>;
  /* Set when the callback itself threw, as opposed to the cache around it. */
  failedInsideCompute: boolean;
}

/* One reader per key: `unstable_cache` folds the callback's source into its
   cache key, and the reader for a given key is always the same function. */
const readers = new Map<string, Reader>();

/* Latched if the Data Cache turns out to be unusable at runtime. The instance
   then reads directly for the rest of its life rather than paying the failed
   attempt on every request. */
let sharedUnavailable = false;

function readerFor<T>(key: string, compute: () => Promise<T>): Reader {
  const existing = readers.get(key);
  if (existing) return existing;

  const reader: Reader = {
    failedInsideCompute: false,
    run: async () => {
      try {
        return await compute();
      } catch (err) {
        reader.failedInsideCompute = true;
        throw err;
      }
    },
  };

  reader.run = unstable_cache(reader.run, ['sheet', key], {
    revalidate: SHARED_TTL,
    tags: [tagFor(key)],
  });

  readers.set(key, reader);
  return reader;
}

async function readShared<T>(key: string, compute: () => Promise<T>): Promise<T> {
  const reader = readerFor(key, compute);

  try {
    return (await reader.run()) as T;
  } catch (err) {
    /* A failure from the sheet itself is the caller's to report, exactly as it
       was before there was a shared cache in the way. */
    if (reader.failedInsideCompute) {
      reader.failedInsideCompute = false;
      throw err;
    }

    /* Anything else came from the cache layer. A cache that is unavailable must
       not take the API down with it, so this instance drops to reading direct. */
    sharedUnavailable = true;
    return compute();
  }
}

function getCached<T>(key: string): T | null {
  const entry = store.get(key);
  if (entry && Date.now() - entry.timestamp < config.CACHE_TTL) {
    return entry.data as T;
  }
  return null;
}

function setCached(key: string, data: unknown): void {
  if (store.size > MAX_KEYS) store.clear();
  store.set(key, { data, timestamp: Date.now() });
}

export function invalidate(key: string): void {
  store.delete(key);

  try {
    purgeTag(tagFor(key), 'max');
  } catch {
    /* Outside a request there is no tag store to purge — from a script, say.
       The TTL is the fallback there. */
  }
}

/**
 * Fetch through both caches: the value this instance already holds, else the
 * one a shared entry holds, else compute it.
 *
 * `shared: false` is for data whose staleness is a policy decision rather than
 * a cost one — the permission allowlists, where a shorter window is the point:
 * an id removed from the sheet has to stop working within seconds.
 */
export async function cached<T>(
  key: string,
  compute: () => Promise<T>,
  { shared = true }: { shared?: boolean } = {}
): Promise<T> {
  const hit = getCached<T>(key);
  if (hit !== null) return hit;

  const value = shared && !sharedUnavailable ? await readShared(key, compute) : await compute();

  setCached(key, value);
  return value;
}
