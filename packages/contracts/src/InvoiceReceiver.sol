// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IInvoiceReceiverFactory, InvoiceTerms} from "./InvoiceTypes.sol";

/// One receiver per invoice: a clone of this contract deployed by the factory at the address payers already paid to.
/// It can only pay `amount` to `recipient`, or return money through the refund authority. Rules: ../AGENTS.md.
/// Deliberately has no receive/fallback, approve, signature validation, delegatecall or selfdestruct.
contract InvoiceReceiver is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IInvoiceReceiverFactory public immutable factory;
    address private immutable self;

    bool public settled;

    event Settled(address indexed recipient, uint256 amount);
    event Refunded(address indexed to, uint256 amount);
    event Recovered(address indexed token, address indexed to, uint256 amount);

    error NotClone();
    error WrongChain();
    error Paused();
    error AlreadySettled();
    error Unauthorized();
    error NotPaid();
    error RecipientMismatch();
    error InvalidDestination();
    error ExceedsRefundable();
    error InvoiceToken();
    error NativeTransferFailed();

    constructor() {
        factory = IInvoiceReceiverFactory(msg.sender);
        self = address(this);
    }

    modifier onlyClone() {
        _onlyClone();
        _;
    }

    function _onlyClone() private view {
        if (address(this) == self) revert NotClone();
    }

    function terms() public view onlyClone returns (InvoiceTerms memory) {
        return abi.decode(Clones.fetchCloneArgs(address(this)), (InvoiceTerms));
    }

    /// Money the refund authority may return now: everything once settled or after the settle deadline,
    /// before that only what is above the invoice amount.
    function refundable() public view onlyClone returns (uint256) {
        InvoiceTerms memory t = terms();
        uint256 balance = IERC20(t.token).balanceOf(address(this));
        if (settled || block.timestamp > t.settleDeadline) return balance;
        return balance > t.amount ? balance - t.amount : 0;
    }

    function settle() external nonReentrant onlyClone {
        InvoiceTerms memory t = terms();
        if (block.chainid != t.intendedChainId) revert WrongChain();
        if (factory.paused()) revert Paused();
        if (settled) revert AlreadySettled();
        address allowed = block.timestamp <= t.settleDeadline ? factory.executor() : factory.refundAuthority();
        if (msg.sender != allowed) revert Unauthorized();
        IERC20 token = IERC20(t.token);
        if (token.balanceOf(address(this)) < t.amount) revert NotPaid();

        settled = true;
        uint256 before = token.balanceOf(t.recipient);
        token.safeTransfer(t.recipient, t.amount);
        if (token.balanceOf(t.recipient) - before != t.amount) revert RecipientMismatch();
        emit Settled(t.recipient, t.amount);
    }

    function refund(address to, uint256 amount) external nonReentrant onlyClone {
        InvoiceTerms memory t = terms();
        if (msg.sender != factory.refundAuthority()) revert Unauthorized();
        if (block.chainid != t.intendedChainId) revert WrongChain();
        if (to == address(0) || to == address(this)) revert InvalidDestination();
        if (amount == 0 || amount > refundable()) revert ExceedsRefundable();

        IERC20(t.token).safeTransfer(to, amount);
        emit Refunded(to, amount);
    }

    /// Returns a token that is not the invoice token, the native coin (`token == address(0)`), or anything on a
    /// chain other than the intended one. On the intended chain the invoice-token balance must not drop: on Arc the
    /// native coin and USDC are one balance.
    function recover(address token, address to, uint256 amount) external nonReentrant onlyClone {
        InvoiceTerms memory t = terms();
        if (msg.sender != factory.refundAuthority()) revert Unauthorized();
        if (to == address(0) || to == address(this)) revert InvalidDestination();
        bool intended = block.chainid == t.intendedChainId;
        if (intended && token == t.token) revert InvoiceToken();
        uint256 before = intended ? IERC20(t.token).balanceOf(address(this)) : 0;

        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
        if (intended && IERC20(t.token).balanceOf(address(this)) < before) revert InvoiceToken();
        emit Recovered(token, to, amount);
    }
}
