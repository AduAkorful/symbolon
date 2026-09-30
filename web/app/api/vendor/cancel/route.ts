import { NextResponse } from "next/server";

import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import {
  prepareCancel,
  recordCancelled,
  submitCancel,
} from "@/lib/server/cancel-credit";
import { AuthError } from "@/lib/server/errors";
import { readBody, requireSession, routeWith } from "@/lib/server/http";

export const POST = routeWith(async (request) => {
  const session = await requireSession();
  const body = await readBody(request);
  const config = getConfig();
  const db = await getDb();
  const client = getClient();

  if (body.action === "prepare") {
    const res = await prepareCancel(
      db,
      client,
      config,
      session.user,
      body.fingerprint,
    );
    return NextResponse.json(res);
  }

  if (body.action === "submit") {
    const res = await submitCancel(
      db,
      client,
      config,
      session.user,
      {
        fingerprint: body.fingerprint,
        signature: body.signature,
      },
    );
    return NextResponse.json(res);
  }

  if (body.action === "record") {
    if (typeof body.txHash !== "string" || !/^0x[0-9a-fA-F]+$/.test(body.txHash)) {
      throw new AuthError(400, "Valid txHash is required.");
    }
    const res = await recordCancelled(
      db,
      client,
      config,
      session.user,
      {
        requestId: String(body.requestId ?? ""),
        txHash: body.txHash as `0x${string}`,
      },
    );
    return NextResponse.json(res);
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
});
