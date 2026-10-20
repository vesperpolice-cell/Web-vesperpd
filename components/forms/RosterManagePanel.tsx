'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { mutations } from '@/lib/client/queries';
import { useDiscordAuth } from '@/lib/client/useDiscordAuth';
import { BackHome } from '@/components/ui/BackHome';
import { CopyInline } from '@/components/ui/CopyInline';
import { DebugLog, PageToast, useDebugLog, useToastState } from './AdminShell';
import { DiscordGate, DiscordSessionBar, useAccessGate } from './DiscordGate';
import type { RosterMember } from '@/server/services/roster';

/* The sheet stores an empty status for "still serving"; everything else is an
   exit reason. The blank option below is that empty value. */
const STATUS_OPTIONS = ['', 'ออกจาก Discord', 'ถูกปลดออก', 'ติดต่อขอออก', 'เกิน 15 วัน'] as const;

/** Filter-only sentinel for "no exit reason set" — see the note in the filter. */
const NORMAL = '__normal__';

/* These mirror the caps the routes enforce. They are repeated here so an
   over-large selection is refused in Thai, next to the button, instead of
   coming back as a schema error — the server is still the one enforcing them.

   Why two numbers for one button: "ถูกปลดออก" and "ติดต่อขอออก" are announced
   in Discord one post at a time, so they are what makes a batch slow. The
   other two reasons post nothing and are limited only by request size. */
const MAX_BULK_STATUS = 200;
const MAX_BULK_MOVE = 50;
const MAX_BULK_ANNOUNCE = 20;
const ANNOUNCED_REASONS = ['ถูกปลดออก', 'ติดต่อขอออก'];

/* The confirm box serves three actions now: one person out of the system, one
   status onto everyone ticked, or everyone ticked out at once. All three want
   the same "say what will happen, then do it" shape, so they share the dialog
   and differ only in the payload. */
type PendingConfirm = {
  title: string;
  message: string;
  confirmLabel: string;
  danger: boolean;
} & (
  | { kind: 'move-out'; row: number; reason: string }
  | { kind: 'bulk-status'; rows: number[]; status: string }
  | { kind: 'bulk-move-out'; rows: number[] }
);

function statusClass(status: string): string {
  if (!status) return 'status-normal';
  if (status === 'ออกจาก Discord') return 'status-left';
  if (status === 'ถูกปลดออก') return 'status-fired';
  if (status === 'ติดต่อขอออก') return 'status-resign';
  return 'status-normal';
}

function statusText(status: string): string {
  if (!status) return '✅ ปกติ';
  if (status === 'ออกจาก Discord') return '🔴 ออกจาก Discord';
  if (status === 'ถูกปลดออก') return '🟡 ถูกปลดออก';
  if (status === 'ติดต่อขอออก') return '🔵 ติดต่อขอออก';
  return status;
}

const stripTag = (name: string) => name.replace(/\[VES-PD\]/g, '');

/**
 * One table's worth of ticking.
 *
 * Each table keeps its own selection rather than sharing one: row numbers are
 * per sheet, so row 5 is one person on NamePD and a different one on OutDC,
 * and ticking in one tab should not follow you into the other.
 */
function useTickSelection(visible: RosterMember[]) {
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const visibleRows = useMemo(() => new Set(visible.map((m) => m.row)), [visible]);

  /* A tick that a filter change scrolls out of view would stay invisible and
     still be acted on, so the selection is trimmed to what is on screen.
     Returning the same Set when nothing dropped is what stops this looping. */
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<number>();
      for (const row of prev) if (visibleRows.has(row)) next.add(row);
      return next.size === prev.size ? prev : next;
    });
  }, [visibleRows]);

  /* Everything on screen counts and acts on this list, never on the raw Set:
     it is filtered through the visible rows, so the number on a bulk bar is
     always exactly what the buttons beside it will touch. */
  const members = useMemo(() => visible.filter((m) => selected.has(m.row)), [visible, selected]);

  const allSelected = visible.length > 0 && members.length === visible.length;

  const toggleRow = (row: number) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (!next.delete(row)) next.add(row);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) =>
      prev.size === visible.length ? new Set() : new Set(visible.map((m) => m.row))
    );

  const clear = useCallback(() => setSelected(new Set()), []);

  return {
    members,
    allSelected,
    toggleRow,
    toggleAll,
    clear,
    isTicked: (row: number) => selected.has(row),
  };
}

