import type { Metadata } from "next";
import { Plus_Jakarta_Sans } from "next/font/google";
import "./globals.css";
import { APP_NAME } from "@/lib/app-config";
import { THEME_COLOR } from "@/lib/theme";

const jakarta = Plus_Jakarta_Sans({
  variable: "--font-jakarta",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description:
    "Imports the people you actually talk to from Gmail, and tells you who is waiting on you.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${jakarta.variable} h-full antialiased`}
      // The theme script below sets data-theme before React loads, so the
      // server's <html> has no theme and the browser's has one. That is on
      // purpose -- it stops a flash of the wrong theme -- and this silences
      // the hydration warning for this one element's attributes only.
      suppressHydrationWarning
    >
      <head>
        {/* The phone's browser bar in the page's colour; the script below
            switches it to Night's when that is the saved theme. */}
        <meta name="theme-color" content={THEME_COLOR.paper} />
        {/* Before anything paints: the saved theme, if there is one. In a
            try, because some private windows throw on localStorage -- then
            the page is simply Paper. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(() => { try { const saved = localStorage.getItem("personal-crm-theme"); if (saved === "paper" || saved === "night") { document.documentElement.dataset.theme = saved; const bar = document.querySelector('meta[name="theme-color"]'); if (bar) bar.setAttribute("content", ${JSON.stringify(THEME_COLOR)}[saved]); } } catch {} })()`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
