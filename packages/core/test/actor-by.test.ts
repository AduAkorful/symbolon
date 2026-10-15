import { describe, expect, it } from "vitest";
import { byPhrase, resolveBy } from "../src/actor-by.js";

describe("who a vendor is told acted", () => {
  it("shows the name with the role, and the id only when a name is shown", () => {
    const by = resolveBy({ displayName: "Ama Owusu", role: "owner", vendorVisible: true, userId: "u1" });
    expect(by).toEqual({ byName: "Ama Owusu", byRole: "owner", byUserId: "u1" });
    expect(byPhrase({ ...by, businessName: "Kente Logistics" }, "A business")).toBe("Ama Owusu (owner) at Kente Logistics");
  });
  it("shows the role only with no name or when the person turned it off", () => {
    const none = resolveBy({ displayName: null, role: "owner", vendorVisible: true, userId: "u1" });
    const off = resolveBy({ displayName: "Ama Owusu", role: "approver", vendorVisible: false, userId: "u1" });
    expect(none).toEqual({ byRole: "owner" });
    expect(off).toEqual({ byRole: "approver" });
    expect(byPhrase({ ...none, businessName: "Kente Logistics" }, "A business")).toBe("An owner of Kente Logistics");
    expect(byPhrase({ ...off, businessName: "Kente Logistics" }, "A business")).toBe("An approver of Kente Logistics");
  });
  it("falls back to the business, and strips control and bidi characters from a name", () => {
    expect(byPhrase({}, "A business")).toBe("A business");
    const by = resolveBy({ displayName: "Ama‮ Owusu\u0000", role: null, vendorVisible: true, userId: "u1" });
    expect(by.byName).toBe("Ama Owusu");
  });
  it("never carries an email or wallet", () => {
    const by = resolveBy({ displayName: "Ama", role: "owner", vendorVisible: true, userId: "u1" });
    expect(Object.keys(by).sort()).toEqual(["byName", "byRole", "byUserId"]);
  });
});