export function RosterManagePanel() {
  const auth = useDiscordAuth('roster', true);
  const [toast, showToast] = useToastState();
  const [logText, log] = useDebugLog();

  const { gate, checking, refresh: refreshAccess, clear: clearGate } = useAccessGate(
    mutations.adminAccess,
    log
  );

  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);

  const [namePD, setNamePD] = useState<RosterMember[]>([]);
  const [outDC, setOutDC] = useState<RosterMember[]>([]);
  const [tab, setTab] = useState<'namepd' | 'outdc'>('namepd');

  const [search, setSearch] = useState('');
  const [dayFilter, setDayFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [searchOut, setSearchOut] = useState('');

  /* Ticked people are held as sheet row numbers, not table positions: both
     filtering and reloading reshuffle a table, while the row number is what
     every write is addressed by. */
  const [bulkStatus, setBulkStatus] = useState('');

  const [confirming, setConfirming] = useState<PendingConfirm | null>(null);
  const [confirmRunning, setConfirmRunning] = useState(false);

  const loadData = useCallback(async () => {
    setBusy(true);
    setReloading(true);
    setLoadError('');
    try {
      const [inSystem, departed] = await Promise.all([mutations.namePD(), mutations.outDC()]);
      const current = inSystem.data as RosterMember[];
      const gone = departed.data as RosterMember[];

      setNamePD(current);
      setOutDC(gone);
      setLoaded(true);
      log(`โหลด NamePD ${current.length} รายการ, OutDC ${gone.length} รายการ`);
    } catch (err) {
      const message = (err as Error).message;
      showToast(message || 'โหลดข้อมูลไม่สำเร็จ', 'error');
      log(`Error: ${message}`);
      setLoadError(message || 'โหลดข้อมูลไม่สำเร็จ');

      /* Access can be taken away while the page is open — the list is re-read
         on every request. Rather than leaving a dead table on screen, drop back
         to the gate so it says why. */
      if (/สิทธิ์|Discord/.test(message)) {
        setLoaded(false);
        void refreshAccess();
      }
    } finally {
      setBusy(false);
      setReloading(false);
    }
  }, [log, showToast, refreshAccess]);

  /* On the list: straight into the table. With the PIN field gone there is no
     second step left for the person to click. */
  const allowed = gate?.allowed ?? false;
  useEffect(() => {
    if (allowed) void loadData();
  }, [allowed, loadData]);

  async function doLogout() {
    try {
      await mutations.discordLogout();
    } catch {
      /* the cookie expires on its own; nothing useful to show */
    }
    clearGate();
    setLoaded(false);
    setNamePD([]);
    setOutDC([]);
    pd.clear();
    out.clear();
    auth.disconnect();
    log('ออกจากระบบแล้ว');
  }

  /* Both counters read NamePD: they answer "who is still on the roster but
     already flagged", which is what makes them actionable. */
  const stats = useMemo(
    () => ({
      inSystem: namePD.length,
      departed: outDC.length,
      leftDiscord: namePD.filter((m) => m.status === 'ออกจาก Discord').length,
      fired: namePD.filter((m) => m.status === 'ถูกปลดออก').length,
    }),
    [namePD, outDC]
  );

  const visibleNamePD = useMemo(() => {
    const q = search.toLowerCase().trim();
    const minDays = dayFilter.trim() ? parseInt(dayFilter.trim(), 10) : NaN;

    return namePD.filter((m) => {
      if (
        q &&
        ![m.code, m.name, m.discordId].some((v) => v.toLowerCase().includes(q))
      ) {
        return false;
      }

      if (!Number.isNaN(minDays)) {
        const match = m.duration.match(/(\d+)\s*วัน/);
        const days = match ? parseInt(match[1], 10) : NaN;
        if (Number.isNaN(days) || days < minDays) return false;
      }

      // v2 gave both "สถานะทั้งหมด" and "ปกติ" the value "", so picking ปกติ
      // silently filtered nothing. NORMAL is the sentinel that makes it work.
      if (statusFilter === NORMAL) return m.status === '';
      if (statusFilter && m.status !== statusFilter) return false;
      return true;
    });
  }, [namePD, search, dayFilter, statusFilter]);

  const visibleOutDC = useMemo(() => {
    const q = searchOut.toLowerCase().trim();
    if (!q) return outDC;
    return outDC.filter((m) =>
      [m.code, m.name, m.discordId].some((v) => v.toLowerCase().includes(q))
    );
  }, [outDC, searchOut]);

  /* One per table. NamePD's drives the writes; OutDC's only ever gets copied
     from, because an archive has nothing left to change. */
  const pd = useTickSelection(visibleNamePD);
  const out = useTickSelection(visibleOutDC);

  const bareId = (raw: string) => raw.replace(/[<@>]/g, '').trim();

  async function copyIds(members: RosterMember[]) {
    /* The sheet holds some ids bare and some already wrapped, so strip before
       wrapping — otherwise the mention comes out doubled and pings nobody.
       Deduplicated because the same id twice is noise in a Discord message. */
    const ids = [...new Set(members.map((m) => bareId(m.discordId)).filter(Boolean))];

    if (ids.length === 0) {
      showToast('คนที่ติ๊กไว้ไม่มี Discord ID', 'error');
      return;
    }

    const missing = members.filter((m) => !bareId(m.discordId)).length;

    try {
      // One mention per line: that is how they get pasted into Discord.
      await navigator.clipboard.writeText(ids.map((id) => '<@' + id + '>').join('\n'));
      showToast(
        `คัดลอก ${ids.length} ID แล้ว` + (missing > 0 ? ` (ข้าม ${missing} คนที่ไม่มี ID)` : ''),
        'success'
      );
      log(`คัดลอก Discord ID ${ids.length} รายการ`);
    } catch {
      showToast('คัดลอกไม่สำเร็จ — เบราว์เซอร์ไม่อนุญาตให้ใช้คลิปบอร์ด', 'error');
    }
  }

  /* Naming them beats naming a number: a mis-click on the select-all box is
     the one way a bulk action goes wrong, and a list makes that obvious while
     it can still be cancelled. Ten is as many as the box shows before the
     count takes over. */
  function nameList(lines: string[]): string {
    const rest = lines.length - 10;
    return lines.slice(0, 10).join('\n') + (rest > 0 ? `\n… และอีก ${rest} คน` : '');
  }

  function confirmBulkStatus() {
    if (pd.members.length === 0) return;

    if (pd.members.length > MAX_BULK_STATUS) {
      showToast(`เปลี่ยนสถานะได้ครั้งละไม่เกิน ${MAX_BULK_STATUS} คน`, 'error');
      return;
    }

    setConfirming({
      kind: 'bulk-status',
      rows: pd.members.map((m) => m.row),
      status: bulkStatus,
      title: '⚠️ ยืนยันการเปลี่ยนสถานะหลายคน',
      message:
        `เปลี่ยนสถานะ ${pd.members.length} คน เป็น "${bulkStatus || '✅ ปกติ'}"\n\n` +
        nameList(pd.members.map((m) => `${m.code} ${stripTag(m.name).trim()}`)),
      confirmLabel: 'เปลี่ยนสถานะ',
      danger: false,
    });
  }

  function confirmBulkMoveOut() {
    if (pd.members.length === 0) return;

    /* Each person is moved out for whatever their own status says, so someone
       still marked ปกติ has no reason to be moved out for. The server refuses
       them too, but the fix is to set their status first — so they are named
       here, before anything is sent. */
    const unset = pd.members.filter((m) => !m.status);
    if (unset.length > 0) {
      showToast(
        `ตั้งสถานะก่อน — ยังไม่มีสาเหตุ ${unset.length} คน: ` +
          unset
            .slice(0, 5)
            .map((m) => m.code)
            .join(', ') +
          (unset.length > 5 ? ' …' : ''),
        'error'
      );
      return;
    }

    if (pd.members.length > MAX_BULK_MOVE) {
      showToast(`ย้ายออกได้ครั้งละไม่เกิน ${MAX_BULK_MOVE} คน`, 'error');
      return;
    }

    const announced = pd.members.filter((m) => ANNOUNCED_REASONS.includes(m.status)).length;
    if (announced > MAX_BULK_ANNOUNCE) {
      showToast(
        `"ถูกปลดออก" และ "ติดต่อขอออก" ต้องประกาศใน Discord ทีละคน ` +
          `จึงย้ายได้ครั้งละไม่เกิน ${MAX_BULK_ANNOUNCE} คน (ติ๊กมา ${announced} คน)`,
        'error'
      );
      return;
    }

    setConfirming({
      kind: 'bulk-move-out',
      rows: pd.members.map((m) => m.row),
      title: '⚠️ ยืนยันการย้ายออกหลายคน',
      message:
        `ต้องการย้าย ${pd.members.length} คน ออกจากระบบ?\n\n` +
        nameList(
          pd.members.map((m) => `${m.code} ${stripTag(m.name).trim()} — ${m.status}`)
        ) +
        /* Said before confirming, not after: a mass departure that posts
           nothing in Discord and one that tags thirty people are the same
           click otherwise. */
        (announced > 0 ? `\n\n📢 จะประกาศใน Discord ${announced} คน` : '') +
        '\n\n⚠️ ข้อมูลจะถูกลบจาก NamePD และไปอยู่ OutDC',
      confirmLabel: 'ย้ายออกทั้งหมด',
      danger: true,
    });
  }

  async function updateStatus(row: number, newStatus: string) {
    setBusy(true);
    try {
      const result = await mutations.setRosterStatus(row, newStatus);
      showToast(result.message, 'success');
      log(`อัปเดตสถานะ แถว ${row} → ${newStatus || 'ปกติ'}`);
      await loadData();
    } catch (err) {
      showToast((err as Error).message || 'เกิดข้อผิดพลาด', 'error');
    } finally {
      setBusy(false);
    }
  }

  function confirmMoveOut(member: RosterMember) {
    if (!member.status) {
      showToast(
        'กรุณาเลือกสถานะก่อน ("ออกจาก Discord", "ถูกปลดออก", "ติดต่อขอออก")',
        'error'
      );
      return;
    }

    setConfirming({
      kind: 'move-out',
      row: member.row,
      reason: member.status,
      confirmLabel: 'ยืนยัน',
      danger: true,
      title: '⚠️ ยืนยันการย้ายออก',
      message:
        `ต้องการย้าย ${member.code} ${stripTag(member.name).trim()} ออกจากระบบ?\n` +
        `สาเหตุ: ${member.status}\n\n` +
        '⚠️ ข้อมูลจะถูกลบจาก NamePD และไปอยู่ OutDC',
    });
  }

  async function executeConfirm() {
    if (!confirming) return;
    const action = confirming;
    setConfirmRunning(true);

    try {
      if (action.kind === 'move-out') {
        const result = await mutations.moveOut(action.row, action.reason);
        showToast(result.message, 'success');
        log(`ย้ายออก: ${result.message}`);
      } else if (action.kind === 'bulk-status') {
        const result = await mutations.setRosterStatusBulk(action.rows, action.status);
        showToast(result.message, 'success');
        log(`เปลี่ยนสถานะหลายคน: ${result.message}`);
        pd.clear();
      } else {
        const result = await mutations.moveOutBulk(action.rows);
        showToast(result.message, 'success');
        log(`ย้ายออกหลายคน: ${result.message}`);

        /* The move succeeded even when an announcement did not, so the detail
           goes to the log rather than turning the toast into a failure. */
        if (result.warnings.length > 0) {
          log(`WebHook ไม่สำเร็จ: ${result.warnings.join('; ')}`);
        }
        pd.clear();
      }
      await loadData();
    } catch (err) {
      showToast((err as Error).message || 'เกิดข้อผิดพลาด', 'error');
    } finally {
      setConfirmRunning(false);
      setConfirming(null);
    }
  }

  return (
    <div className="rostermanage-page">
      <div className="container">
        <BackHome className="mb-2" />
        <h1>📋 จัดการสถานะสมาชิก</h1>
        <p className="subtitle">
          VES-PD Police Department — ดูสถานะ / เปลี่ยนสถานะ / ย้ายออกจากระบบ
        </p>

        <PageToast toast={toast} />

        {confirming && (
          <div className="confirm-dialog" style={{ display: 'flex' }} role="dialog" aria-modal="true">
            <div className="confirm-box">
              {confirmRunning ? (
                <div className="confirm-loading" style={{ textAlign: 'center', padding: 20 }}>
                  <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
                  <div style={{ color: '#f0c040', fontWeight: 600 }}>กำลังดำเนินการ...</div>
                </div>
              ) : (
                <div>
                  <h3>{confirming.title}</h3>
                  <p style={{ whiteSpace: 'pre-line' }}>{confirming.message}</p>
                  <div className="actions">
                    <button
                      type="button"
                      className="btn-secondary"
                      onClick={() => setConfirming(null)}
                    >
                      ยกเลิก
                    </button>
                    <button
                      type="button"
                      className={confirming.danger ? 'btn-danger' : 'btn-warning'}
                      onClick={() => void executeConfirm()}
                    >
                      {confirming.confirmLabel}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {!loaded ? (
          /* Allowed but not loaded yet is the gap between the access answer and
             the first fetch — showing the gate there would flash "no access" at
             someone who has it. */
          allowed ? (
            <div className="login-box">
              {loadError ? (
                <div>
                  <div style={{ color: '#ef4444', marginBottom: 6 }}>❌ {loadError}</div>
                  {gate?.problem && (
                    <div className="config-warning" style={{ textAlign: 'left' }}>
                      ⚠️ {gate.problem}
                    </div>
                  )}
                  <button
                    type="button"
                    className="btn-secondary"
                    disabled={busy}
                    onClick={() => void loadData()}
                  >
                    ลองใหม่
                  </button>
                </div>
              ) : (
                <div className="loading">กำลังโหลดข้อมูล…</div>
              )}
            </div>
          ) : (
            <DiscordGate
              loginUrl={auth.loginUrl}
              checking={checking}
              gate={gate}
              failed={auth.failed}
              user={auth.user}
              onLogout={() => void doLogout()}
            />
          )
        ) : (
          <div>
            <DiscordSessionBar
              userId={gate?.userId ?? ''}
              user={auth.user}
              onLogout={() => void doLogout()}
            />

            {gate?.problem && <div className="config-warning">⚠️ {gate.problem}</div>}

            <div className="stats">
              <div className="stat-card">
                <div className="num">{stats.inSystem}</div>
                <div className="label">ในระบบ (NamePD)</div>
              </div>
              <div className="stat-card">
                <div className="num">{stats.departed}</div>
                <div className="label">ออกแล้ว (OutDC)</div>
              </div>
              <div className="stat-card">
                <div className="num">{stats.leftDiscord}</div>
                <div className="label">ออกจาก Discord</div>
              </div>
              <div className="stat-card">
                <div className="num">{stats.fired}</div>
                <div className="label">ถูกปลดออก</div>
              </div>
            </div>

            <div className="tab-bar">
              <button
                type="button"
                className={`tab-btn${tab === 'namepd' ? ' active' : ''}`}
                onClick={() => setTab('namepd')}
              >
                📋 NamePD (ในระบบ)
              </button>
              <button
                type="button"
                className={`tab-btn${tab === 'outdc' ? ' active' : ''}`}
                onClick={() => setTab('outdc')}
              >
                🗂️ OutDC (ออกแล้ว)
              </button>
            </div>

            <div className="panel" style={{ display: tab === 'namepd' ? 'block' : 'none' }}>
              <div className="filter-bar">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="🔍 ค้นหา ชื่อ, รหัส, Discord ID..."
                  aria-label="ค้นหาสมาชิก"
                />
                <input
                  type="text"
                  value={dayFilter}
                  onChange={(e) => setDayFilter(e.target.value)}
                  placeholder="📅 จำนวนวัน..."
                  aria-label="กรองตามจำนวนวัน"
                  style={{ width: 120, flex: 'none' }}
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="กรองตามสถานะ"
                >
                  <option value="">สถานะทั้งหมด</option>
                  <option value={NORMAL}>ปกติ</option>
                  <option value="ออกจาก Discord">ออกจาก Discord</option>
                  <option value="ถูกปลดออก">ถูกปลดออก</option>
                  <option value="ติดต่อขอออก">ติดต่อขอออก</option>
                  <option value="เกิน 15 วัน">เกิน 15 วัน</option>
                </select>
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => void loadData()}
                  disabled={busy}
                >
                  🔄 โหลดใหม่
                </button>
              </div>

              {/* Sits above the table rather than inside it: the table body
                  scrolls in a 500px box, and a bar in there would scroll away
                  from the ticks it acts on. */}
              {pd.members.length > 0 && (
                <div className="bulk-bar">
                  <span className="bulk-count">☑️ ติ๊กไว้ {pd.members.length} คน</span>

                  <select
                    value={bulkStatus}
                    disabled={busy}
                    aria-label="สถานะที่จะตั้งให้ทุกคนที่ติ๊ก"
                    onChange={(e) => setBulkStatus(e.target.value)}
                  >
                    {STATUS_OPTIONS.map((option) => (
                      <option key={option || 'normal'} value={option}>
                        {option || '✅ ปกติ'}
                      </option>
                    ))}
                  </select>

                  <button
                    type="button"
                    className="btn-warning btn-sm"
                    disabled={busy}
                    onClick={confirmBulkStatus}
                  >
                    ✍️ ตั้งสถานะให้ทุกคนที่ติ๊ก
                  </button>

                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => void copyIds(pd.members)}
                  >
                    📋 ก๊อป ID Discord
                  </button>

                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={pd.clear}
                  >
                    ✖ ล้างการเลือก
                  </button>

                  {/* Last and pushed to the far edge: the one button here that
                      cannot be undone should not sit under a stray click meant
                      for the harmless ones beside it. */}
                  <button
                    type="button"
                    className="btn-danger btn-sm"
                    disabled={busy}
                    style={{ marginLeft: 'auto' }}
                    onClick={confirmBulkMoveOut}
                  >
                    🚫 ย้ายออกที่ติ๊ก
                  </button>
                </div>
              )}

              <div className="table-wrap">
                {(reloading || visibleNamePD.length > 0) && (
                  <table>
                    <thead>
                      <tr>
                        <th className="pick-col">
                          <input
                            type="checkbox"
                            checked={pd.allSelected}
                            ref={(el) => {
                              if (el) {
                                el.indeterminate = pd.members.length > 0 && !pd.allSelected;
                              }
                            }}
                            disabled={busy || visibleNamePD.length === 0}
                            onChange={pd.toggleAll}
                            aria-label="ติ๊กทุกคนที่เห็นอยู่"
                            title="ติ๊กทุกคนที่เห็นอยู่ (ตามตัวกรอง)"
                          />
                        </th>
                        <th>#</th>
                        <th>รหัส</th>
                        <th>ชื่อ-นามสกุล</th>
                        <th>Discord ID</th>
                        <th>เบอร์</th>
                        <th>ยศ</th>
                        <th>เคส</th>
                        <th>Steam</th>
                        <th>ระยะเวลา</th>
                        <th>สถานะ</th>
                        <th>เปลี่ยนสถานะ</th>
                        <th>ย้ายออก</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reloading && (
                        <tr>
                          <td colSpan={13} className="loading">
                            กำลังโหลด
                          </td>
                        </tr>
                      )}
                      {!reloading &&
                        visibleNamePD.map((m, i) => (
                        <tr key={m.row}>
                          <td className="pick-col">
                            <input
                              type="checkbox"
                              checked={pd.isTicked(m.row)}
                              disabled={busy}
                              onChange={() => pd.toggleRow(m.row)}
                              aria-label={`ติ๊กเลือก ${stripTag(m.name)}`}
                            />
                          </td>
                          <td>{i + 1}</td>
                          <td>
                            <strong>{m.code}</strong>
                          </td>
                          <td>{stripTag(m.name)}</td>
                          <td>
                            <code style={{ fontSize: 11, color: '#aaa' }}>{m.discordId}</code>
                            <CopyInline value={m.discordId} />
                          </td>
                          <td>{m.phone || ''}</td>
                          <td>{m.rank}</td>
                          <td>{m.cases || '0'}</td>
                          <td style={{ fontSize: 11, color: '#888' }}>
                            {m.steam}
                            <CopyInline value={m.steam} />
                          </td>
                          <td>{m.duration}</td>
                          <td>
                            <span className={`status-badge ${statusClass(m.status)}`}>
                              {statusText(m.status)}
                            </span>
                          </td>
                          <td>
                            <select
                              className="status-select"
                              value={m.status}
                              disabled={busy}
                              aria-label={`สถานะของ ${stripTag(m.name)}`}
                              onChange={(e) => void updateStatus(m.row, e.target.value)}
                            >
                              {STATUS_OPTIONS.map((option) => (
                                <option key={option || 'normal'} value={option}>
                                  {option || '✅ ปกติ'}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="actions">
                            <button
                              type="button"
                              className="btn-danger btn-xs"
                              onClick={() => confirmMoveOut(m)}
                              disabled={busy}
                            >
                              🚫 ย้ายออก
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {!reloading && visibleNamePD.length === 0 && (
                <div className="empty-msg">💡 ไม่มีข้อมูล</div>
              )}
            </div>

            <div className="panel" style={{ display: tab === 'outdc' ? 'block' : 'none' }}>
              <div className="filter-bar">
                <input
                  type="text"
                  value={searchOut}
                  onChange={(e) => setSearchOut(e.target.value)}
                  placeholder="🔍 ค้นหา..."
                  aria-label="ค้นหาสมาชิกที่ออกแล้ว"
                />
                <button
                  type="button"
                  className="btn-secondary btn-sm"
                  onClick={() => void loadData()}
                  disabled={busy}
                >
                  🔄 โหลดใหม่
                </button>
              </div>

              {/* Nothing destructive here on purpose: OutDC is the archive, so
                  the only thing worth doing with a handful of its rows is
                  taking their ids somewhere else. */}
              {out.members.length > 0 && (
                <div className="bulk-bar">
                  <span className="bulk-count">☑️ ติ๊กไว้ {out.members.length} คน</span>

                  <button
                    type="button"
                    className="btn-secondary btn-sm"
                    onClick={() => void copyIds(out.members)}
                  >
                    📋 ก๊อป ID Discord
                  </button>

                  <button type="button" className="btn-secondary btn-sm" onClick={out.clear}>
                    ✖ ล้างการเลือก
                  </button>
                </div>
              )}

              <div className="table-wrap">
                {(reloading || visibleOutDC.length > 0) && (
                  <table>
                    <thead>
                      <tr>
                        <th className="pick-col">
                          <input
                            type="checkbox"
                            checked={out.allSelected}
                            ref={(el) => {
                              if (el) {
                                el.indeterminate = out.members.length > 0 && !out.allSelected;
                              }
                            }}
                            disabled={busy || visibleOutDC.length === 0}
                            onChange={out.toggleAll}
                            aria-label="ติ๊กทุกคนที่เห็นอยู่"
                            title="ติ๊กทุกคนที่เห็นอยู่ (ตามการค้นหา)"
                          />
                        </th>
                        <th>#</th>
                        <th>รหัส</th>
                        <th>ชื่อ-นามสกุล</th>
                        <th>Discord ID</th>
                        <th>ยศ</th>
                        <th>Steam</th>
                        <th>ไม่เข้าเวร</th>
                        <th>สาเหตุ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reloading && (
                        <tr>
                          <td colSpan={9} className="loading">
                            กำลังโหลด
                          </td>
                        </tr>
                      )}
                      {!reloading &&
                        visibleOutDC.map((m, i) => (
                        <tr key={`${m.row}-${m.code}`}>
                          <td className="pick-col">
                            <input
                              type="checkbox"
                              checked={out.isTicked(m.row)}
                              disabled={busy}
                              onChange={() => out.toggleRow(m.row)}
                              aria-label={`ติ๊กเลือก ${stripTag(m.name)}`}
                            />
                          </td>
                          <td>{i + 1}</td>
                          <td>
                            <strong>{m.code}</strong>
                          </td>
                          <td>{stripTag(m.name)}</td>
                          <td>
                            <code style={{ fontSize: 11, color: '#aaa' }}>{m.discordId}</code>
                            <CopyInline value={m.discordId} />
                          </td>
                          <td>{m.rank}</td>
                          <td style={{ fontSize: 11, color: '#888' }}>
                            {m.steam}
                            <CopyInline value={m.steam} />
                          </td>
                          {/* Column L: "ไม่เข้าเวร" on OutDC, "ระยะเวลา" on NamePD —
                              one mapper serves both sheets. */}
                          <td>{m.duration}</td>
                          <td>
                            <span className={`status-badge ${statusClass(m.status)}`}>
                              {statusText(m.status)}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {!reloading && visibleOutDC.length === 0 && (
                <div className="empty-msg">💡 ไม่มีข้อมูล</div>
              )}
            </div>

            <DebugLog text={logText} />
          </div>
        )}
      </div>
    </div>
  );
}
