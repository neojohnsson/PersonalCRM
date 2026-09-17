"use server";

import { requireUser } from "@/lib/auth";
import { parseProfileForm, type Profile, type ProfileErrors } from "@/lib/profile/profile";
import { saveProfile } from "@/lib/profile/store";
import { createClient } from "@/lib/supabase/server";

/**
 * Save the Profile form. It's sent automatically as you edit (see
 * profile-form.tsx), and like every Server Action it checks the user itself:
 * anyone can POST to it. RLS on `profiles` keeps it to the caller's own row.
 */

export type ProfileState = {
  profile: Profile;
  errors: ProfileErrors;
  /** When it was last saved, or null if never. */
  savedAt: string | null;
};

export async function saveProfileAction(previous: ProfileState, formData: FormData): Promise<ProfileState> {
  const user = await requireUser();

  const parsed = parseProfileForm(formData);
  if (!parsed.ok) return { profile: parsed.profile, errors: parsed.errors, savedAt: previous.savedAt };

  const saved = await saveProfile(await createClient(), user.id, parsed.profile);
  return { profile: parsed.profile, errors: {}, savedAt: saved.updated_at };
}
