'use client';

/* Log & Debug — /police/logs
 *
 * Three sources behind three tabs, because they answer different questions:
 *
 *   เว็บ          this app's errors and admin actions      sheet, 30 days
 *   บอท           the bot's important lines                 sheet, 30 days
 *   บอท (สด)      the bot's full trail                      its memory, 24h
 *
 * The first two are rows in a spreadsheet, so they survive a restart and a
 * redeploy. The third is asked of the bot over HTTP and is the only one that
 * can be unavailable — a sleeping or restarting bot — so it reports that in
 * place of its list and leaves the other tabs working.
 *
 * Gated by the same allowlist as /police. Nothing here authorises anything:
 * every call is refused server-side without a session on that list.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { DiscordStatus } from '@/components/ui/DiscordStatus';
import { useAdminGate } from '@/lib/client/adminAccess';
import { useDiscordAuth } from '@/lib/client/useDiscordAuth';
import { mutations } from '@/lib/client/queries';

type Tab = 'web' | 'bot' | 'live';

const TABS: { id: Tab; label: string; hint: string }[] = [
  { id: 'web', label: '🌐 เว็บ', hint: '100 แถวล่าสุด' },
  { id: 'bot', label: '🤖 บอท', hint: '100 แถวล่าสุด' },
  { id: 'live', label: '⚡ บอท (สด)', hint: 'ย้อนหลัง 24 ชม.' },
];

/** DEBUG only exists in the bot's live trail; the sheets never carry it. */
const LEVELS = ['ERROR', 'WARN', 'INFO', 'DEBUG'] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_STYLE: Record<string, string> = {
  ERROR: 'border-danger/40 bg-danger/15 text-danger',
  WARN: 'border-gold/40 bg-gold/15 text-gold',
  INFO: 'border-accent/35 bg-accent/12 text-accent',
  DEBUG: 'border-white/15 bg-white/5 text-ink-dim',
};

/* Fluid Active CPU is billed on what these fetches actually spend, and a log
   page left open all afternoon is the one thing here that polls on its own.
   A minute is fast enough for a debug view and costs a quarter of what 15s
   did — the tab also stops polling entirely while it is in the background. */
const AUTO_REFRESH_MS = 60_000;

interface ViewRow {
  at: string;
  level: string;
  context: string;
  actor: string;
  message: string;
  detail: string;
}

