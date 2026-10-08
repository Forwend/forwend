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
    uint64 settleDeadline; // the executor may settle until here, then only the refund authority
    uint256 intendedChainId;
}

interface IInvoiceReceiverFactory {
    function refundAuthority() external view returns (address);
    function executor() external view returns (address);
    function paused() external view returns (bool);
}
