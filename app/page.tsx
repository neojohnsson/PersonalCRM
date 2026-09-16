import { redirect } from "next/navigation";

/**
 * Home becomes "Who needs you today" (design/Main.dc.html) in slice 3, step 7
 * (docs/slice-3-plan.md, decision C). Until it's built, home sends you to the
 * contact list, which now lives at /contacts.
 */
export default function Home() {
  redirect("/contacts");
}
