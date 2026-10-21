import { SectionHeader } from '@/components/ui/States';

/* A tab whose data is not ready to show yet.

   Same shape as RulesLinkView and for the same reason: the tab stays in the
   strip so nobody wonders where it went, but it says so plainly instead of
   rendering an empty table that reads like a fault. The sheet, the route and
   the view component it replaces are all still in place — restoring a tab is
   putting its one line in app/page.tsx back. */

export function ComingSoonView({ icon, title }: { icon: string; title: string }) {
  return (
    <section>
      <SectionHeader icon={icon} title={title} />

      <div className="panel flex flex-col items-center px-6 py-12 text-center">
        <div className="mb-5 flex h-20 w-20 items-center justify-center rounded-full border border-accent/20 bg-accent/10 text-4xl">
          {icon}
        </div>

        <h3 className="text-lg font-bold text-ink">รอการอัพเดท</h3>
        <p className="mt-2 max-w-md text-sm leading-relaxed text-ink-dim">
          ส่วนนี้ยังไม่เปิดให้ใช้งาน
          <br />
          อยู่ระหว่างจัดเตรียมข้อมูล
        </p>
      </div>
    </section>
  );
}
