import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import type { Invoice } from "@/features/invoices/invoices";

// The v1 factory and the receiver implementation it clones, at one address on every chain
// (packages/contracts/deployments.json). Built into the page and never read from the API, so an API that returns
// another factory's address gets no address shown. A new factory needs a new build.
export const FACTORY = "ece745390524e4d0b05d26f56af7f1d38fdb7546";
export const IMPLEMENTATION = "322f6c8daf0a8bd7cf16eb62d0a04700eea4b639";

/** InvoiceTerms in packages/contracts/src/InvoiceTypes.sol, in ABI field order. */
export interface InvoiceTerms {
  invoiceId: string;
  recipient: string;
  token: string;
  amount: bigint;
  expiresAt: bigint;
  settleDeadline: bigint;
  intendedChainId: bigint;
}

// invoice.SettleWindow and the longest expiry the API accepts (internal/invoice).
const SETTLE_WINDOW_S = 86_400n;
const MAX_EXPIRY_S = 365n * 86_400n;
// expiresAt comes from the API's clock and createdAt from the database's.
const CLOCK_SKEW_S = 300n;
const ZERO = "0".repeat(40);

const UINT64_MAX = 2n ** 64n - 1n;
const UINT256_MAX = 2n ** 256n - 1n;

/**
 * The receiver address the factory deploys for these terms, as apps/backend/internal/address does it: a CREATE2 clone
 * (OpenZeppelin Clones.cloneDeterministicWithImmutableArgs) with args = abi.encode(terms) and salt = keccak256(args).
 * Lower-case hex. Throws on a term outside its type.
 */
export function receiveAddress(t: InvoiceTerms): string {
  const args = [
    fixedBytes(t.invoiceId, 32),
    fixedBytes(t.recipient, 20),
    fixedBytes(t.token, 20),
    uint(t.amount, UINT256_MAX),
    uint(t.expiresAt, UINT64_MAX),
    uint(t.settleDeadline, UINT64_MAX),
    uint(t.intendedChainId, UINT256_MAX),
  ].join("");
  // Clones._cloneCodeWithImmutableArgs: 0x61 <uint16 len(args)+0x2d> <prefix> <implementation> <suffix> <args>.
  const size = (args.length / 2 + 0x2d).toString(16).padStart(4, "0");
  const code = `61${size}3d81600a3d39f3363d3d373d3d3d363d73${IMPLEMENTATION}5af43d82803e903d91602b57fd5bf3${args}`;
  // CREATE2: keccak256(0xff ++ factory ++ salt ++ keccak256(init code))[12:].
  return `0x${keccak(`ff${FACTORY}${keccak(args)}${keccak(code)}`).slice(24)}`;
}

/**
 * The invoice's receive address when the answer is the invoice the link names, its terms (the shown option's, with
 * that option's on-chain id) follow the rules the API
 * creates them by (money sent to terms that break them can only be refunded), and they compute to it; or null. Null
 * means the page must not show it: the API answer was changed somewhere, or a term can't be read (a term that can't
 * be read can't prove the address).
 */
export function checkedReceiveAddress(inv: Invoice, linkInvoiceId: string): string | null {
  if (inv.invoiceId.toLowerCase() !== linkInvoiceId.toLowerCase()) return null;
  try {
    const terms = {
      invoiceId: inv.optionId,
      recipient: inv.recipient,
      token: inv.token,
      amount: BigInt(inv.amount),
      expiresAt: unixSeconds(inv.expiresAt),
      settleDeadline: unixSeconds(inv.settleDeadline),
      intendedChainId: BigInt(inv.chainId),
    };
    const recipient = terms.recipient.toLowerCase().replace(/^0x/, "");
    const invalid =
      terms.amount <= 0n ||
      terms.settleDeadline !== terms.expiresAt + SETTLE_WINDOW_S ||
      terms.expiresAt > unixSeconds(inv.createdAt) + MAX_EXPIRY_S + CLOCK_SKEW_S ||
      [ZERO, terms.token.toLowerCase().replace(/^0x/, ""), FACTORY, IMPLEMENTATION].includes(
        recipient,
      );
    if (invalid) return null;
    const address = receiveAddress(terms);
    return address === inv.receiveAddress.toLowerCase() ? address : null;
  } catch {
    return null;
  }
}

function keccak(hex: string): string {
  return bytesToHex(keccak_256(hexToBytes(hex)));
}

/** A left-padded ABI word. */
function uint(n: bigint, max: bigint): string {
  if (n < 0n || n > max) throw new RangeError(`${n} is out of range`);
  return n.toString(16).padStart(64, "0");
}

/** An address or bytes32 as an ABI word: exactly `size` bytes of hex. */
function fixedBytes(hex: string, size: number): string {
  if (!new RegExp(`^0x[0-9a-fA-F]{${size * 2}}$`).test(hex))
    throw new RangeError(`${hex} is not ${size} bytes`);
  return hex.slice(2).toLowerCase().padStart(64, "0");
}

/** The API's RFC 3339 time (whole seconds) as Unix seconds. */
function unixSeconds(time: string): bigint {
  const ms = Date.parse(time);
  if (!Number.isInteger(ms) || ms % 1000 !== 0)
    throw new RangeError(`${time} is not a whole-second time`);
  return BigInt(ms / 1000);
}
