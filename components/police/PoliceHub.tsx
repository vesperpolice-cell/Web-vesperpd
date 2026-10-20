'use client';

import Link from 'next/link';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { CopyButton } from '@/components/ui/Modal';
import { DiscordStatus } from '@/components/ui/DiscordStatus';
import { DiscordIcon } from '@/components/forms/DiscordIcon';
import { useAdminGate } from '@/lib/client/adminAccess';
import { useDiscordAuth } from '@/lib/client/useDiscordAuth';

interface Entry {
  href: string;
  icon: string;
  title: string;
  description: string;
}

/* Grouped by who the page is for: the first two are the intake forms an
   applicant fills in, the last two are the consoles that act on them. */
const GROUPS: { label: string; entries: Entry[] }[] = [
  {
    label: 'ระบบรับสมัคร',
    entries: [
      {
        href: '/register',
        icon: '📝',
        title: 'สมัครเป็นตำรวจ',
        description: 'แบบฟอร์มสมัครเข้าเป็นเจ้าหน้าที่ตำรวจ VES-PD',
      },
      {
        href: '/medical',
        icon: '🚑',
        title: 'สมัครเป็นแพทย์',
        description: 'แบบฟอร์มสมัครเข้าหน่วยแพทย์ VES-PD',
      },
    ],
  },
  {
    label: 'ระบบผู้ดูแล',
    entries: [
      {
        href: '/rostermanage',
        icon: '📋',
        title: 'จัดการสถานะสมาชิก',
        description: 'ดูสถานะ / เปลี่ยนสถานะ / ย้ายออกจากระบบ',
      },
      {
        href: '/proctor',
        icon: '⚙️',
        title: 'Proctor',
        description: 'ตรวจสอบและอนุมัติใบสมัครของผู้สมัคร',
      },
      {
        href: '/police/logs',
        icon: '📜',
        title: 'Log & Debug',
        description: 'ดู log และ error ของเว็บและบอท ย้อนหลังได้',
      },
    ],
  },
];

export function PoliceHub() {
  const gate = useAdminGate();
  const auth = useDiscordAuth('police', true);

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

      {gate.allowed ? (
        <Hub onLogout={() => void gate.logout()} />
      ) : (
        <AccessGate
          checking={gate.checking}
          userId={gate.userId}
          loginUrl={auth.loginUrl}
          failed={auth.failed}
          onLogout={() => void gate.logout()}
        />
      )}

      <SiteFooter />
    </div>
  );
}

