import { NextResponse } from "next/server";

import { getClient } from "@/lib/server/chain";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { readBody, requireSession, routeWith } from "@/lib/server/http";
import {
  prepareVendorPayoutChange,
  submitVendorPayoutChange,
} from "@/lib/server/payout-change";

export const POST = routeWith(async (request) => {
  const session = await requireSession();
  const body = await readBody(request);
  const config = getConfig();
  const db = await getDb();
  const client = getClient();

  if (body.action === "prepare") {
    const res = await prepareVendorPayoutChange(db, client, config, session.user, {
      newPayout: body.newPayout,
      payoutDomain: body.payoutDomain,
    });
    return NextResponse.json(res);
  }

  if (body.action === "submit") {
    const res = await submitVendorPayoutChange(db, client, config, session.user, {
      newPayout: body.newPayout,
      payoutDomain: body.payoutDomain,
      nonce: body.nonce,
      signature: body.signature,
    });
    return NextResponse.json(res);
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
});
