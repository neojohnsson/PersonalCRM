import { LegalPage, Part } from "@/app/legal-page";
import { APP_NAME } from "@/lib/app-config";
import { SUB_PROCESSORS } from "@/lib/legal/sub-processors";

export const metadata = { title: `Sub-processors · ${APP_NAME}` };

/**
 * Every outside service that receives data, what it gets and where
 * (slice 13, commit 6). The list is lib/legal/sub-processors.ts, which
 * tests/legal.test.ts checks against the hosts the code actually calls.
 */
export default function SubProcessorsPage() {
  return (
    <LegalPage
      title="Sub-processors"
      lead={`Every outside service that receives information from ${APP_NAME}, what it gets, and where it is. If one is added, it is added here first.`}
    >
      {SUB_PROCESSORS.map((each) => (
        <Part key={each.name} title={each.name}>
          <dl className="grid gap-x-4 gap-y-1.5 sm:grid-cols-[110px_1fr]">
            <dt className="text-sm font-semibold text-ink-soft">What it does</dt>
            <dd>{each.role}</dd>
            <dt className="text-sm font-semibold text-ink-soft">What it gets</dt>
            <dd>{each.gets}</dd>
            <dt className="text-sm font-semibold text-ink-soft">Where</dt>
            <dd>{each.where}</dd>
          </dl>
        </Part>
      ))}
    </LegalPage>
  );
}