function AccessGate({
  checking,
  userId,
  loginUrl,
  failed,
  onLogout,
}: {
  checking: boolean;
  userId: string | null;
  loginUrl: string;
  failed: boolean;
  onLogout: () => void;
}) {
  if (checking) {
    return (
      <main className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="flex items-center gap-3 text-sm text-ink-dim">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-accent/30 border-t-accent" />
          กำลังตรวจสอบสิทธิ์...
        </div>
      </main>
    );
  }

  return (
    <main className="flex flex-1 items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm rounded-[16px] border border-accent/20 bg-[rgba(20,20,20,0.85)] p-7 text-center shadow-[0_20px_60px_rgba(0,0,0,0.45)]">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full border border-[#f77f07]/30 bg-[#f77f07]/10 text-2xl">
          🔐
        </div>

        <h1 className="text-[1.05rem] font-bold text-ink">พื้นที่เฉพาะเจ้าหน้าที่</h1>

        {userId ? (
          <>
            <p className="mt-1.5 text-[0.75rem] leading-relaxed text-ink-dim">
              บัญชีนี้ยังไม่มีสิทธิ์เข้าศูนย์รวมระบบตำรวจ
              <br />
              ส่ง Discord ID ด้านล่างให้ผู้ดูแล เพื่อขอสิทธิ์
            </p>

            <div className="mt-4 flex items-center gap-2 rounded-md border border-accent/20 bg-black/30 px-3 py-2">
              <code className="min-w-0 flex-1 truncate text-left text-xs text-ink">{userId}</code>
              <CopyButton value={userId} label="คัดลอก Discord ID" />
            </div>

            <div className="mt-4 flex gap-2.5">
              <Link
                href="/"
                className="flex-1 rounded-sm bg-white/10 py-2.5 text-center text-sm font-semibold text-ink-dim transition hover:bg-white/15"
              >
                ← กลับหน้าหลัก
              </Link>
              <button
                type="button"
                onClick={onLogout}
                className="flex-1 cursor-pointer rounded-sm bg-white/10 py-2.5 text-sm font-semibold text-ink-dim transition hover:bg-white/15"
              >
                ออกจากระบบ
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="mt-1.5 mb-5 text-[0.75rem] leading-relaxed text-ink-dim">
              เชื่อมต่อ Discord เพื่อเข้าศูนย์รวมระบบตำรวจ
            </p>

            {/* Plain anchor: /auth/discord redirects off to discord.com, which
                next/link would try to prefetch cross-origin and fail on. */}
            <a
              href={loginUrl}
              className="flex w-full items-center justify-center gap-2 rounded-sm bg-[#5865f2] py-2.5 text-sm font-semibold text-white transition hover:brightness-110"
            >
              <DiscordIcon size={18} />
              เชื่อมต่อ Discord
            </a>

            {failed && (
              <p role="alert" className="mt-3 text-sm font-medium text-danger">
                ❌ เชื่อมต่อ Discord ไม่สำเร็จ กรุณาลองอีกครั้ง
              </p>
            )}

            <Link
              href="/"
              className="mt-3 block w-full rounded-sm bg-white/10 py-2.5 text-center text-sm font-semibold text-ink-dim transition hover:bg-white/15"
            >
              ← กลับหน้าหลัก
            </Link>
          </>
        )}
      </div>
    </main>
  );
}

function Hub({ onLogout }: { onLogout: () => void }) {
  return (
    <main className="mx-auto w-full max-w-[860px] flex-1 px-4 py-6 lg:px-6">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <Link
          href="/"
          className="flex items-center gap-2 rounded-sm px-2 py-1.5 text-sm font-semibold text-ink-dim transition hover:bg-accent/10 hover:text-accent"
        >
          <span aria-hidden>←</span> กลับหน้าหลัก
        </Link>

        <button
          type="button"
          onClick={onLogout}
          className="cursor-pointer rounded-[6px] border border-[#f77f07]/30 bg-[#f77f07]/10 px-2.5 py-1.5 text-[0.7rem] font-bold tracking-[0.5px] text-[#f77f07] transition hover:bg-[#f77f07]/20"
        >
          🔓 ผู้ดูแล — ออกจากระบบ
        </button>
      </div>

      <div className="mb-7 text-center">
        <h1 className="text-[1.35rem] font-bold text-ink">⚖ ศูนย์รวมระบบตำรวจ</h1>
        <p className="mt-1 text-[0.7rem] tracking-[2px] text-ink-dim uppercase">
          VES-PD Police Department — Control Center
        </p>
      </div>

      <div className="flex flex-col gap-7">
        {GROUPS.map((group) => (
          <section key={group.label}>
            <h2 className="mb-3.5 border-b border-accent/12 pb-2 text-[0.8rem] font-bold tracking-[1px] text-accent uppercase">
              {group.label}
            </h2>

            <div className="grid gap-3.5 md:grid-cols-2">
              {group.entries.map((entry) => (
                <Link
                  key={entry.href}
                  href={entry.href}
                  className="group flex items-center gap-4 rounded-[12px] border border-accent/12 bg-[rgba(20,20,20,0.8)] p-4 transition hover:-translate-y-0.5 hover:border-accent/40 hover:bg-accent/8 hover:shadow-[0_8px_24px_rgba(0,0,0,0.35)]"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] border border-accent/15 bg-accent/10 text-2xl">
                    {entry.icon}
                  </span>

                  <span className="min-w-0 flex-1">
                    <span className="block text-[0.95rem] font-bold text-ink">{entry.title}</span>
                    <span className="mt-0.5 block text-[0.72rem] leading-relaxed text-ink-dim">
                      {entry.description}
                    </span>
                  </span>

                  <span
                    aria-hidden
                    className="shrink-0 text-lg text-ink-dim transition group-hover:translate-x-0.5 group-hover:text-accent"
                  >
                    →
                  </span>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
