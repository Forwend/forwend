import { keccak_256 } from "@noble/hashes/sha3.js";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils.js";
import type { Invoice } from "@/features/invoices/types/invoices";
import { FACTORY, IMPLEMENTATION } from "@/features/pay/constants/receive-address";
import type { InvoiceTerms } from "@/features/pay/types/receive-address";

// invoice.SettleWindow and the longest expiry the API accepts (internal/invoice).
const SETTLE_WINDOW_S = 86_400n;
const MAX_EXPIRY_S = 365n * 86_400n;
// expiresAt comes from the API's clock and createdAt from the database's.
const CLOCK_SKEW_S = 300n;
const ZERO = "0".repeat(40);

const UINT64_MAX = 2n ** 64n - 1n;
const UINT256_MAX = 2n ** 256n - 1n;

// As apps/backend/internal/address: a CREATE2 clone (OpenZeppelin Clones.cloneDeterministicWithImmutableArgs)
// with args = abi.encode(terms) and salt = keccak256(args). Throws on a term outside its type.
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

/** As the API derives it (D-86): keccak256(token); throws on a token that is not 32 bytes of hex. */
export function invoiceIdOf(payToken: string): string {
  return `0x${keccak(fixedBytes(`0x${payToken}`, 32))}`;
}

/** As the API derives it (R-56): keccak256(abi.encode(invoice id, chain id, token)). */
export function optionIdOf(invoiceId: string, chainId: bigint, token: string): string {
  return `0x${keccak(fixedBytes(invoiceId, 32) + uint(chainId, UINT256_MAX) + fixedBytes(token, 20))}`;
}

// Null means the page must not show the address: the answer isn't the link's invoice, breaks the API's
// rules for terms (money sent there could only be refunded), or doesn't compute to it.
export function checkedReceiveAddress(inv: Invoice, payToken: string): string | null {
  try {
    if (inv.invoiceId.toLowerCase() !== invoiceIdOf(payToken)) return null;
    // The shown option is the invoice's own terms or an option derived from the link's id, never another invoice's.
    const option = inv.optionId.toLowerCase();
    if (
      option !== inv.invoiceId.toLowerCase() &&
      option !== optionIdOf(inv.invoiceId, BigInt(inv.chainId), inv.token)
    )
      return null;
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

function uint(n: bigint, max: bigint): string {
  if (n < 0n || n > max) throw new RangeError(`${n} is out of range`);
  return n.toString(16).padStart(64, "0");
}

function fixedBytes(hex: string, size: number): string {
  if (!new RegExp(`^0x[0-9a-fA-F]{${size * 2}}$`).test(hex))
    throw new RangeError(`${hex} is not ${size} bytes`);
  return hex.slice(2).toLowerCase().padStart(64, "0");
}

function unixSeconds(time: string): bigint {
  const ms = Date.parse(time);
  if (!Number.isInteger(ms) || ms % 1000 !== 0)
    throw new RangeError(`${time} is not a whole-second time`);
  return BigInt(ms / 1000);
}
