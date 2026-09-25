/**
 * Every outside service that receives data from this app (slice 13, commit 6;
 * docs/slice-13-plan.md §5). One list, read by /sub-processors and
 * /privacy-policy, and checked by tests/legal.test.ts against the hosts the
 * code actually calls: a new service cannot be added without landing here.
 *
 * Where, as checked 2026-09-25: Supabase from the project's own settings
 * (eu-west-1); Vercel's default function region, since the project sets none;
 * the others from their own documentation. Verify before launch.
 */

export type SubProcessor = {
  name: string;
  role: string;
  gets: string;
  where: string;
  /** Hosts the code calls for this service, for the test. */
  hosts: string[];
};

export const SUB_PROCESSORS: SubProcessor[] = [
  {
    name: "Supabase",
    role: "The database, and signing in",
    gets: "Everything the app stores: your account, your contacts, message details (never message bodies), summaries, notes, your plan.",
    where: "Ireland (AWS eu-west-1)",
    hosts: ["supabase.co"],
  },
  {
    name: "Vercel",
    role: "Runs the app's pages and server code",
    gets: "Each request as it passes through: pages, your actions, and the text of a message while a summary or draft is being made. Nothing is stored there.",
    where: "United States (Washington, D.C., Vercel's default); to be moved to Dublin, next to the database, before launch",
    hosts: ["vercel.app"],
  },
  {
    name: "Google",
    role: "Sign-in, Gmail and Google Calendar",
    gets: "Already holds your mail and calendar. The app reads them on your permission, writes drafts into Gmail, and creates events you press Create for, never with guests.",
    where: "Google's data centres, including the United States",
    hosts: ["googleapis.com", "accounts.google.com", "mail.google.com"],
  },
  {
    name: "OpenAI",
    role: "The AI: summaries, drafts, promise scans, the Assistant, web research",
    gets: "Only when you press for it: the messages that one request needs, with the contact's name and addresses; for web research, the contact's name, company and work email domain. Not used for training; kept up to 30 days for abuse monitoring.",
    where: "United States",
    hosts: ["api.openai.com"],
  },
  {
    name: "Stripe (and Link, its reseller)",
    role: "Payments. Link is the seller of the paid plans (Managed Payments)",
    gets: "Your name, email address, billing address and card, typed on Stripe's page, never on ours. The app keeps only Stripe's ids for you, your plan and when it is paid until.",
    where: "Ireland and the United States",
    hosts: ["stripe.com"],
  },
];
