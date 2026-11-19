// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";
import {InvoiceReceiver} from "./InvoiceReceiver.sol";
import {
    InvoiceStatus,
    InvoiceTerms,
    effectiveDeadline,
    refundableAmount,
    safeToSettle,
    tryBalanceOf
} from "./InvoiceTypes.sol";

/// Deploys receivers at addresses that commit to their terms; one factory address on every chain.
contract InvoiceReceiverFactory {
    using SafeERC20 for IERC20;

    /// The Safe multisig on mainnet, a test EOA on testnets. Fixed: changing it means a new factory.
    address public immutable refundAuthority;
    address public immutable implementation;
    address public executor;
    bool public paused;
    mapping(address receiver => uint64) public deployedAt;
    /// A lookup aid for explorers and support, never for money decisions; the first deploy wins.
    mapping(bytes32 invoiceId => address) public receiverOf;

    event ExecutorChanged(address indexed executor);
    event PausedChanged(bool paused);
    event ReceiverDeployed(address indexed receiver, bytes32 indexed invoiceId);
    event Recovered(address indexed token, address indexed to, uint256 amount);

    error Unauthorized();
    error ZeroAddress();
    error InvalidDestination();
    error NativeTransferFailed();

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

    /// Returns tokens or native coin (token 0) sent here by mistake, never invoice money; ignores paused.
    function recover(address token, address to, uint256 amount) external onlyRefundAuthority {
        if (to == address(0) || to == address(this)) revert InvalidDestination();
        if (token == address(0)) {
            (bool ok,) = to.call{value: amount}("");
            if (!ok) revert NativeTransferFailed();
        } else {
            IERC20(token).safeTransfer(to, amount);
        }
        emit Recovered(token, to, amount);
    }

    function isReceiver(address receiver) external view returns (bool) {
        return deployedAt[receiver] != 0;
    }

    /// Never rejects terms: any address a payer was shown must stay deployable; settle() refuses unsafe ones.
    function predict(InvoiceTerms calldata t) public view returns (address receiver) {
        (receiver,,) = _address(t);
    }

    /// Only our keys deploy: on Arc an early deploy by a stranger would make a payer's native top-up fail.
    function deploy(InvoiceTerms calldata t) external returns (address receiver) {
        if (msg.sender != executor && msg.sender != refundAuthority) revert Unauthorized();
        bytes memory args;
        bytes32 salt;
        (receiver, args, salt) = _address(t);
        if (deployedAt[receiver] != 0) return receiver;
        Clones.cloneDeterministicWithImmutableArgs(implementation, args, salt);
        deployedAt[receiver] = uint64(block.timestamp);
        if (receiverOf[t.invoiceId] == address(0)) receiverOf[t.invoiceId] = receiver;
        emit ReceiverDeployed(receiver, t.invoiceId);
    }

    /// Works before deployment: tokens paid to the predicted address are already visible.
    function status(InvoiceTerms calldata t) external view returns (InvoiceStatus memory) {
        return _status(t);
    }

    /// Status of a deployed receiver by invoice id; empty before deployment (use status(terms)).
    function statusOf(bytes32 invoiceId) external view returns (InvoiceStatus memory s) {
        address receiver = receiverOf[invoiceId];
        if (receiver != address(0)) s = _status(InvoiceReceiver(receiver).terms());
    }

    function _status(InvoiceTerms memory t) private view returns (InvoiceStatus memory s) {
        (s.receiver,,) = _address(t);
        uint64 at = deployedAt[s.receiver];
        s.deployed = at != 0;
        s.onIntendedChain = block.chainid == t.intendedChainId;
        (, s.balance) = tryBalanceOf(t.token, s.receiver);
        s.settled = s.deployed && InvoiceReceiver(s.receiver).settled();
        s.deadline = effectiveDeadline(t.settleDeadline, s.deployed ? at : uint64(block.timestamp));
        s.refundable =
            s.onIntendedChain ? refundableAmount(s.balance, t.amount, s.settled, s.deadline, block.timestamp) : 0;
        s.settler = block.timestamp <= s.deadline ? executor : refundAuthority;
        s.settleable = s.onIntendedChain && !paused && !s.settled && s.balance >= t.amount
            && safeToSettle(t, s.receiver, address(this), implementation);
    }

    function _address(InvoiceTerms memory t) private view returns (address receiver, bytes memory args, bytes32 salt) {
        args = abi.encode(t);
        salt = keccak256(args);
        receiver = Clones.predictDeterministicAddressWithImmutableArgs(implementation, args, salt, address(this));
    }
}
