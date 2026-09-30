import type { Address } from "viem";

export interface ChangeKindDef {
  kind: string;
  functionName: string;
  appliedEvent: string;
  describe(args: readonly unknown[]): { title: string; details?: Record<string, unknown> };
}

export const GATED_FUNCTION_NAMES = [
  "setPolicy",
  "setBudget",
  "updatePayeeTerms",
  "setApprover",
  "setRequester",
  "setScreener",
  "setSteward",
  "setSupportedToken",
  "setAutoUpdate",
  "setReservePolicy",
] as const;

export type GatedFunctionName = (typeof GATED_FUNCTION_NAMES)[number];

export const CHANGE_KINDS: Record<GatedFunctionName, ChangeKindDef> = {
  setPolicy: {
    kind: "set_policy",
    functionName: "setPolicy",
    appliedEvent: "PolicySet",
    describe([policy]: readonly unknown[]) {
      const p = policy as {
        perTxCap?: bigint;
        autoPayLimit?: bigint;
        ownerThreshold?: bigint;
        looseningDelay?: bigint;
      };
      return {
        title: "Update vault policy",
        details: {
          perTxCap: p?.perTxCap?.toString(),
          autoPayLimit: p?.autoPayLimit?.toString(),
          ownerThreshold: p?.ownerThreshold?.toString(),
          looseningDelay: p?.looseningDelay?.toString(),
        },
      };
    },
  },
  setBudget: {
    kind: "set_budget",
    functionName: "setBudget",
    appliedEvent: "BudgetSet",
    describe([id, budget]: readonly unknown[]) {
      const b = budget as { cap?: bigint; periodLength?: bigint };
      return {
        title: "Set budget",
        details: {
          budgetId: String(id),
          cap: b?.cap?.toString(),
          periodLength: b?.periodLength?.toString(),
        },
      };
    },
  },
  updatePayeeTerms: {
    kind: "update_payee_terms",
    functionName: "updatePayeeTerms",
    appliedEvent: "PayeeTermsUpdated",
    describe([seal, terms]: readonly unknown[]) {
      const t = terms as {
        budget?: string;
        requirePo?: boolean;
        requireDelivery?: boolean;
        monthlyCap?: bigint;
      };
      return {
        title: `Update payee terms for ${seal}`,
        details: {
          seal: String(seal),
          budget: t?.budget,
          requirePo: t?.requirePo,
          requireDelivery: t?.requireDelivery,
          monthlyCap: t?.monthlyCap?.toString(),
        },
      };
    },
  },
  setApprover: {
    kind: "set_approver",
    functionName: "setApprover",
    appliedEvent: "ApproverSet",
    describe([account, budgetId, enabled]: readonly unknown[]) {
      return {
        title: `${enabled ? "Grant" : "Revoke"} approver role for ${account}`,
        details: {
          account: String(account),
          budgetId: String(budgetId),
          enabled: Boolean(enabled),
        },
      };
    },
  },
  setRequester: {
    kind: "set_requester",
    functionName: "setRequester",
    appliedEvent: "RequesterSet",
    describe([account, enabled]: readonly unknown[]) {
      return {
        title: `${enabled ? "Grant" : "Revoke"} requester role for ${account}`,
        details: {
          account: String(account),
          enabled: Boolean(enabled),
        },
      };
    },
  },
  setScreener: {
    kind: "set_screener",
    functionName: "setScreener",
    appliedEvent: "ScreenerSet",
    describe([newScreener]: readonly unknown[]) {
      return {
        title: `Set compliance screener to ${newScreener}`,
        details: {
          screener: String(newScreener),
        },
      };
    },
  },
  setSteward: {
    kind: "set_steward",
    functionName: "setSteward",
    appliedEvent: "StewardSet",
    describe([newSteward]: readonly unknown[]) {
      return {
        title: `Set steward wallet to ${newSteward}`,
        details: {
          steward: String(newSteward),
        },
      };
    },
  },
  setSupportedToken: {
    kind: "set_supported_token",
    functionName: "setSupportedToken",
    appliedEvent: "SupportedTokenSet",
    describe([token, supported]: readonly unknown[]) {
      return {
        title: `${supported ? "Enable" : "Disable"} token ${token}`,
        details: {
          token: String(token),
          supported: Boolean(supported),
        },
      };
    },
  },
  setAutoUpdate: {
    kind: "set_auto_update",
    functionName: "setAutoUpdate",
    appliedEvent: "AutoUpdateSet",
    describe([enabled]: readonly unknown[]) {
      return {
        title: `${enabled ? "Enable" : "Disable"} opt-in auto updates`,
        details: {
          enabled: Boolean(enabled),
        },
      };
    },
  },
  setReservePolicy: {
    kind: "set_reserve_policy",
    functionName: "setReservePolicy",
    appliedEvent: "ReservePolicySet",
    describe([policy]: readonly unknown[]) {
      const p = policy as {
        enabled?: boolean;
        maxReserveBps?: number;
        minOperating?: bigint;
      };
      return {
        title: `${p?.enabled ? "Update" : "Disable"} USYC reserve policy`,
        details: {
          enabled: Boolean(p?.enabled),
          maxReserveBps: p?.maxReserveBps,
          minOperating: p?.minOperating?.toString(),
        },
      };
    },
  },
};

export function getChangeKindByFunctionName(fn: string): ChangeKindDef | undefined {
  return CHANGE_KINDS[fn as GatedFunctionName];
}

export function getChangeKindByKindName(kind: string): ChangeKindDef | undefined {
  return Object.values(CHANGE_KINDS).find((d) => d.kind === kind);
}
