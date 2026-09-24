import { APP_NAME } from "@/lib/app-config";

/**
 * The building blocks of the two screens a new user passes through before the
 * app itself: /login (design/Login.dc.html) and /connect
 * (design/Connect.dc.html). Both designs use the same tile, list sections and
 * notice, so both pages import them from here and can't drift apart.
 */

/** The dark "C" tile above the heading. */
export function BrandTile() {
  return (
    <div
      aria-hidden="true"
      className="flex size-10 items-center justify-center rounded-xl bg-ink-deep"
    >
      <span className="text-[18px] font-extrabold tracking-[-0.03em] text-white">
        {APP_NAME.charAt(0)}
      </span>
    </div>
  );
}

export function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[11px] font-bold tracking-[0.09em] text-ink-faint uppercase">
        {title}
      </h2>
      <ul className="flex flex-col gap-[9px]">{children}</ul>
    </section>
  );
}

const TONES = {
  info: "text-info",
  affirm: "text-affirm",
  muted: "text-ink-faint",
} as const;

export function Item({
  icon,
  tone,
  children,
}: {
  icon: "check" | "cross";
  tone: keyof typeof TONES;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-[11px]">
      <Icon
        name={icon}
        className={`mt-0.5 size-[17px] shrink-0 ${TONES[tone]}`}
      />
      <p className="text-[14.5px] leading-[1.5]">{children}</p>
    </li>
  );
}

export function Divider() {
  return <div aria-hidden="true" className="h-px bg-line" />;
}

export function Callout({
  icon,
  role,
  children,
}: {
  icon: "alert" | "info";
  role?: "alert";
  children: React.ReactNode;
}) {
  return (
    <div
      role={role}
      className="flex items-start gap-3 rounded-[14px] bg-accent-tint px-[18px] py-[15px]"
    >
      <Icon name={icon} className="mt-0.5 size-[17px] shrink-0 text-accent" />
      <p className="text-[13.5px] leading-[1.55] text-alert-ink">{children}</p>
    </div>
  );
}

/** The design's icons, drawn with currentColor so Tailwind text colours apply. */
const ICON_PATHS = {
  check: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="m8.2 12.2 2.6 2.6 5-5.4" />
    </>
  ),
  cross: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M9 9l6 6M15 9l-6 6" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 8v5M12 16h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 16v-5M12 8h.01" />
    </>
  ),
  arrow: <path d="M5 12h14M13 6l6 6-6 6" />,
};

export function Icon({
  name,
  className,
}: {
  name: keyof typeof ICON_PATHS;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={name === "arrow" ? 2 : 1.9}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {ICON_PATHS[name]}
    </svg>
  );
}
