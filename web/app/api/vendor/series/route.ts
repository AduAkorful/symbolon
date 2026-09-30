import { NextResponse } from "next/server";

import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, routeWith } from "@/lib/server/http";
import {
  cancelSeries,
  listSeries,
  prepareSeries,
  submitSeries,
} from "@/lib/server/series";

export const GET = routeWith(async () => {
  const session = await requireSession();
  const db = await getDb();
  const series = await listSeries(db, session.user);
  return NextResponse.json({ series });
});

export const POST = routeWith(async (request) => {
  const session = await requireSession();
  const body = await readBody(request);
  const config = getConfig();
  const db = await getDb();

  if (body.action === "prepare") {
    const res = await prepareSeries(
      db,
      config,
      session.user,
      body.template as any,
      body.schedule as any,
    );
    return NextResponse.json(res);
  }

  if (body.action === "submit") {
    const res = await submitSeries(db, config, session.user, {
      envelopes: body.envelopes,
      periods: body.periods,
      signatures: body.signatures,
      businessId: body.businessId,
      description: body.description,
    });
    return NextResponse.json(res);
  }

  if (body.action === "cancel") {
    const res = await cancelSeries(db, session.user, String(body.seriesId ?? ""));
    return NextResponse.json(res);
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
});
