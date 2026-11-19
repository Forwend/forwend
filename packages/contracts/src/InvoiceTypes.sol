// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

/// Invoice terms, the clone's immutable args: the receiver address commits to them.
/// No authority or executor here: the API writes the terms and must not choose who can move money.
struct InvoiceTerms {
    bytes32 invoiceId; // 256 random bits from the backend
    address recipient; // the creator's profile wallet
    address token; // allowlisted ERC-20 on `intendedChainId`
    uint256 amount; // base units
    uint64 expiresAt;
    uint64 settleDeadline; // executor's last settle time, capped by MAX_HOLD
    uint256 intendedChainId;
    uint256 networkFee; // to the settler, who paid the gas
    uint256 platformFee; // to the refund authority
}

struct InvoiceStatus {
    address receiver; // predicted; equals the deployed one
    bool deployed;
    bool onIntendedChain;
    uint256 balance; // 0 if the token can't be read on this chain
    bool settled;
    uint256 refundable; // what refund() allows now
    bool settleable; // settle() passes every check but the caller
    address settler; // who may call settle() now
    uint64 deadline; // min(settleDeadline, deployedAt + MAX_HOLD)
}

interface IInvoiceReceiverFactory {
    function refundAuthority() external view returns (address);
    function executor() external view returns (address);
    function paused() external view returns (bool);
    function implementation() external view returns (address);
    function deployedAt(address receiver) external view returns (uint64);
    function status(InvoiceTerms calldata t) external view returns (InvoiceStatus memory);
}

// A wrong settleDeadline (a bug or a compromised API) can never lock a payment longer than this.
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

// The fees together may take at most amount / MAX_FEE_DIVISOR: a backend bug or a compromised API can't take more.
uint256 constant MAX_FEE_DIVISOR = 10;

/// Both fees fit under the ceiling. Never overflows: the second test runs only once the first holds.
function feesWithinCeiling(InvoiceTerms memory t) pure returns (bool) {
    uint256 ceiling = t.amount / MAX_FEE_DIVISOR;
    return t.networkFee <= ceiling && t.platformFee <= ceiling - t.networkFee;
}

/// Terms settle() accepts; unsafe terms still deploy, and their money goes back by refund.
function safeToSettle(InvoiceTerms memory t, address receiver, address factory, address implementation)
    pure
    returns (bool)
{
    return t.amount != 0 && t.recipient != address(0) && t.recipient != receiver && t.recipient != factory
        && t.recipient != implementation && t.recipient != t.token && feesWithinCeiling(t);
}

/// A balance read that never reverts; it copies at most 32 bytes, so huge replies burn no gas.
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
