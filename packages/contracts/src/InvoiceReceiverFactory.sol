// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {InvoiceReceiver} from "./InvoiceReceiver.sol";
import {InvoiceTerms} from "./InvoiceTypes.sol";

/// Deploys invoice receivers at addresses that commit to their terms. Deployed through the CREATE2 deployer with the
/// same bytecode and constructor args everywhere, so it has one address on every chain. Rules: ../AGENTS.md.
contract InvoiceReceiverFactory {
    /// The Safe multisig on mainnet, a test EOA on testnets. Fixed: changing it means a new factory.
    address public immutable refundAuthority;
    address public immutable implementation;
    address public executor;
    bool public paused;
    mapping(address receiver => bool) public isReceiver;

    event ExecutorChanged(address indexed executor);
    event PausedChanged(bool paused);
    event ReceiverDeployed(address indexed receiver, bytes32 indexed invoiceId);

    error Unauthorized();
    error ZeroAddress();
    error InvalidTerms();

    constructor(address refundAuthority_, address executor_) {
        if (refundAuthority_ == address(0) || executor_ == address(0)) revert ZeroAddress();
        refundAuthority = refundAuthority_;
        executor = executor_;
        implementation = address(new InvoiceReceiver());
        emit ExecutorChanged(executor_);
    }

    modifier onlyRefundAuthority() {
        _onlyRefundAuthority();
        _;
    }

    function _onlyRefundAuthority() private view {
        if (msg.sender != refundAuthority) revert Unauthorized();
    }

    function setExecutor(address executor_) external onlyRefundAuthority {
        if (executor_ == address(0)) revert ZeroAddress();
        executor = executor_;
        emit ExecutorChanged(executor_);
    }

    function setPaused(bool paused_) external onlyRefundAuthority {
        paused = paused_;
        emit PausedChanged(paused_);
    }

    function predict(InvoiceTerms calldata t) external view returns (address receiver) {
        (receiver,,) = _address(t);
    }

    /// Anyone may call it: the same terms always give the same receiver. Returns an already deployed receiver.
    function deploy(InvoiceTerms calldata t) external returns (address receiver) {
        bytes memory args;
        bytes32 salt;
        (receiver, args, salt) = _address(t);
        if (receiver.code.length != 0) return receiver;
        Clones.cloneDeterministicWithImmutableArgs(implementation, args, salt);
        isReceiver[receiver] = true;
        emit ReceiverDeployed(receiver, t.invoiceId);
    }

    function _address(InvoiceTerms calldata t)
        private
        view
        returns (address receiver, bytes memory args, bytes32 salt)
    {
        args = abi.encode(t);
        salt = keccak256(args);
        receiver = Clones.predictDeterministicAddressWithImmutableArgs(implementation, args, salt, address(this));
        // Expiry in the past is allowed here: a late deposit deploys the receiver after expiry (the backend checks it).
        if (
            t.amount == 0 || t.token == address(0) || t.recipient == address(0) || t.recipient == receiver
                || t.recipient == address(this) || t.recipient == t.token || t.expiresAt == 0
                || t.settleDeadline < t.expiresAt || t.intendedChainId == 0
        ) revert InvalidTerms();
    }
}
