'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { mutations } from '@/lib/client/queries';
import { useDiscordAuth } from '@/lib/client/useDiscordAuth';
import { BackHome } from '@/components/ui/BackHome';
import { CopyInline } from '@/components/ui/CopyInline';
import { DebugLog, PageToast, useDebugLog, useToastState } from './AdminShell';
import { DiscordGate, DiscordSessionBar, useAccessGate } from './DiscordGate';

/* Column headers come from the Pending sheet, so they are Thai strings. */
const COL = {
  timestamp: 'Timestamp',
  time: 'เวลา',
  discordId: 'Discord ID',
  discordName: 'ชื่อ Discord',
  icName: 'ชื่อ IC',
  phone: 'เบอร์ IC',
  ageOoc: 'อายุ OOC',
  age: 'อายุ',
  steamUrl: 'Steam URL',
  steam: 'Steam',
  status: 'สถานะ',
} as const;

const PENDING = 'รอตรวจ';
const APPROVED = 'อนุมัติ';
const REJECTED = 'ปฏิเสธ';

type Row = Record<string, string | number> & { _row: number };

function statusClass(status: string): string {
  if (status === PENDING) return 'status-pending';
  if (status === APPROVED) return 'status-approved';
  if (status === REJECTED) return 'status-rejected';
  return '';
}

