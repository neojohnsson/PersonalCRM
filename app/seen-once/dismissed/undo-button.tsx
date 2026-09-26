"use client";

import { useFormStatus } from "react-dom";
import { undoAndAddAsContact, undoDismissalAction } from "./actions";

/**
 * One row's buttons, in Seen once's styles: "Undo" as the ghost pill, "Undo
 * and add as contact" as the solid one, like "Add as contact" there.
 *
 * Either can take a few seconds — it reads the person's mail from Gmail — so
 * while one is on its way both are disabled, and nothing is sent twice.
 */
export function UndoButtons({ email }: { email: string }) {
  return (
    <form className="ml-auto flex shrink-0 flex-wrap items-center gap-[7px]">
      <Submit action={undoDismissalAction.bind(null, email)} variant="ghost" label={`Undo dismissing ${email}`}>
        Undo
      </Submit>
      <Submit
        action={undoAndAddAsContact.bind(null, email)}
        variant="solid"
        label={`Undo dismissing ${email} and add as contact`}
      >
        Undo and add as contact
      </Submit>
    </form>
  );
}

const BUTTON = {
  ghost: "bg-line-soft text-ink-body hover:bg-chip-track",
  solid: "bg-ink-deep text-white hover:bg-ink/85",
};

function Submit({
  action,
  variant,
  label,
  children,
}: {
  action: () => Promise<void>;
  variant: keyof typeof BUTTON;
  label: string;
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      formAction={action}
      disabled={pending}
      aria-label={label}
      className={`rounded-full px-[14px] py-2 text-xs font-semibold whitespace-nowrap transition-colors disabled:cursor-default disabled:opacity-50 ${BUTTON[variant]}`}
    >
      {children}
    </button>
  );
}
