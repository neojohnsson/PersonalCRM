"use client";

import { usePathname } from "next/navigation";
import { ShellFrame } from "@/app/shell-frame";
import { visiblePages, type ActivePage } from "@/lib/nav";

/**
 * What a page looks like while it loads (UI quality pass, milestone 3). Before,
 * pressing a page changed nothing on screen until the whole page arrived.
 *
 * Each skeleton has its page's own shape -- Home's two columns, the contacts
 * table, a contact's header and five figures -- so the page lands where the
 * skeleton was instead of jumping. The rail and header are the real ones
 * (ShellFrame), drawn at once, so they stay put.
 *
 * One component, choosing by the address: the loading.tsx of each section
 * uses it, because Next shows a skeleton only when the section being entered
 * has one. Public pages (/login, /pricing, the legal pages) have no rail and
 * load fast, so they get none.
 *
 * Every plan includes the Assistant (lib/plans/plans.ts), so the frame shows
 * all five pages; the avatar waits for the real page, which knows who you are.
 */

const SHELL_PAGES = visiblePages(true);

export function RouteSkeleton() {
  const path = usePathname() ?? "/";
  const shape = shapeFor(path);
  if (!shape) return null;
  return (
    <ShellFrame pages={SHELL_PAGES} active={shape.active} userEmail={undefined}>
      <main className="flex flex-1 flex-col gap-[18px] px-4 pt-2 pb-[30px] sm:px-[30px]" aria-busy="true">
        <span role="status" className="sr-only">
          Loading
        </span>
        {shape.body}
      </main>
    </ShellFrame>
  );
}

function shapeFor(path: string): { active: ActivePage; body: React.ReactNode } | null {
  if (path === "/") return { active: "home", body: <HomeBones /> };
  if (path === "/assistant") return { active: "assistant", body: <AssistantBones /> };
  if (path === "/calendar") return { active: "calendar", body: <CalendarBones /> };
  if (path === "/contacts") return { active: "contacts", body: <ContactsBones /> };
  if (/^\/contacts\/[0-9a-f-]{36}$/.test(path)) return { active: "contacts", body: <ContactBones /> };
  if (path === "/seen-once") return { active: "seen-once", body: <ListBones /> };
  const section = ["/assistant", "/calendar", "/contacts", "/seen-once", "/profile", "/privacy", "/connect"].find(
    (start) => path.startsWith(start),
  );
  if (!section) return null;
  const active = (section === "/privacy" || section === "/connect" ? "profile" : section.slice(1)) as ActivePage;
  return { active, body: <ListBones /> };
}

// ── The bones ──────────────────────────────────────────────────────────────

function Bone({ className = "", style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <span
      aria-hidden="true"
      style={style}
      className={`block animate-pulse rounded-[8px] bg-chip motion-reduce:animate-none ${className}`}
    />
  );
}

/** A white card, as the real ones are: Night gives it its edge (app/globals.css). */
function Card({ className = "", children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      aria-hidden="true"
      className={`flex flex-col gap-3 rounded-[18px] bg-white px-[22px] py-[18px] shadow-[0_1px_2px_rgba(20,20,25,.04),0_6px_16px_rgba(20,20,25,.05)] ${className}`}
    >
      {children}
    </div>
  );
}

function Title({ width = "w-[300px]" }: { width?: string }) {
  return (
    <div className="flex flex-col gap-2.5 pt-1">
      <Bone className={`h-[30px] max-w-full ${width}`} />
      <Bone className="h-3 w-[240px] max-w-full" />
    </div>
  );
}

function PersonRow() {
  return (
    <div className="flex items-center gap-3 py-1">
      <Bone className="size-8 shrink-0 rounded-full" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <Bone className="h-3 w-[40%]" />
        <Bone className="h-2.5 w-[65%]" />
      </div>
      <Bone className="h-3 w-6" />
    </div>
  );
}

function DateRow() {
  return (
    <div className="flex items-start gap-3">
      <Bone className="h-10 w-10 shrink-0 rounded-[10px]" />
      <div className="flex min-w-0 flex-1 flex-col gap-1.5 pt-0.5">
        <Bone className="h-3 w-[55%]" />
        <Bone className="h-2.5 w-[80%]" />
      </div>
    </div>
  );
}

// ── Each page's shape ──────────────────────────────────────────────────────

