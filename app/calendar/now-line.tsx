"use client";

import { useEffect, useState } from "react";
import { nowPercent } from "@/lib/calendar/week";

/**
 * A line across today's column at the current time (UI quality pass,
 * milestone 6): a page whose whole job is today had no mark for now. It moves
 * once a minute, and is not there before 08:00 or after 18:00, where the grid
 * has no hours to put it in. Decoration: the times are all written out.
 */
export function NowLine() {
  const [percent, setPercent] = useState<number | null>(null);

  useEffect(() => {
    const place = () => setPercent(nowPercent(new Date()));
    place();
    const timer = setInterval(place, 60_000);
    return () => clearInterval(timer);
  }, []);

  if (percent === null) return null;
  return (
    <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 z-10 h-0.5 bg-accent" style={{ top: `${percent}%` }}>
      <span className="absolute -top-[3px] -left-[4px] size-2 rounded-full bg-accent" />
    </span>
  );
}
