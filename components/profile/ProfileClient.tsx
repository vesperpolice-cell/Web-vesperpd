'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { queries, mutations } from '@/lib/client/queries';
import { useAdminGate } from '@/lib/client/adminAccess';
import { useDiscordAuth } from '@/lib/client/useDiscordAuth';
import { SiteFooter } from '@/components/SiteHeader';
import { AdminGateModal, ConfirmModal, CopyButton } from '@/components/ui/Modal';
import { DiscordStatus } from '@/components/ui/DiscordStatus';
import { useToast } from '@/components/ui/Toast';
import { Loading } from '@/components/ui/States';
import { WeekSelector } from './WeekSelector';
import { DutyTable, WeekStats } from './WeekStats';
import type { WeekStatus } from './types';
import type { Officer } from '@/lib/types';

const PAYMENT_TIMEOUT_MS = 10_000;

interface Totals {
  cases: number;
  take2: number;
  interrogations: number;
}

/** Whatever `/officer-summary` answers — typed from the server, not restated. */
type Summary = Awaited<ReturnType<typeof queries.officerSummary>>;

export function ProfileClient() {
  const searchParams = useSearchParams();
  const officerName = searchParams.get('name') ?? '';
  const toast = useToast();

  const [officer, setOfficer] = useState<Officer | null>(null);
  const [weeks, setWeeks] = useState<string[]>([]);
  const [statuses, setStatuses] = useState<Record<string, WeekStatus>>({});
  const [totals, setTotals] = useState<Totals | null>(null);

  const [activeWeek, setActiveWeek] = useState<string | null>(null);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  const gate = useAdminGate();
  /* The officer rides along in the OAuth state so the login comes back to this
     profile rather than to a page with nobody on it. */
  const auth = useDiscordAuth(`profile:${encodeURIComponent(officerName)}`, true);
  const [gateOpen, setGateOpen] = useState(false);

  const [confirming, setConfirming] = useState(false);
  const [paying, setPaying] = useState(false);

  /* Weeks paid during this session. Google's GViz export is CDN-cached and
     lags behind writes, so a re-fetch can still report them unpaid — these
     override whatever comes back. */
  const paidThisSession = useRef<Set<string>>(new Set());

  /* The last answer from `/officer-summary`, kept whole: the week list, the
     totals and the row behind whichever week is open all come from it, so the
     page never fetches a week on its own. */
  const [summary, setSummary] = useState<Summary | null>(null);

  /* Committed in one go: setting state per week would re-render the page as
     many times as there are weeks. */
  const applySummary = useCallback((next: Summary) => {
    setSummary(next);

    if (!next.officer) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    setOfficer(next.officer);
    setWeeks(next.weeks.map((w) => w.week));
    setTotals(next.totals);
    setStatuses(
      Object.fromEntries(
        next.weeks.map((w) =>
          paidThisSession.current.has(w.week)
            ? [w.week, { state: 'paid' as const, amount: 0 }]
            : [w.week, { state: w.state, amount: w.amount }]
        )
      )
    );
    setLoading(false);
  }, []);

  /* ---------- load ---------- */

  /* One request for the whole page: every week's state, the totals across them
     and the row for each week. `silent` is for the background poll, where the
     page must not drop back to a spinner and must keep what it has if the
     request fails. */
  const loadSummary = useCallback(
    async (silent = false) => {
      if (!officerName) {
        setNotFound(true);
        setLoading(false);
        return;
      }

      try {
        const next = await queries.officerSummary(officerName);
        applySummary(next);
        if (next.officer) setActiveWeek((prev) => prev ?? next.weeks[0]?.week ?? null);
      } catch {
        // The first load has nothing to fall back to; a refresh does.
        if (!silent) {
          setNotFound(true);
          setLoading(false);
        }
      }
    },
    [officerName, applySummary]
  );

  useEffect(() => {
    void loadSummary();
  }, [loadSummary]);


  /* Unpaid weeks with a balance start checked, matching v2. */
  useEffect(() => {
    const owed = Object.entries(statuses)
      .filter(([week, s]) => s.state === 'owed' && week.toLowerCase() !== 'test')
      .map(([week]) => week);

    if (owed.length > 0) setSelected(new Set(owed));
  }, [statuses]);

  /* ---------- active week ---------- */

  /* Switching weeks reads the row that came with the summary — there is no
     per-week request left to make, so the card changes on the same tick as the
     selector instead of showing a spinner. */
  const weekData = useMemo(() => {
    const entry = summary?.weeks.find((w) => w.week === activeWeek)?.entry ?? null;
    if (entry && activeWeek && paidThisSession.current.has(activeWeek)) {
      return { ...entry, paid: 'จ่ายแล้ว' };
    }
    return entry;
  }, [summary, activeWeek]);

  /* Poll the summary so a payment made elsewhere shows on the card and in the
     week list at once.

     Skipped while the tab is in the background — a refresh is a Sheets round
     trip whose CPU time is billed, and nobody is reading a hidden card. The
     visibility handler does the one refresh that was missed as soon as the
     reader comes back. */
  useEffect(() => {
    const refresh = () => {
      if (document.visibilityState === 'visible') void loadSummary(true);
    };

    const timer = setInterval(refresh, 60_000);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [loadSummary]);

  /* ---------- payment ---------- */

  const selectedWeeks = useMemo(
    () => [...selected].filter((w) => statuses[w]?.state === 'owed'),
    [selected, statuses]
  );

  const selectedTotal = useMemo(
    () => selectedWeeks.reduce((sum, w) => sum + (statuses[w]?.amount ?? 0), 0),
    [selectedWeeks, statuses]
  );

  async function runPayment() {
    setPaying(true);

    let succeeded = 0;
    let failed = 0;
    let unknown = 0;
    const errors: string[] = [];

    await Promise.all(
      selectedWeeks.map(async (week) => {
        const idempotencyKey = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), PAYMENT_TIMEOUT_MS);

        /* The request may be lost after the server already wrote the row, so
           an uncertain outcome is re-checked by idempotency key rather than
           reported as a failure. */
        const resolveUncertain = async () => {
          try {
            const status = await mutations.paymentStatus(idempotencyKey);
            if (status.success) {
              succeeded++;
              paidThisSession.current.add(week);
              return;
            }
          } catch {
            /* status unavailable */
          }
          unknown++;
          errors.push(`${week}: ไม่ทราบผลการจ่าย (อาจสำเร็จแล้ว) กรุณารีเฟรชเพื่อตรวจสอบ`);
        };

        try {
          const result = await mutations.markPaid(
            { weekName: week, officerName, idempotencyKey },
            controller.signal
          );

          if (result.success) {
            succeeded++;
            paidThisSession.current.add(week);
            return;
          }
          if ('processing' in result && result.processing) {
            await resolveUncertain();
            return;
          }

          failed++;
          errors.push(`${week}: ${result.message || 'ไม่สำเร็จ'}`);
        } catch (err) {
          const error = err as Error;

          if (error.name === 'AbortError') {
            await resolveUncertain();
            return;
          }

          failed++;
          errors.push(`${week}: ${error.message}`);
        } finally {
          clearTimeout(timer);
        }
      })
    );

    if (failed > 0 || unknown > 0) {
      const parts = [];
      if (failed > 0) parts.push(`ล้มเหลว ${failed} รายการ`);
      if (unknown > 0) parts.push(`ไม่ทราบผล ${unknown} รายการ`);
      toast(`${parts.join(' • ')}: ${errors[0]}`, 'error', 6000);
    } else {
      toast(`ยืนยันการจ่ายเงินสำเร็จทั้งหมด ${succeeded} รายการ`, 'success');
    }

    if (succeeded > 0) {
      setStatuses((prev) => {
        const next = { ...prev };
        for (const week of paidThisSession.current) next[week] = { state: 'paid', amount: 0 };
        return next;
      });
      setSelected(new Set());
      // Silent: the toast already reported the result, and paidThisSession
      // has the card showing "จ่ายแล้ว" — a spinner here would only flicker.
      void loadSummary(true);
    }

    setPaying(false);
  }

  function startPayment() {
    if (selectedWeeks.length === 0) return;
    if (gate.allowed) setConfirming(true);
    else setGateOpen(true);
  }

  /* ---------- render ---------- */

  if (loading) {
    return (
      <div className="flex min-h-screen flex-col">
        <div className="flex flex-1 items-center justify-center">
          <Loading label="กำลังโหลดข้อมูล..." />
        </div>
      </div>
    );
  }

  const header = (
    <header className="relative z-10 border-b border-accent/12 bg-gradient-to-b from-[rgba(20,20,20,0.98)] to-[rgba(10,10,10,0.95)] px-4 py-4 md:px-6">
      {/* v2's header-top is a single centered, wrapping row — back link, logo,
          title block and badges all sit together, not split left/right. */}
      <div className="mx-auto flex max-w-[800px] flex-wrap items-center justify-center gap-4">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-lg px-3 py-2 text-ink-dim transition hover:bg-accent/10 hover:text-accent"
        >
          <span aria-hidden className="text-xl">
            ←
          </span>
          <span className="text-sm font-semibold">กลับ</span>
        </Link>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/logo.webp"
          alt="VES-PD Logo"
          width={72}
          height={72}
          className="h-[72px] w-[72px] shrink-0 object-cover transition-transform duration-300 hover:scale-105"
        />

        <div>
          <h1 className="text-center text-[1.15rem] font-bold text-ink">ประวัติเจ้าหน้าที่</h1>
          <div className="mt-0.5 text-center text-[0.6rem] tracking-[3px] text-ink-dim uppercase">
            กรมตำรวจ <span className="text-accent">VES-PD</span>
          </div>
        </div>

        {/* Same order as the home page: the two identity badges, then the
            Admin toggle last. Radius and tracking match v2's .header-badge. */}
        <div className="flex shrink-0 items-center gap-1.5">
          <span className="rounded-[6px] border border-accent/15 bg-accent/10 px-2.5 py-1 text-[0.55rem] font-bold tracking-[0.5px] text-accent">
            ◆ PROFILE
          </span>
          <span className="rounded-[6px] border border-accent/15 bg-accent/10 px-2.5 py-1 text-[0.55rem] font-bold tracking-[0.5px] text-accent">
            ⚖ POLICE
          </span>
          {/* Lit when this account may confirm payments. There is nothing to
              switch on here — the payment button is the only admin control and
              it asks the gate itself — so a click opens the status panel. */}
          <button
            type="button"
            onClick={() => setGateOpen(true)}
            title="โหมดผู้ดูแล"
            className={`cursor-pointer rounded-[6px] border px-2.5 py-1 text-[0.55rem] font-bold tracking-[0.5px] whitespace-nowrap transition ${
              gate.allowed
                ? 'border-[#f77f07] bg-[#f77f07] text-white'
                : 'border-[#f77f07]/30 bg-[#f77f07]/10 text-[#f77f07] hover:bg-[#f77f07]/20'
            }`}
          >
            ♛ Admin
          </button>

          <DiscordStatus
            userId={gate.userId}
            user={auth.user}
            loginUrl={auth.loginUrl}
            onLogout={() => void gate.logout()}
          />
        </div>
      </div>
    </header>
  );

  if (notFound || !officer) {
    return (
      <div className="flex min-h-screen flex-col">
        {header}
        <main className="mx-auto w-full max-w-[800px] flex-1 px-4 py-6">
          <div className="panel px-5 py-[60px] text-center">
            <p className="mb-5 text-[1.1rem] text-ink-dim">ไม่พบข้อมูลเจ้าหน้าที่</p>
            <div className="flex flex-wrap justify-center gap-3">
              <Link
                href="/"
                className="inline-block rounded-lg bg-accent px-6 py-2.5 font-semibold text-night transition hover:bg-accent-dark hover:-translate-y-px"
              >
                กลับหน้าหลัก
              </Link>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="inline-block cursor-pointer rounded-lg bg-accent px-6 py-2.5 font-semibold text-night transition hover:bg-accent-dark hover:-translate-y-px"
              >
                รีเฟรช
              </button>
            </div>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col">
      {header}

      <main className="mx-auto w-full max-w-[800px] flex-1 space-y-5 px-4 py-6">
        <section className="panel space-y-4 p-5 text-center">
          <div>
            <h2 className="text-xl font-extrabold text-ink">{officer.name}</h2>
            <span className="text-sm text-accent">{officer.rank || 'ไม่ระบุหน่วยงาน'}</span>

            {officer.phone && (
              <div className="mt-1.5 flex items-center justify-center gap-2 text-sm text-ink-dim">
                <span aria-hidden>☎</span>
                <span>{officer.phone}</span>
                <CopyButton value={officer.phone} label="คัดลอกเบอร์" />
              </div>
            )}
          </div>

          <div className="mx-auto grid max-w-lg grid-cols-3 gap-2">
            <SmallStat label="วันที่ทำงาน" value={officer.workDays || '0'} />
            <SmallStat label="ไม่ได้เข้าเวร" value={officer.daysAway || '0'} tone="gold" />
            <SmallStat
              label="SteamKey"
              value={officer.steamKey || officer.steamId || '-'}
              tone="blue"
              small
            />
          </div>

          {/* Cumulative totals carry v2's amber treatment, which is what marks
              them as career figures rather than this week's numbers. */}
          {totals && (
            <div className="mx-auto max-w-lg rounded-xl border border-[rgba(247,127,7,0.2)] bg-[rgba(247,127,7,0.08)] px-5 py-4">
              <div className="flex flex-wrap justify-center gap-3">
                <TotalStat label="รวมคดีทั้งหมด" value={totals.cases.toLocaleString()} />
                <TotalStat label="รวม Take 2" value={totals.take2.toLocaleString()} />
                <TotalStat label="รวมคุมสอบ" value={totals.interrogations.toLocaleString()} />
              </div>
            </div>
          )}

          <div className="border-t border-white/5 pt-4">
            <WeekSelector
              weeks={weeks}
              activeWeek={activeWeek}
              statuses={statuses}
              selected={selected}
              onSelectWeek={setActiveWeek}
              onToggleWeek={(week, checked) =>
                setSelected((prev) => {
                  const next = new Set(prev);
                  if (checked) next.add(week);
                  else next.delete(week);
                  return next;
                })
              }
            />
          </div>

          {selectedTotal > 0 && (
            <div className="space-y-2.5 rounded-lg border border-gold/30 bg-gold/10 p-4">
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={() =>
                    setSelected(
                      new Set(
                        Object.entries(statuses)
                          .filter(([w, s]) => s.state === 'owed' && w.toLowerCase() !== 'test')
                          .map(([w]) => w)
                      )
                    )
                  }
                  className="cursor-pointer rounded border border-gold/50 px-2 py-1 text-[0.7rem] text-gold transition hover:bg-gold/10"
                >
                  เลือกทั้งหมด
                </button>

                <strong className="flex items-center gap-1.5 text-base text-gold">
                  ฿ {selectedTotal.toLocaleString()}
                  <CopyButton value={String(selectedTotal)} label="คัดลอกจำนวนเงิน" />
                </strong>
              </div>

              <button
                type="button"
                onClick={startPayment}
                disabled={paying}
                className="w-full cursor-pointer rounded-sm bg-success py-3 text-sm font-bold text-night transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {paying
                  ? 'กำลังประมวลผล...'
                  : `ยืนยันการจ่ายเงิน ${selectedWeeks.length} รายการ`}
              </button>
            </div>
          )}
        </section>

        {activeWeek && <WeekStats weekName={activeWeek} data={weekData} />}

        <section>
          <h3 className="mb-3 text-sm font-bold text-ink">ตารางเวร (จันทร์-อาทิตย์)</h3>
          <DutyTable duty={weekData?.duty ?? null} total={weekData?.dutyTotal ?? null} />
        </section>
      </main>

      <SiteFooter />

      {gateOpen && (
        <AdminGateModal
          checking={gate.checking}
          userId={gate.userId}
          allowed={gate.allowed}
          loginUrl={auth.loginUrl}
          failed={auth.failed}
          problem={gate.problem}
          onLogout={() => void gate.logout()}
          onClose={() => setGateOpen(false)}
        />
      )}

      {confirming && (
        <ConfirmModal
          count={selectedWeeks.length}
          total={selectedTotal}
          weeks={selectedWeeks}
          onCancel={() => setConfirming(false)}
          onConfirm={() => {
            setConfirming(false);
            void runPayment();
          }}
        />
      )}
    </div>
  );
}

function SmallStat({
  label,
  value,
  tone = 'accent',
  small = false,
}: {
  label: string;
  value: string;
  tone?: 'accent' | 'gold' | 'blue';
  small?: boolean;
}) {
  const tones = { accent: 'text-accent', gold: 'text-gold', blue: 'text-[#60a5fa]' };

  return (
    <div className="rounded-md border border-white/5 bg-white/[0.03] px-2 py-2">
      <p className="mb-0.5 text-[0.6rem] text-ink-dim">{label}</p>
      <div className={`truncate font-bold ${tones[tone]} ${small ? 'text-[0.65rem]' : 'text-sm'}`}>
        {value}
      </div>
    </div>
  );
}

/** One figure inside the amber cumulative-totals panel (v2's .total-stat-item). */
function TotalStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-[80px] flex-1 rounded-[10px] bg-black/20 px-2 py-1.5 text-center sm:min-w-[100px] sm:px-3 sm:py-2">
      <span className="mb-1 block text-[11px] font-medium tracking-[0.5px] text-ink-dim uppercase">
        {label}
      </span>
      <span className="block text-base font-extrabold text-[#f0c040] sm:text-xl">{value}</span>
    </div>
  );
}
