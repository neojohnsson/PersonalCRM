/** The green tick of the design's strip; grey once it has been undone. */
export function DoneMark({ undone }: { undone: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`size-[15px] shrink-0 ${undone ? "text-ink-soft" : "text-affirm"}`}
    >
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}
