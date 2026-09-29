"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requireMember } from "@/lib/server/access";
import { getConfig } from "@/lib/server/config";
import { getDb } from "@/lib/server/db";
import { AuthError } from "@/lib/server/errors";
import { requireSession } from "@/lib/server/http";
import { BUSINESS_COOKIE } from "@/lib/server/space";

/** Opens one of the person's businesses: checks they belong to it, remembers it, and goes to its screens */
export async function openBusiness(formData: FormData): Promise<void> {
  const id = formData.get("id");
  if (typeof id !== "string") throw new AuthError(400, "Choose a business.");
  const session = await requireSession();
  await requireMember(await getDb(), session.user.id, id);
  (await cookies()).set(BUSINESS_COOKIE, id, { httpOnly: true, secure: getConfig().production, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 365 });
  redirect("/b");
}
