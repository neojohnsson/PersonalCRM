import { AiNotConfigured, aiConfig, assistantModel, assistantMonthlyCapUsd } from "@/lib/ai/config";
import { hasAssistant } from "@/lib/assistant/entitlement";
import { converse } from "@/lib/assistant/converse";
import { parseHistory } from "@/lib/assistant/history";
import { requireUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/**
 * POST /api/assistant — one turn of the conversation, streamed
 * (docs/slice-11-plan.md §5).
 *
 * A route handler rather than a Server Action, because a Server Action answers
 * once and this has to answer as it goes: each step the Assistant takes —
 * looking something up, doing one of the five things, putting a card in front
 * of you — is sent the moment it happens, one JSON object per line.
 *
 * What it takes, and why it is checked so closely: the browser keeps the
 * conversation (nothing about it is stored here) and sends it back each turn.
 * That makes every word of it untrusted input, so:
 *
 *   - only "user" and "assistant" roles. A page that could send "system" or
 *     "developer" could rewrite the Assistant's instructions
 *   - at most 40 messages of 4,000 characters, and the last must be yours
 *   - you must be signed in AND have the Assistant: the same two checks as
 *     the page, because a POST does not come through the page
 */

// A turn is up to eight model calls; give it room to finish on Vercel.
export const maxDuration = 120;

export async function POST(request: Request) {
  const user = await requireUser();
  const supabase = await createClient();
  if (!(await hasAssistant(supabase, user.id))) {
    return Response.json({ error: "The Assistant isn't part of this account." }, { status: 403 });
  }

  let apiKey: string;
  let model: string;
  try {
    apiKey = aiConfig().apiKey;
    model = assistantModel();
  } catch (failure) {
    if (failure instanceof AiNotConfigured) return Response.json({ error: failure.message }, { status: 503 });
    throw failure;
  }

  const history = parseHistory(await request.json().catch(() => null));
  if (!history) {
    return Response.json({ error: "That isn't a conversation this page could have sent." }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: unknown) => controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
      try {
        for await (const event of converse({
          db: supabase,
          userId: user.id,
          apiKey,
          model,
          history,
          monthlyCapUsd: assistantMonthlyCapUsd(),
        })) {
          send(event);
        }
      } catch (failure) {
        // Logged for the server; the page gets a sentence, never a stack.
        console.error("[assistant] a turn failed", failure);
        send({ type: "stopped", reason: "Something went wrong on the server. Nothing more was done." });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  });
}
