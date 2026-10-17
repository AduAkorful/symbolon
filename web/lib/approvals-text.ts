/**
 * Why "Coming up that need your sign-off" is empty in Autonomous mode (QA STW-2, retest 17). An invoice is listed there only when a
 * sign-off is the one thing in its way; say how many are paid without one and how many wait on something else, so an empty list
 * reads as a finding, not a fault.
 */
export function emptySignoffNote(n: { count: number; autoPayOnDue: number; signoffAndMore: number }): string {
  const plural = (k: number, one: string, many: string) => (k === 1 ? one : many);
  const parts = ["Nothing needs signing ahead: an invoice is listed under “Coming up that need your sign-off” only when a sign-off is the one thing in its way."];
  if (n.autoPayOnDue > 0) {
    parts.push(`${n.autoPayOnDue} ${plural(n.autoPayOnDue, "invoice is", "invoices are")} within the auto-pay rules, so the Steward pays ${plural(n.autoPayOnDue, "it", "them")} on the due date without a sign-off.`);
  }
  const other = n.count - n.autoPayOnDue;
  if (other > 0) {
    const who = n.autoPayOnDue > 0 ? `The other ${other} ${plural(other, "is", "are")}` : other === 1 ? "It is" : `All ${other} are`;
    const also = n.signoffAndMore > 0 ? ` ${n.signoffAndMore} of them will also need a sign-off once that is cleared.` : "";
    parts.push(`${who} held back by something else first (listed above).${also}`);
  }
  return parts.join(" ");
}
