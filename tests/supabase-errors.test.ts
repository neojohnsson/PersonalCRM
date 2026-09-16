import { describe, expect, it } from "vitest";
import { supabaseError } from "@/lib/supabase/errors";

describe("supabaseError", () => {
  const missingView = {
    code: "PGRST205",
    details: null,
    hint: null,
    message: "Could not find the table 'public.contact_list' in the schema cache",
  };

  it("turns Supabase's error object into a real Error that says what failed", () => {
    const error = supabaseError(missingView, "Couldn't load contacts");

    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe(
      "Couldn't load contacts: Could not find the table 'public.contact_list' in the schema cache (PGRST205)",
    );
  });

  it("keeps the original error attached", () => {
    expect(supabaseError(missingView, "Couldn't load contacts").cause).toBe(missingView);
  });

  it("leaves the code out when there isn't one", () => {
    expect(supabaseError({ message: "Network down" }, "Couldn't load contacts").message).toBe(
      "Couldn't load contacts: Network down",
    );
  });
});
