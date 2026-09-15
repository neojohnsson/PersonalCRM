import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { config } from "dotenv";

// Tests run against the real Supabase project, so they need the same
// credentials the app uses. .env.local is gitignored and stays that way.
config({ path: ".env.local" });

export default defineConfig({
  resolve: {
    alias: {
      // Same "@/..." alias as tsconfig.json, so tests import the way the app does.
      "@": fileURLToPath(new URL(".", import.meta.url)),
      // `import "server-only"` throws anywhere but a React server bundle, so
      // tests of server code (lib/google/tokens.ts) point it at the package's
      // own empty file — the same thing Next.js resolves it to on the server.
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // RLS tests create users and hit the network. The default 5s is tight.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    // One file at a time: these tests share real database state.
    fileParallelism: false,
  },
});