/** Bangkok time, matching the format both sheets already store. */
function formatAt(ms: number): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(ms));

  const get = (t: string) => (parts.find((p) => p.type === t)?.value ?? '').padStart(2, '0');
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`;
}

function describeUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return h > 0 ? `${h} ชม. ${m} นาที` : `${m} นาที`;
}

/**
 * Forces every field to a string before it reaches the DOM.
 *
 * React throws "Objects are not valid as a React child" on anything that is
 * not a string or number, and in a client component that throw takes the whole
 * page down. The rows come from a spreadsheet people edit by hand and from a
 * bot on another host, so neither source is worth trusting to the letter.
 */
function toViewRow(row: Partial<ViewRow>): ViewRow {
  const text = (v: unknown): string => {
    if (v === null || v === undefined) return '';
    if (typeof v === 'string') return v;
    /* A Date here means something revived a timestamp string on the way in.
       `parseDate: false` in eden.ts stops that at the source; this keeps the
       page readable rather than merely unbroken if it ever happens again.
       Local getters, because such a Date was parsed as local time — reading it
       back the same way returns the digits the sheet actually holds. */
    if (v instanceof Date && !Number.isNaN(v.getTime())) {
      const p2 = (n: number) => String(n).padStart(2, '0');
      return (
        `${v.getFullYear()}-${p2(v.getMonth() + 1)}-${p2(v.getDate())} ` +
        `${p2(v.getHours())}:${p2(v.getMinutes())}:${p2(v.getSeconds())}`
      );
    }
    return String(v);
  };

  return {
    at: text(row.at),
    level: text(row.level),
    context: text(row.context),
    actor: text(row.actor),
    message: text(row.message),
    detail: text(row.detail),
  };
}

/* The bot sends its own meta object; `actor` is lifted out of it so both
   sources line up in one table and the rest is shown as detail. */
function splitMeta(meta: unknown): { actor: string; detail: string } {
  if (!meta || typeof meta !== 'object') return { actor: '', detail: '' };
  const rest: Record<string, unknown> = { ...(meta as Record<string, unknown>) };
  const actor = typeof rest.actor === 'string' ? rest.actor : '';
  delete rest.actor;
  return {
    actor,
    detail: Object.keys(rest).length > 0 ? JSON.stringify(rest) : '',
  };
}

export function LogsClient() {
  const gate = useAdminGate();
  /* 'police' rather than a state of its own: the OAuth return targets are a
     fixed list in discordAuth, and landing on the hub after login is one
     click from here. */
  const auth = useDiscordAuth('police', true);

  const [tab, setTab] = useState<Tab>('live');
  const [levels, setLevels] = useState<Level[]>([]);
  const [search, setSearch] = useState('');
  const [limit, setLimit] = useState(200);

  const [rows, setRows] = useState<ViewRow[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [auto, setAuto] = useState(false);

  /* The fetch reads the filters, and auto-refresh re-runs it on a timer. Held
     in a ref so the timer does not have to be torn down and rebuilt every time
     a filter changes. */
  const loadRef = useRef<() => void>(() => {});

  const query = useMemo(
    () => ({
      level: levels.length > 0 ? levels.join(',') : undefined,
      q: search.trim() || undefined,
      limit,
    }),
    [levels, search, limit]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      if (tab === 'live') {
        const res = await mutations.botLiveLogs(query);
        const entries = Array.isArray(res.entries) ? res.entries : [];
        setRows(
          entries.map((e) => {
            const { actor, detail } = splitMeta(e.meta);
            return toViewRow({
              at: formatAt(e.at),
              level: e.level,
              context: e.context,
              actor,
              message: e.message,
              detail,
            });
          })
        );
        setTotal(res.buffer?.lines ?? entries.length);

        const span =
          res.buffer.oldest && res.buffer.newest
            ? `${formatAt(res.buffer.oldest)} → ${formatAt(res.buffer.newest)}`
            : 'ยังไม่มี log';
        setStatus(
          [
            res.bot.ready ? '🟢 บอทออนไลน์' : '🔴 บอทไม่พร้อม',
            `เปิดมา ${describeUptime(res.bot.uptime)}`,
            `ปิง ${res.bot.wsPing} ms`,
            `เก็บไว้ ${res.buffer.lines.toLocaleString()} บรรทัด (${span})`,
            `คิวรอเขียนลงชีต ${res.pendingSheetRows}`,
            `ยอดนับค้างในคิว ${res.pendingCountOps}`,
          ].join(' · ')
        );
      } else {
        const res = tab === 'web' ? await mutations.webLogs(query) : await mutations.botLogs(query);
        const list = Array.isArray(res.rows) ? res.rows.map(toViewRow) : [];
        const count = typeof res.total === 'number' ? res.total : list.length;
        setRows(list);
        setTotal(count);
        setStatus(`เก็บไว้ทั้งหมด ${count.toLocaleString()} บรรทัด`);
      }
    } catch (err) {
      setRows([]);
      setTotal(0);
      setStatus('');
      setError(err instanceof Error ? err.message : 'โหลด log ไม่สำเร็จ');
    } finally {
      setLoading(false);
    }
  }, [tab, query]);

  /* Written in an effect, not during render: React treats a ref touched while
     rendering as undefined behaviour under concurrent rendering, and this one
     exists only so the interval below always calls the newest version. */
  useEffect(() => {
    loadRef.current = () => void load();
  }, [load]);

  useEffect(() => {
    if (!gate.allowed) return;
    void load();
  }, [gate.allowed, load]);

  /* A hidden tab asks nobody's question. The interval below skips the fetch
     while the page is in the background and the visibility handler catches the
     table up the moment the reader comes back — same freshness when it is being
     read, no Sheets round trip when it is not. */
  useEffect(() => {
    if (!auto || !gate.allowed) return;

    const id = setInterval(() => {
      if (document.visibilityState === 'visible') loadRef.current();
    }, AUTO_REFRESH_MS);

    const onVisible = () => {
      if (document.visibilityState === 'visible') loadRef.current();
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [auto, gate.allowed]);

  const toggleLevel = (level: Level) =>
    setLevels((prev) => (prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]));

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader
        extraBadge={
          <DiscordStatus
            userId={gate.userId}
            user={auth.user}
            loginUrl={auth.loginUrl}
            onLogout={() => void gate.logout()}
          />
        }
      />

      {gate.checking ? (
        <main className="flex flex-1 items-center justify-center px-4 py-10">
          <div className="flex items-center gap-3 text-sm text-ink-dim">
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
            กำลังตรวจสอบสิทธิ์...
          </div>
        </main>
      ) : !gate.allowed ? (
        <main className="flex flex-1 items-center justify-center px-4 py-10">
          <div className="w-full max-w-sm rounded-[16px] border border-accent/20 bg-[rgba(20,20,20,0.85)] p-7 text-center">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[#f77f07]/30 bg-[#f77f07]/10 text-2xl">
              🔐
            </div>
            <h1 className="text-[1.05rem] font-bold text-ink">พื้นที่เฉพาะผู้ดูแล</h1>
            <p className="mt-1.5 text-[0.75rem] leading-relaxed text-ink-dim">
              หน้านี้ใช้สิทธิ์เดียวกับศูนย์รวมระบบตำรวจ
              {gate.userId ? ' — บัญชีนี้ยังไม่อยู่ในรายชื่อผู้ดูแล' : ' กรุณาเชื่อมต่อ Discord ก่อน'}
            </p>
            <Link
              href="/police"
              className="mt-5 block rounded-sm bg-white/10 py-2.5 text-sm font-semibold text-ink-dim transition hover:bg-white/15"
            >
              ← ไปศูนย์รวมระบบตำรวจ
            </Link>
          </div>
        </main>
      ) : (
        <main className="mx-auto w-full max-w-[1100px] flex-1 px-4 py-6 lg:px-6">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <Link
              href="/police"
              className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm font-semibold text-ink-dim transition hover:bg-accent/10 hover:text-accent"
            >
              <span aria-hidden>←</span> ศูนย์รวมระบบตำรวจ
            </Link>
            <h1 className="text-[1.2rem] font-bold text-ink">📜 Log &amp; Debug</h1>
          </div>

          {gate.problem ? (
            <p className="mb-4 rounded-md border border-gold/30 bg-gold/10 px-3 py-2 text-[0.72rem] text-gold">
              ⚠️ {gate.problem}
            </p>
          ) : null}

          {/* ---- tabs ---- */}
          <div className="mb-4 flex flex-wrap gap-2">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() => setTab(t.id)}
                className={`cursor-pointer rounded-[8px] border px-3.5 py-2 text-left transition ${
                  tab === t.id
                    ? 'border-accent/50 bg-accent/12 text-accent'
                    : 'border-accent/12 bg-[rgba(20,20,20,0.8)] text-ink-dim hover:border-accent/30 hover:text-ink'
                }`}
              >
                <span className="block text-[0.82rem] font-bold">{t.label}</span>
                <span className="mt-0.5 block text-[0.65rem] opacity-80">{t.hint}</span>
              </button>
            ))}
          </div>

          {/* ---- filters ---- */}
          <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-[10px] border border-accent/12 bg-[rgba(20,20,20,0.6)] p-3">
            <div className="flex flex-wrap gap-1.5">
              {LEVELS.filter((l) => l !== 'DEBUG' || tab === 'live').map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => toggleLevel(level)}
                  className={`cursor-pointer rounded-[6px] border px-2.5 py-1 text-[0.68rem] font-bold transition ${
                    levels.includes(level)
                      ? LEVEL_STYLE[level]
                      : 'border-white/10 bg-transparent text-ink-dim hover:border-white/25'
                  }`}
                >
                  {level}
                </button>
              ))}
            </div>

            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="ค้นหาในข้อความ / หมวด / ผู้ทำ"
              className="min-w-[200px] flex-1 rounded-[6px] border border-accent/15 bg-black/30 px-2.5 py-1.5 text-[0.78rem] text-ink outline-none placeholder:text-ink-dim/60 focus:border-accent/40"
            />

            <select
              value={limit}
              onChange={(e) => setLimit(Number(e.target.value))}
              className="cursor-pointer rounded-[6px] border border-accent/15 bg-black/30 px-2 py-1.5 text-[0.75rem] text-ink outline-none focus:border-accent/40"
            >
              {[50, 100, 200, 500, 1000].map((n) => (
                <option key={n} value={n}>
                  {n} บรรทัด
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="cursor-pointer rounded-[6px] border border-accent/30 bg-accent/10 px-3 py-1.5 text-[0.75rem] font-bold text-accent transition hover:bg-accent/20 disabled:cursor-wait disabled:opacity-50"
            >
              {loading ? 'กำลังโหลด...' : '🔄 รีเฟรช'}
            </button>

            <label className="flex cursor-pointer items-center gap-1.5 text-[0.72rem] text-ink-dim">
              <input
                type="checkbox"
                checked={auto}
                onChange={(e) => setAuto(e.target.checked)}
                className="cursor-pointer accent-[#f4c430]"
              />
              อัตโนมัติ 15 วิ
            </label>
          </div>

          {/* ---- status ---- */}
          {status ? (
            <p className="mb-3 text-[0.7rem] leading-relaxed text-ink-dim">{status}</p>
          ) : null}

          {error ? (
            <p className="mb-3 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-[0.75rem] text-danger">
              ❌ {error}
            </p>
          ) : null}

          {/* ---- rows ---- */}
          {rows.length === 0 && !error && !loading ? (
            <p className="rounded-[10px] border border-accent/12 bg-[rgba(20,20,20,0.6)] px-4 py-8 text-center text-[0.8rem] text-ink-dim">
              {total > 0 ? 'ไม่มีบรรทัดที่ตรงกับตัวกรอง' : 'ยังไม่มี log ในช่วงนี้'}
            </p>
          ) : (
            <div className="overflow-hidden rounded-[10px] border border-accent/12">
              {/* Newest first: the reason anyone opens this page is to see what
                  just happened, and both sources store oldest-first. */}
              {[...rows].reverse().map((row, i) => (
                <div
                  key={`${row.at}-${i}`}
                  className={`flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2 text-[0.75rem] ${
                    i % 2 === 0 ? 'bg-[rgba(20,20,20,0.7)]' : 'bg-[rgba(20,20,20,0.45)]'
                  }`}
                >
                  <code className="shrink-0 text-[0.68rem] whitespace-nowrap text-ink-dim">
                    {row.at}
                  </code>

                  <span
                    className={`shrink-0 rounded-[4px] border px-1.5 py-[1px] text-[0.6rem] font-bold ${
                      LEVEL_STYLE[row.level] ?? LEVEL_STYLE.DEBUG
                    }`}
                  >
                    {row.level || '—'}
                  </span>

                  <span className="shrink-0 text-[0.68rem] font-semibold text-accent/80">
                    {row.context}
                  </span>

                  <span className="min-w-[180px] flex-1 break-words text-ink">{row.message}</span>

                  {row.actor ? (
                    <code className="shrink-0 text-[0.65rem] text-ink-dim" title="ผู้ทำรายการ">
                      👤 {row.actor}
                    </code>
                  ) : null}

                  {row.detail ? (
                    <code className="w-full break-all text-[0.64rem] text-ink-dim/80">
                      {row.detail}
                    </code>
                  ) : null}
                </div>
              ))}
            </div>
          )}

          <p className="mt-3 text-[0.68rem] leading-relaxed text-ink-dim">
            แสดง {rows.length.toLocaleString()} บรรทัด
            {tab === 'live'
              ? ' · แท็บนี้อ่านจากหน่วยความจำของบอท บอทรีสตาร์ทแล้วเริ่มนับใหม่'
              : ' · แท็บนี้อ่านจากชีต ทนบอทรีสตาร์ทและ deploy ใหม่'}
          </p>
        </main>
      )}

      <SiteFooter />
    </div>
  );
}
