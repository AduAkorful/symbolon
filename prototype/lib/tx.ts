/**
 * Onchain references in the prototype. All of these are demo values except release 2's upgrade, which is the real
 * testnet upgrade of the Vault the prototype uses as Acme's. In the app every one of them links to the explorer.
 */
export const EXPLORER = "https://explorer.testnet.arc.io";

export const tx = {
  // Acme's Vault
  createVault: "0x1c88…d3f5",
  fund: "0x6a02…9be1",
  deposit: "0x3f4a…b7d6",
  pause: "0xb5f3…0c17",
  resume: "0x39ce…a64d",
  policyQueue: "0x84d9…12fa",
  policyApply: "0x7b19…e5c0",
  policyCancel: "0xc10a…8d92",
  payeeAdd: "0xf49b…3e06",
  payoutConfirm: "0x5a7c…e1d4",
  payoutCancel: "0x0d83…b5a9",
  autoUpdateQueue: "0x93e1…7a2c",
  upgradeSchedule: "0xa7c5…40de",
  upgradeApply: "0x68fb…d193",
  releaseTwo: "0x8d05…5e94",
  stewardKey: "0x5c04…be71",
  payeeRetire: "0x9e27…1d5a",
  testPayment: "0x0b6d…7f12",
  ownerTransfer: "0x2b60…c4f8",
  // Payments and reserve moves
  payAna: "0x4b7e…a91c",
  payAnaOct: "0x2c19…7d40",
  payAnaEarly: "0x8a15…6be3",
  sweep: "0x91d0…3b7e",
  redeem: "0xe2a4…58b0",
  convert: "0x17e9…c0a5",
  withdraw: "0xd350…9a1f",
  payNorthwind: "0x7d31…c2e8",
  anchor211: "0xd6b2…4f70",
} as const;

/** The Vault the prototype uses as Acme's (the real testnet Vault's short address) */
export const VAULT_ADDRESS = "0x5f5e…2984";
