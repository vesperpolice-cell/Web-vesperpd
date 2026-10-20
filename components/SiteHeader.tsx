/* eslint-disable @next/next/no-img-element */

import Link from 'next/link';

/* Radius and tracking follow v2's .header-badge, not Tailwind's nearest step. */
const BADGE_CLASS =
  'rounded-[6px] border border-accent/15 bg-accent/10 px-2.5 py-1 text-[0.55rem] font-bold tracking-[0.5px] text-accent';

export function SiteHeader({
  children,
  extraBadge,
  title = 'Vesper Police Department',
  unit = 'กรมตำรวจ',
  badge = '⚖ POLICE',
  badgeHref,
  badgeTitle,
}: {
  children?: React.ReactNode;
  extraBadge?: React.ReactNode;
  /** Department name in the header — the medical pages carry their own. */
  title?: string;
  unit?: string;
  badge?: string;
  /** Turns the department badge into a link. Left unset it stays a plain label. */
  badgeHref?: string;
  badgeTitle?: string;
}) {
  return (
    <header className="relative z-10 border-b border-accent/12 bg-gradient-to-b from-[rgba(20,20,20,0.98)] to-[rgba(10,10,10,0.95)] px-4 pt-3 pb-4 md:px-6 md:pt-4 md:pb-5">
      <div className="mb-4 flex flex-wrap items-center justify-center gap-3 md:mb-5 md:gap-4">
        <img
          src="/logo.webp"
          alt="VES-PD Logo"
          width={72}
          height={72}
          className="h-14 w-14 shrink-0 object-cover transition-transform duration-300 hover:scale-105 md:h-[72px] md:w-[72px]"
        />

        <div>
          <h1 className="text-center text-[0.95rem] font-bold text-ink md:text-[1.15rem]">
            {title}
          </h1>
          <div className="mt-0.5 text-center text-[0.55rem] tracking-[2px] text-ink-dim uppercase md:text-[0.6rem] md:tracking-[3px]">
            {unit} <span className="text-accent">VES-PD</span>
          </div>
        </div>

        <div className="hidden shrink-0 items-center gap-1.5 md:flex">
          <HeaderBadge>◆ FIVEM</HeaderBadge>

          {badgeHref ? (
            <Link
              href={badgeHref}
              title={badgeTitle}
              className={`${BADGE_CLASS} cursor-pointer transition hover:-translate-y-px hover:border-accent/60 hover:bg-accent/20 hover:shadow-[0_0_14px_rgba(220,109,11,0.25)]`}
            >
              {badge}
            </Link>
          ) : (
            <HeaderBadge>{badge}</HeaderBadge>
          )}

          {extraBadge}
        </div>
      </div>

      {children}
    </header>
  );
}

function HeaderBadge({ children }: { children: React.ReactNode }) {
  return <span className={BADGE_CLASS}>{children}</span>;
}

/* Sizes, opacity and the white-ish rule come from v2's footer.css, where the
   footer is deliberately faint enough to sit under the content. */
export function SiteFooter({ department = 'VES-PD POLICE DEPARTMENT' }: { department?: string }) {
  return (
    <footer className="relative z-10 border-t border-white/5 bg-[rgba(10,10,10,0.5)] p-4 text-center md:p-5">
      <p className="text-[0.6rem] tracking-[0.3px] text-ink-dim opacity-45 md:text-[0.65rem]">
        © 2026 <span className="text-accent opacity-100">{department}</span> — FiveM Server
      </p>
    </footer>
  );
}
