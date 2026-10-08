// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// Invoice terms, stored as the receiver clone's immutable args. The receiver address commits to them.
/// No authority, executor or fee here: the API writes the terms and must not choose who can move money.
struct InvoiceTerms {
    bytes32 invoiceId; // 256 random bits from the backend
    address recipient; // the creator's profile wallet
    address token; // allowlisted ERC-20 on `intendedChainId`
    uint256 amount; // base units
    uint64 expiresAt;
    uint64 settleDeadline; // the executor may settle until here (capped, see MAX_HOLD), then only the refund authority
    uint256 intendedChainId;
}

/// Read-only snapshot of one invoice, for the backend, support, explorers and Safe owners.
struct InvoiceStatus {
    address receiver; // predicted address; equals the deployed one
    bool deployed;
    bool onIntendedChain;
    uint256 balance; // invoice-token balance at the receiver; 0 if the token cannot be read on this chain
    bool settled;
    uint256 refundable; // what refund() allows now
    bool settleable; // settle() would pass every check except the caller (a token transfer can still fail)
    address settler; // who may call settle() now
    uint64 deadline; // effective settle deadline: min(settleDeadline, deployedAt + MAX_HOLD)
}

interface IInvoiceReceiverFactory {
    function refundAuthority() external view returns (address);
    function executor() external view returns (address);
    function paused() external view returns (bool);
    function implementation() external view returns (address);
    function deployedAt(address receiver) external view returns (uint64);
    function status(InvoiceTerms calldata t) external view returns (InvoiceStatus memory);
}

// Longest time money can stay owed to the recipient after the receiver is deployed. A wrong or huge settleDeadline in
// the terms (a backend bug or a compromised API) can therefore never lock a payment for longer than this.
uint64 constant MAX_HOLD = 30 days;

function effectiveDeadline(uint64 settleDeadline, uint64 deployedAt) pure returns (uint64) {
    uint64 cap = deployedAt + MAX_HOLD;
    return settleDeadline < cap ? settleDeadline : cap;
}

/// The one refund rule: everything once settled or after the deadline; before that only what is above `amount`.
function refundableAmount(uint256 balance, uint256 amount, bool settled, uint64 deadline, uint256 nowTs)
    pure
    returns (uint256)
{
    if (settled || nowTs > deadline) return balance;
    return balance > amount ? balance - amount : 0;
}

/// Terms that settle() accepts. Terms are not checked at deploy (an address that holds money must stay deployable), so
/// unsafe ones are refused when money moves and go to refund instead. Shared by settle() and status().
function safeToSettle(InvoiceTerms memory t, address receiver, address factory, address implementation)
    pure
    returns (bool)
{
    return t.amount != 0 && t.recipient != address(0) && t.recipient != receiver && t.recipient != factory
        && t.recipient != implementation && t.recipient != t.token;
}

/// Balance read that never reverts: false for a token without code, with a failing balanceOf or a short reply. Copies
/// at most 32 bytes of the reply, so a token returning huge data cannot burn the caller's gas.
function tryBalanceOf(address token, address account) view returns (bool ok, uint256 amount) {
    bytes memory callData = abi.encodeWithSignature("balanceOf(address)", account);
    uint256 size;
    assembly ("memory-safe") {
        ok := staticcall(gas(), token, add(callData, 0x20), mload(callData), 0x00, 0x20)
        size := returndatasize()
        amount := mload(0x00)
    }
    if (!ok || size < 32) return (false, 0);
}
