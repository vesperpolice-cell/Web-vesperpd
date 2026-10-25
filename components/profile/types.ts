/* Re-exported so the profile components keep importing from here. The
   definitions moved to lib/weekStatus.ts when the server started answering the
   same question for /officer-summary. */

export type { WeekState, WeekStatus } from '@/lib/weekStatus';
export { isPaidValue, toWeekStatus } from '@/lib/weekStatus';
