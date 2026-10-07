import { NextResponse } from "next/server";
import { askSteward } from "@/lib/server/ask";
import { readBody, requireSession, routeWith } from "@/lib/server/http";

export const maxDuration = 30;

export const POST = routeWith<{ params: Promise<{ id: string }> }>(async (request, { params }) => {
  const session = await requireSession();
  const { id: businessId } = await params;
  const body = await readBody(request);

  const answer = await askSteward({
    businessId,
    userId: session.user.id,
    question: typeof body.question === "string" ? body.question : undefined,
    intent: typeof body.intent === "string" ? body.intent : undefined,
    history: body.history,
    params: typeof body.params === "object" && body.params !== null ? (body.params as Record<string, unknown>) : undefined,
  });

  return NextResponse.json({ ok: true, answer });
});
