import { SectionHeader } from '@/components/ui/States';

/* The rules tab used to list the department's own rules out of the sheet.
   They live on the city's Google Sites page now, so the tab is a signpost
   rather than a copy — one place to maintain instead of two that drift. */

const RULES_URL =
  'https://sites.google.com/view/mahanakorndiwa/%E0%B8%AB%E0%B8%99%E0%B8%A7%E0%B8%A2%E0%B8%87%E0%B8%B2%E0%B8%99/%E0%B8%81%E0%B8%8F%E0%B8%95%E0%B8%B3%E0%B8%A3%E0%B8%A7%E0%B8%88?authuser=0';

export function RulesLinkView() {
  return (
    <section>
      <SectionHeader icon="📖" title="กฎหมายและระเบียบตำรวจ" />

      <div className="panel flex flex-col items-center px-6 py-12 text-center">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-4xl">
          📖
        </div>

        <h3 className="text-lg font-bold text-ink">กฎตำรวจฉบับเต็ม</h3>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-dim">
          กฎหมายและระเบียบทั้งหมดอยู่ที่เว็บไซต์ของเมือง MAHANAKORN DIWA
          <br />
          กดปุ่มด้านล่างเพื่อเปิดอ่าน
        </p>

        {/* A new tab, so following the rules does not lose the roster, the
            search box and whichever week was open behind it. */}
        <a
          href={RULES_URL}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-7 inline-flex items-center gap-2 rounded-lg bg-accent px-7 py-3 text-sm font-bold text-night transition hover:-translate-y-px hover:bg-accent-dark hover:shadow-[0_8px_24px_rgba(220,109,11,0.25)]"
        >
          เปิดหน้ากฎตำรวจ
          <span aria-hidden>↗</span>
        </a>
      </div>
    </section>
  );
}
