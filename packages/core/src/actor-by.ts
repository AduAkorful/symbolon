/**
 * Who a vendor is told acted (plan 05zt). A vendor never sees an email or wallet: the person's chosen name when they allow it,
 * always with the role the system assigned and the business's name, so a self-chosen name can't stand alone.
 */
export type ByRole = "owner" | "approver" | "requester" | "viewer";
export interface ByInput {
  displayName: string | null;
  role: ByRole | null;
  vendorVisible: boolean;
  userId: string;
}
export interface ByFields {
  byName?: string;
  byRole?: ByRole;
  /** present only when the name is shown, so the picture is never drawn without a name beside it */
  byUserId?: string;
}

const clean = (s: string) => s.replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "").trim();

export function resolveBy(input: ByInput): ByFields {
  const name = input.vendorVisible && input.displayName ? clean(input.displayName).slice(0, 80) : "";
  return {
    ...(name ? { byName: name, byUserId: input.userId } : {}),
    ...(input.role ? { byRole: input.role } : {}),
  };
}

const ROLE_WORD: Record<ByRole, string> = { owner: "owner", approver: "approver", requester: "team member", viewer: "team member" };

/** "Ama Owusu (owner) at Kente Logistics", "An owner of Kente Logistics", or just the business when nothing is known */
export function byPhrase(body: Record<string, unknown>, businessFallback: string): string {
  const business = typeof body.businessName === "string" && body.businessName ? body.businessName : businessFallback;
  const role = typeof body.byRole === "string" && body.byRole in ROLE_WORD ? ROLE_WORD[body.byRole as ByRole] : null;
  const name = typeof body.byName === "string" && body.byName ? body.byName : null;
  if (name && role) return `${name} (${role}) at ${business}`;
  if (name) return `${name} at ${business}`;
  if (role) return `${/^[aeiou]/.test(role) ? "An" : "A"} ${role} of ${business}`;
  return business;
}