function HomeBones() {
  return (
    <>
      <Title />
      <div className="flex flex-col gap-[18px] lg:flex-row">
        <div className="flex min-w-0 flex-1 flex-col gap-[18px]">
          <Card>
            <Bone className="h-3.5 w-[180px]" />
            <PersonRow />
            <PersonRow />
          </Card>
          <Card>
            <Bone className="h-3.5 w-[150px]" />
            <PersonRow />
          </Card>
        </div>
        <Card className="lg:w-[300px] lg:shrink-0">
          <Bone className="h-3.5 w-[90px]" />
          <DateRow />
          <DateRow />
          <DateRow />
          <DateRow />
        </Card>
      </div>
    </>
  );
}

function AssistantBones() {
  return (
    <>
      <Title width="w-[200px]" />
      <div className="flex flex-col gap-[18px] lg:flex-row">
        <Card className="flex-1">
          <Bone className="h-3.5 w-[140px]" />
          <PersonRow />
          <PersonRow />
          <PersonRow />
        </Card>
        <Card className="flex-1">
          <Bone className="h-3.5 w-[100px]" />
          <DateRow />
          <DateRow />
        </Card>
      </div>
      <Bone className="h-12 w-full rounded-full" />
    </>
  );
}

function CalendarBones() {
  return (
    <>
      <Title width="w-[220px]" />
      <div className="flex flex-col gap-[18px] lg:flex-row">
        <Card className="min-h-[520px] flex-1">
          <div className="grid grid-cols-7 gap-2">
            {Array.from({ length: 7 }, (_, day) => (
              <Bone key={day} className="h-3" />
            ))}
          </div>
          <Bone className="min-h-[440px] flex-1 rounded-[12px] opacity-60" />
        </Card>
        <Card className="lg:w-[290px] lg:shrink-0">
          <Bone className="h-3.5 w-[120px]" />
          <DateRow />
          <DateRow />
          <DateRow />
        </Card>
      </div>
    </>
  );
}

function ContactsBones() {
  return (
    <>
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <Bone className="h-[30px] w-[150px]" />
        <Bone className="h-9 w-[190px] rounded-full" />
        <Bone className="ml-auto h-9 w-[210px] rounded-full" />
      </div>
      <div className="flex flex-wrap gap-2">
        {[64, 92, 96, 104, 120, 110, 84, 112].map((width) => (
          <Bone key={width} className="h-[30px] rounded-full" style={{ width }} />
        ))}
      </div>
      <Card className="gap-0 px-0 py-0">
        <div className="flex gap-6 px-[22px] py-3">
          <Bone className="h-2.5 w-[60px]" />
          <Bone className="ml-auto h-2.5 w-[70px]" />
          <Bone className="h-2.5 w-[70px]" />
          <Bone className="h-2.5 w-[50px]" />
        </div>
        {Array.from({ length: 10 }, (_, row) => (
          <div key={row} className="flex items-center gap-3 border-t border-line-soft px-[22px] py-[11px]">
            <Bone className="size-6 shrink-0 rounded-full" />
            <Bone className="h-3 w-[180px]" />
            <Bone className="ml-auto h-3 w-[110px]" />
            <Bone className="h-3 w-[70px]" />
            <Bone className="h-3 w-[60px]" />
          </div>
        ))}
      </Card>
    </>
  );
}

function ContactBones() {
  return (
    <>
      <Bone className="size-9 rounded-full" />
      <div className="flex items-center gap-4">
        <Bone className="size-14 shrink-0 rounded-full" />
        <div className="flex flex-col gap-2">
          <Bone className="h-[28px] w-[240px] max-w-full" />
          <Bone className="h-3 w-[200px]" />
        </div>
        <Bone className="ml-auto hidden h-10 w-[130px] rounded-full sm:block" />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {Array.from({ length: 5 }, (_, figure) => (
          <Card key={figure} className="gap-2 px-4 py-3.5">
            <Bone className="h-2.5 w-[60px]" />
            <Bone className="h-6 w-[80px]" />
            <Bone className="h-2.5 w-[90px]" />
          </Card>
        ))}
      </div>
      <Card>
        <Bone className="h-3.5 w-[110px]" />
        <PersonRow />
        <PersonRow />
      </Card>
      <Card>
        <Bone className="h-3.5 w-[90px]" />
        <Bone className="h-[70px] w-full" />
      </Card>
    </>
  );
}

function ListBones() {
  return (
    <>
      <Title width="w-[220px]" />
      <Card>
        {Array.from({ length: 6 }, (_, row) => (
          <PersonRow key={row} />
        ))}
      </Card>
    </>
  );
}
