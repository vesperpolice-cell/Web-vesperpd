'use client';

/* Route-level error boundary for the log viewer.
 *
 * Without it, anything this page throws while rendering takes the whole app
 * down to Next's generic "Application error: a client-side exception has
 * occurred", which names no cause and leaves nothing to act on — the one
 * failure mode a page built for diagnosing failures must not have.
 *
 * It also makes the error reportable: the message and digest are on screen
 * rather than only in a console the person may never open.
 */

import Link from 'next/link';

export default function LogsError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="flex min-h-screen flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-lg rounded-[16px] border border-danger/30 bg-[rgba(20,20,20,0.85)] p-7">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-danger/30 bg-danger/10 text-2xl">
          ⚠️
        </div>

        <h1 className="text-center text-[1.05rem] font-bold text-ink">หน้า Log มีปัญหา</h1>
        <p className="mt-1.5 text-center text-[0.75rem] text-ink-dim">
          ส่วนอื่นของเว็บยังใช้งานได้ตามปกติ
        </p>

        <div className="mt-4 rounded-md border border-danger/20 bg-black/30 p-3">
          <p className="text-[0.7rem] font-bold text-danger">รายละเอียดข้อผิดพลาด</p>
          <code className="mt-1 block break-words text-[0.72rem] text-ink">
            {error.message || 'ไม่มีข้อความระบุสาเหตุ'}
          </code>
          {error.digest ? (
            <code className="mt-1.5 block text-[0.65rem] text-ink-dim">
              รหัสอ้างอิง: {error.digest}
            </code>
          ) : null}
        </div>

        <p className="mt-3 text-[0.68rem] leading-relaxed text-ink-dim">
          ถ้าเพิ่งมีการอัปเดตเว็บ ให้กด <b>Ctrl + Shift + R</b> หนึ่งครั้งก่อน — เบราว์เซอร์อาจยังถือไฟล์เวอร์ชันเก่าอยู่
        </p>

        <div className="mt-5 flex gap-2.5">
          <button
            type="button"
            onClick={reset}
            className="flex-1 cursor-pointer rounded-sm bg-accent/15 py-2.5 text-sm font-semibold text-accent transition hover:bg-accent/25"
          >
            ลองใหม่
          </button>
          <Link
            href="/police"
            className="flex-1 rounded-sm bg-white/10 py-2.5 text-center text-sm font-semibold text-ink-dim transition hover:bg-white/15"
          >
            ← ศูนย์รวมระบบตำรวจ
          </Link>
        </div>
      </div>
    </main>
  );
}
