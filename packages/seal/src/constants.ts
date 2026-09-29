/** EIP-712 domain name and version shared with `InvoiceLedger` (`EIP712("Symbolon", "1")`) */
export const DOMAIN_NAME = "Symbolon";
export const DOMAIN_VERSION = "1";

/** Mirrors `InvoiceLedger.MAX_DISCOUNT_BPS` */
export const MAX_DISCOUNT_BPS = 5_000;
export const BPS_DENOMINATOR = 10_000n;

/** Schema identifier of the canonical invoice document this package reads and writes */
export const DOCUMENT_SCHEMA = "symbolon.invoice.v1";

/** Fraction digits allowed in a line-item quantity */
export const QUANTITY_MAX_DECIMALS = 6;

/** `IERC1271.isValidSignature.selector` */
export const ERC1271_MAGIC_VALUE = "0x1626ba7e";

export const ZERO_BYTES32 = "0x0000000000000000000000000000000000000000000000000000000000000000";
