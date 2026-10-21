'use client';

import { useCallback, useMemo, useState } from 'react';
import { SiteFooter, SiteHeader } from '@/components/SiteHeader';
import { NavTabs, type PageId } from '@/components/NavTabs';
import { SearchBar } from '@/components/SearchBar';
import { AllTimeTop10, WeeklyTop10 } from '@/components/Top10Sidebar';
import { RosterView } from '@/components/views/RosterView';
import { RulesLinkView } from '@/components/views/RulesLinkView';
import { ComingSoonView } from '@/components/views/ComingSoonView';
import { ScheduleView } from '@/components/views/ScheduleView';
import { ErrorState, Loading } from '@/components/ui/States';
import { AdminGateModal } from '@/components/ui/Modal';
import { DiscordStatus } from '@/components/ui/DiscordStatus';
import { useApi } from '@/lib/client/api';
import { queries } from '@/lib/client/queries';
import { filterByQuery } from '@/lib/format';
import { useAdminGate } from '@/lib/client/adminAccess';
import { useDiscordAuth } from '@/lib/client/useDiscordAuth';
import './home.css';

export default function HomePage() {
  const [page, setPage] = useState<PageId>('roster');
  const [query, setQuery] = useState('');

  const gate = useAdminGate();
  const auth = useDiscordAuth('home', true);
  const [gateOpen, setGateOpen] = useState(false);

  /* Each tab's data is a separate Google Sheets round trip, so a tab is
     fetched the first time it is opened and kept from then on — switching
     back is instant, and tabs nobody visits are never requested. */
  const [visited, setVisited] = useState<Set<PageId>>(() => new Set<PageId>(['roster']));

  const openPage = useCallback((next: PageId) => {
    setPage(next);
    setVisited((prev) => (prev.has(next) ? prev : new Set(prev).add(next)));
  }, []);

  const seen = (id: PageId) => visited.has(id);

  // The roster feeds both the officer list and the schedule table.
  const officers = useApi(queries.officers, 'officers');
  const weeks = useApi(queries.weeks, 'weeks');
  const schedule = useApi(queries.scheduleConfig, 'schedule_config', seen('schedule'));

  const allOfficers = useMemo(() => officers.data ?? [], [officers.data]);

  const filteredOfficers = useMemo(
    () => filterByQuery(allOfficers, query, ['name', 'code', 'rank']),
    [allOfficers, query]
  );

  return (
    <div className="home-page flex min-h-screen flex-col">
      <SiteHeader
        /* A plain link: /police gates itself against the same allowlist, and
           its own gate is the one place that can offer a Discord login. */
        badgeHref="/police"
        badgeTitle="ศูนย์รวมระบบตำรวจ — เฉพาะผู้ดูแล"
        extraBadge={
          <>
            {/* Straight to editing for someone already on the list — the gate
                panel is only for whoever still has to get on it. */}
            <button
              type="button"
              onClick={() =>
                gate.allowed ? gate.setAdminMode(!gate.adminMode) : setGateOpen(true)
              }
              title={
                gate.allowed
                  ? gate.adminMode
                    ? 'ปิดโหมดแก้ไข'
                    : 'เปิดโหมดแก้ไข'
                  : 'โหมดผู้ดูแล'
              }
              className={`cursor-pointer rounded-md border px-2.5 py-1 text-[0.55rem] font-bold tracking-wide whitespace-nowrap transition ${
                gate.adminMode
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
          </>
        }
      >
        <div className="header-nav-row">
          <SearchBar
            value={query}
            onChange={setQuery}
            resultCount={filteredOfficers.length}
            totalCount={allOfficers.length}
          />
          <NavTabs active={page} onChange={openPage} />
        </div>
      </SiteHeader>

      {/* w-full is load-bearing: v2's .app-layout centres itself with
          `margin: 0 auto`, and an auto cross-axis margin cancels the stretch
          it would otherwise get from this flex column — leaving it to
          shrink-wrap its content and spill past the viewport. */}
      <div className="app-layout w-full flex-1">
        <WeeklyTop10 weeks={weeks.data ?? []} />

        {/* Keyed by tab so React swaps the subtree outright — that is what
            replays the entrance animation instead of cross-fading two tabs. */}
        <main className="main-content tab-panel" key={page}>
          {page === 'roster' &&
            (officers.loading ? (
              <Loading />
            ) : officers.error ? (
              <ErrorState message={officers.error} onRetry={officers.reload} />
            ) : (
              <RosterView officers={filteredOfficers} total={allOfficers.length} />
            ))}

          {page === 'cases' && <ComingSoonView icon="⚖" title="การทำคดี" />}

          {page === 'conduct' && <ComingSoonView icon="📚" title="ข้อปฏิบัติเจ้าหน้าที่" />}

          {page === 'rules' && <RulesLinkView />}

          {page === 'fines' && <ComingSoonView icon="💰" title="ค่าปรับ" />}

          {page === 'schedule' &&
            (officers.loading ? (
              <Loading />
            ) : (
              <ScheduleView officers={filteredOfficers} config={schedule.data} />
            ))}
        </main>

        <AllTimeTop10 officers={allOfficers} />
      </div>

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
    </div>
  );
}
