/* What a week's payment state means, in one place.

   This used to live beside the profile components because only the browser
   worked it out — it fetched every week and compared each row's paid cell
   itself. `/officer-summary` answers the same question now, so the server needs
   the same rule, and two copies of "which strings mean paid" is exactly the
   kind of thing that drifts.

   `amount` is the week's charge, not what is left to pay: a paid week still
   reports its amount, and the caller decides what to show. */

export type WeekState = 'loading' | 'paid' | 'owed' | 'unpaid-zero' | 'error';

export interface WeekStatus {
  state: WeekState;
  amount: number;
}

/** The sheet is edited by hand, so "paid" arrives spelled several ways. */
const PAID_VALUES = ['yes', 'จ่ายแล้ว', 'true', '1'];

export function isPaidValue(paid: string | undefined): boolean {
  return PAID_VALUES.includes(String(paid || '').toLowerCase());
}

export function toWeekStatus(paid: string | undefined, amount: number): WeekStatus {
  if (isPaidValue(paid)) return { state: 'paid', amount };
  return { state: amount > 0 ? 'owed' : 'unpaid-zero', amount };
}
