import { NextResponse } from "next/server";

import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, routeWith } from "@/lib/server/http";
import {
  listOffersForInvoice,
  prepareOffer,
  submitOffer,
  suggestedDiscount,
  withdrawOffer,
} from "@/lib/server/offers";
import { requireMySeal } from "@/lib/server/vendor";

export const GET = routeWith(async (request) => {
  await requireSession();
  const db = await getDb();
  const url = new URL(request.url);
  const fingerprint = url.searchParams.get("fingerprint");

  if (!fingerprint) {
    return NextResponse.json({ error: "Missing fingerprint query param." }, { status: 400 });
  }

  const offers = await listOffersForInvoice(db, fingerprint);
  return NextResponse.json({ offers });
});

export const POST = routeWith(async (request) => {
  const session = await requireSession();
  const body = await readBody(request);
  const config = getConfig();
  const db = await getDb();
  const client = getClient();

  if (body.action === "prepare") {
    const res = await prepareOffer(
      db,
      client,
      config,
      session.user,
      body.fingerprint,
      body.discountBps,
      body.durationSeconds,
    );
    return NextResponse.json(res);
  }

  if (body.action === "submit") {
    const res = await submitOffer(db, client, config, session.user, {
      fingerprint: body.fingerprint,
      discountBps: body.discountBps,
      validUntil: body.validUntil,
      signature: body.signature,
    });
    return NextResponse.json(res);
  }

  if (body.action === "withdraw") {
    const res = await withdrawOffer(db, session.user, String(body.offerId ?? ""));
    return NextResponse.json(res);
  }

  if (body.action === "suggested") {
    const seal = await requireMySeal(db, session.user.id);
    const res = await suggestedDiscount(db, seal.address);
    return NextResponse.json({ suggested: res });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
});
