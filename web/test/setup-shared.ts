import { beforeEach, vi } from "vitest";

function fn() {
  return vi.fn();
}

type ChainState = {
  getBlockNumber: ReturnType<typeof fn>;
  readContract: ReturnType<typeof fn>;
  getVaultState: ReturnType<typeof fn>;
  getBudget: ReturnType<typeof fn>;
  reserveStatus: ReturnType<typeof fn>;
  previewDepositData: ReturnType<typeof fn>;
  subscriptionLimitRemaining: ReturnType<typeof fn>;
  todayTimestamp: ReturnType<typeof fn>;
  previewRedeemData: ReturnType<typeof fn>;
  redemptionLimitRemaining: ReturnType<typeof fn>;
  getTransactionReceipt: ReturnType<typeof fn>;
  oracleLatestRoundData: ReturnType<typeof fn>;
  oracleGetRoundData: ReturnType<typeof fn>;
  isApprover: ReturnType<typeof fn>;
  getPolicy: ReturnType<typeof fn>;
  call: ReturnType<typeof fn>;
  getPayee: ReturnType<typeof fn>;
  getBlock: ReturnType<typeof fn>;
  queuedChangeEta: ReturnType<typeof fn>;
  getTransaction: ReturnType<typeof fn>;
  waitForTransactionReceipt: ReturnType<typeof fn>;
  getPurchaseOrder: ReturnType<typeof fn>;
  isRequester: ReturnType<typeof fn>;
  deliveryConfirmed: ReturnType<typeof fn>;
  invoiceStatus: ReturnType<typeof fn>;
  ledgerStatus: ReturnType<typeof fn>;
  remaining: ReturnType<typeof fn>;
  fingerprint: ReturnType<typeof fn>;
  balanceOf: ReturnType<typeof fn>;
  previewSubscribe: ReturnType<typeof fn>;
  previewRedeem: ReturnType<typeof fn>;
  reserveYield: ReturnType<typeof fn>;
  scanLogs: ReturnType<typeof fn>;
  approverBudgetCount: ReturnType<typeof fn>;
  localDomain: ReturnType<typeof fn>;
};

type Bag = { double: { enabled: boolean }; state: ChainState };

const persist = globalThis as typeof globalThis & { __symbolonChain?: Bag };

function makeState(): ChainState {
  return {
    getBlockNumber: fn(),
    readContract: fn(),
    getVaultState: fn(),
    getBudget: fn(),
    reserveStatus: fn(),
    previewDepositData: fn(),
    subscriptionLimitRemaining: fn(),
    todayTimestamp: fn(),
    previewRedeemData: fn(),
    redemptionLimitRemaining: fn(),
    getTransactionReceipt: fn(),
    oracleLatestRoundData: fn(),
    oracleGetRoundData: fn(),
    isApprover: fn(),
    getPolicy: fn(),
    call: fn(),
    getPayee: fn(),
    getBlock: fn(),
    queuedChangeEta: fn(),
    getTransaction: fn(),
    waitForTransactionReceipt: fn(),
    getPurchaseOrder: fn(),
    isRequester: fn(),
    deliveryConfirmed: fn(),
    invoiceStatus: fn(),
    ledgerStatus: fn(),
    remaining: fn(),
    fingerprint: fn(),
    balanceOf: fn(),
    previewSubscribe: fn(),
    previewRedeem: fn(),
    reserveYield: fn(),
    scanLogs: fn(),
    approverBudgetCount: fn(),
    localDomain: fn(),
  };
}

persist.__symbolonChain ??= { double: { enabled: false }, state: makeState() };

/** One chain double for the shared (isolate:false) project. Files that need it set `chainDouble.enabled`. */
export const chainDouble = persist.__symbolonChain.double;
export const chainState = persist.__symbolonChain.state;

function contracts() {
  return {
    lens: {
      read: {
        getVaultState: chainState.getVaultState,
        getBudget: chainState.getBudget,
        reserveStatus: chainState.reserveStatus,
        isApprover: chainState.isApprover,
        getPolicy: chainState.getPolicy,
        getPayee: chainState.getPayee,
        queuedChangeEta: chainState.queuedChangeEta,
        getPurchaseOrder: chainState.getPurchaseOrder,
        isRequester: chainState.isRequester,
        deliveryConfirmed: chainState.deliveryConfirmed,
        approverBudgetCount: chainState.approverBudgetCount,
      },
    },
    teller: {
      read: {
        todayTimestamp: chainState.todayTimestamp,
        subscriptionLimitRemaining: chainState.subscriptionLimitRemaining,
        redemptionLimitRemaining: chainState.redemptionLimitRemaining,
        previewDepositData: chainState.previewDepositData,
        previewRedeemData: chainState.previewRedeemData,
      },
    },
    ledger: {
      read: {
        status: chainState.ledgerStatus,
        remaining: chainState.remaining,
        invoiceStatus: chainState.invoiceStatus,
        localDomain: chainState.localDomain,
        fingerprint: chainState.fingerprint,
      },
    },
    token: () => ({ read: { balanceOf: chainState.balanceOf } }),
  };
}

vi.mock("@symbolon/chain", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@symbolon/chain")>();
  if (process.env.LIVE) return actual;
  return {
    ...actual,
    symbolonContracts: (...args: Parameters<typeof actual.symbolonContracts>) =>
      chainDouble.enabled ? contracts() : actual.symbolonContracts(...args),
    previewSubscribe: (...args: Parameters<typeof actual.previewSubscribe>) =>
      chainDouble.enabled ? chainState.previewSubscribe(...args) : actual.previewSubscribe(...args),
    previewRedeem: (...args: Parameters<typeof actual.previewRedeem>) =>
      chainDouble.enabled ? chainState.previewRedeem(...args) : actual.previewRedeem(...args),
    reserveYield: (...args: Parameters<typeof actual.reserveYield>) =>
      chainDouble.enabled ? chainState.reserveYield(...args) : actual.reserveYield(...args),
    scanLogs: (...args: Parameters<typeof actual.scanLogs>) =>
      chainDouble.enabled ? chainState.scanLogs(...args) : actual.scanLogs(...args),
    invoiceStatus: (...args: Parameters<typeof actual.invoiceStatus>) =>
      chainDouble.enabled ? chainState.invoiceStatus(...args) : actual.invoiceStatus(...args),
  };
});

beforeEach(() => {
  chainDouble.enabled = false;
  for (const value of Object.values(chainState)) value.mockReset();
  chainState.localDomain.mockResolvedValue(26);
});
