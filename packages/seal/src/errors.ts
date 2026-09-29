/** One problem found in a document, envelope or signature. `path` points into the document when relevant. */
export interface Issue {
  code: IssueCode;
  path: string;
  message: string;
}

export type IssueCode =
  | "schema"
  | "line_amount"
  | "subtotal"
  | "tax_rate"
  | "total"
  | "total_zero"
  | "due_before_issue"
  | "early_pay"
  | "chain_mismatch"
  | "signature";

/** Thrown whenever input can't be turned into something safe to sign or pay. Carries every issue found. */
export class SealError extends Error {
  readonly issues: readonly Issue[];

  constructor(message: string, issues: readonly Issue[] = []) {
    super(issues.length === 0 ? message : `${message}: ${issues.map((i) => `${i.path || "(root)"} ${i.message}`).join("; ")}`);
    this.name = "SealError";
    this.issues = issues;
  }
}