export function ProctorPanel() {
  const auth = useDiscordAuth('admin', true);
  const [toast, showToast] = useToastState();
  const [logText, log] = useDebugLog();

  const { gate, checking, refresh: refreshAccess, clear: clearGate } = useAccessGate(
    mutations.proctorAccess,
    log
  );

  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [busy, setBusy] = useState(false);
  const [reloading, setReloading] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const loadData = useCallback(async () => {
    setBusy(true);
    setReloading(true);
    setLoadError('');
    try {
      const result = await mutations.listPending();
      const data = result.data as Row[];
      setRows(data);
      setLoaded(true);
      log(`โหลดข้อมูล ${data.length} รายการ`);
    } catch (err) {
      const message = (err as Error).message;
      showToast(message || 'โหลดข้อมูลไม่สำเร็จ', 'error');
      log(`Error: ${message}`);
      setLoadError(message || 'โหลดข้อมูลไม่สำเร็จ');

      /* Access can be taken away while the page is open — the list is re-read
         on every request. Drop back to the gate so it says why, rather than
         leaving a dead table on screen. */
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
    setRows([]);
    auth.disconnect();
    log('ออกจากระบบแล้ว');
  }

  const stats = useMemo(() => {
    const count = (status: string) => rows.filter((r) => r[COL.status] === status).length;
    return {
      total: rows.length,
      pending: count(PENDING),
      approved: count(APPROVED),
      rejected: count(REJECTED),
    };
  }, [rows]);

  const visible = useMemo(() => {
    const q = search.toLowerCase().trim();

    return rows.filter((row) => {
      if (statusFilter && row[COL.status] !== statusFilter) return false;
      if (!q) return true;

      return [COL.discordId, COL.discordName, COL.icName].some((key) =>
        String(row[key] ?? '')
          .toLowerCase()
          .includes(q)
      );
    });
  }, [rows, search, statusFilter]);

  async function approve(row: number) {
    const item = rows.find((r) => r._row === row);
    const discordId = String(item?.[COL.discordId] ?? '');
    if (!window.confirm(`อนุมัติผู้ใช้ Discord ID: ${discordId}?`)) return;

    setBusy(true);
    try {
      /* The proctor on the record is taken from the session server-side; there
         is nothing to send and nothing here that could name someone else. */
      await mutations.approvePending(row);
      showToast(`✔ อนุมัติ ${discordId} เรียบร้อย`);
      log(`อนุมัติ แถว ${row} (${discordId}) โดย proctor ${gate?.userId ?? ''}`);
      await loadData();
    } catch (err) {
      showToast((err as Error).message || 'เกิดข้อผิดพลาด', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function reject(row: number) {
    const item = rows.find((r) => r._row === row);
    const discordId = String(item?.[COL.discordId] ?? '');
    if (!window.confirm(`ปฏิเสธผู้ใช้ Discord ID: ${discordId}?`)) return;

    setBusy(true);
    try {
      await mutations.rejectPending(row);
      showToast(`ปฏิเสธ ${discordId} เรียบร้อย`);
      log(`ปฏิเสธ แถว ${row} (${discordId})`);
      await loadData();
    } catch (err) {
      showToast((err as Error).message || 'เกิดข้อผิดพลาด', 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="proctor-page">
      <div className="container">
        <BackHome className="mb-2" />
        <h1>⚙️ Proctor</h1>
        <p className="subtitle">VES-PD Police Department — ระบบตรวจสอบและอนุมัติใบสมัคร</p>

        <PageToast toast={toast} />

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
                <div className="loading">กำลังโหลดข้อมูล</div>
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
                <div className="num">{stats.total}</div>
                <div className="label">ทั้งหมด</div>
              </div>
              <div className="stat-card">
                <div className="num">{stats.pending}</div>
                <div className="label">รอตรวจ</div>
              </div>
              <div className="stat-card">
                <div className="num">{stats.approved}</div>
                <div className="label">อนุมัติแล้ว</div>
              </div>
              <div className="stat-card">
                <div className="num">{stats.rejected}</div>
                <div className="label">ปฏิเสธ</div>
              </div>
            </div>

            <div className="panel">
              <div className="filter-bar">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="🔍 ค้นหา Discord ID, ชื่อ..."
                  aria-label="ค้นหาใบสมัคร"
                />
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value)}
                  aria-label="กรองตามสถานะ"
                  style={{
                    padding: 10,
                    background: '#252545',
                    border: '1px solid #3a3a5a',
                    borderRadius: 8,
                    color: '#fff',
                    fontSize: 14,
                  }}
                >
                  <option value="">ทั้งหมด</option>
                  <option value={PENDING}>{PENDING}</option>
                  <option value={APPROVED}>{APPROVED}</option>
                  <option value={REJECTED}>{REJECTED}</option>
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

              <div className="table-wrap">
                {(reloading || visible.length > 0) && (
                  <table>
                    <thead>
                      <tr>
                        <th className="col-idx">#</th>
                        <th className="col-time">เวลา</th>
                        <th className="col-did">Discord ID</th>
                        <th className="col-dname">ชื่อ Discord</th>
                        <th className="col-icname">ชื่อ IC</th>
                        <th className="col-phone">เบอร์</th>
                        <th className="col-age">อายุ</th>
                        <th className="col-steam">Steam</th>
                        <th className="col-status">สถานะ</th>
                        <th className="col-actions">จัดการ</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reloading && (
                        <tr>
                          <td colSpan={10} className="loading">
                            กำลังโหลด
                          </td>
                        </tr>
                      )}
                      {!reloading &&
                        visible.map((row, i) => {
                        const status = String(row[COL.status] ?? PENDING);
                        const discordId = String(row[COL.discordId] ?? '');
                        const steam = String(row[COL.steamUrl] ?? row[COL.steam] ?? '');

                        return (
                          <tr key={row._row}>
                            <td>{i + 1}</td>
                            <td>{String(row[COL.timestamp] ?? row[COL.time] ?? '—')}</td>
                            <td className="col-did">
                              <code style={{ fontSize: 11, color: '#aaa' }}>
                                {discordId || '—'}
                              </code>
                              <CopyInline value={discordId} />
                            </td>
                            <td>{String(row[COL.discordName] ?? '—')}</td>
                            <td>{String(row[COL.icName] ?? '—')}</td>
                            <td>{String(row[COL.phone] ?? '—')}</td>
                            <td>{String(row[COL.ageOoc] ?? row[COL.age] ?? '—')}</td>
                            <td>
                              <a
                                href={steam || '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ color: '#6af' }}
                              >
                                {(steam || '—').substring(0, 30)}
                              </a>
                            </td>
                            <td>
                              <span className={`status-badge ${statusClass(status)}`}>{status}</span>
                            </td>
                            <td className="actions">
                              {status === PENDING ? (
                                <>
                                  <button
                                    type="button"
                                    className="btn-success btn-sm"
                                    onClick={() => void approve(row._row)}
                                    disabled={!auth.user || busy}
                                    title={auth.user ? undefined : 'กรุณาเชื่อมต่อ Discord ก่อน'}
                                  >
                                    ✔ อนุมัติ
                                  </button>
                                  <button
                                    type="button"
                                    className="btn-danger btn-sm"
                                    onClick={() => void reject(row._row)}
                                    disabled={!auth.user || busy}
                                    title={auth.user ? undefined : 'กรุณาเชื่อมต่อ Discord ก่อน'}
                                  >
                                    ✘ ปฏิเสธ
                                  </button>
                                </>
                              ) : (
                                <button type="button" className="btn-done" disabled>
                                  เสร็จสิ้น
                                </button>
                              )}
                            </td>
                          </tr>
                          );
                        })}
                    </tbody>
                  </table>
                )}
              </div>

              {!reloading && visible.length === 0 && (
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
