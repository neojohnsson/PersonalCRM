/** Where Google sends the browser back to after the Gmail consent screen. */
export const GOOGLE_CALLBACK_PATH = "/api/auth/google/callback";

/**
 * The full callback address, on whatever address the app is running:
 *
 *   http://localhost:3000/api/auth/google/callback
 *   https://personal-crm-git-slice-1-sync-….vercel.app/api/auth/google/callback
 *   https://personal-crm-delta-lemon.vercel.app/api/auth/google/callback
 *
 * Built from the request instead of a GOOGLE_REDIRECT_URI setting, because
 * that setting has to differ for every address — and on 2026-09-15 a preview
 * build picked up the Production value and sent Google back to the wrong app.
 *
 * Still safe: Google only redirects to addresses listed under Authorised
 * redirect URIs in Google Cloud, so a request can't steer it anywhere else.
 * The consent route and the callback must send the exact same value, which
 * is why both call this.
 */
export function googleCallbackUrl(request: { url: string }): string {
  return new URL(GOOGLE_CALLBACK_PATH, request.url).toString();
}
