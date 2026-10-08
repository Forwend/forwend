// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {InvoiceReceiverFactory} from "../src/InvoiceReceiverFactory.sol";
import {InvoiceReceiver} from "../src/InvoiceReceiver.sol";
import {InvoiceTerms} from "../src/InvoiceTypes.sol";
import {MockToken} from "./mocks/MockToken.sol";

/// Halmos symbolic tests (`halmos --match-contract Symbolic`): every `check_` holds for all inputs, not just samples.
/// forge does not run `check_` functions.
contract SymbolicTest is Test {
    uint256 internal constant AMOUNT = 500e6;
    uint64 internal constant DEADLINE = 2_000_000;

    address internal authority = address(0xA11CE);
    address internal executor = address(0xE8EC);
    address internal recipient = address(0x8EC1);

    InvoiceReceiverFactory internal factory;
    MockToken internal token;
    InvoiceReceiver internal receiver;

    function setUp() public {
        factory = new InvoiceReceiverFactory(authority, executor);
        token = new MockToken();
        InvoiceTerms memory t = InvoiceTerms({
            invoiceId: bytes32(uint256(1)),
            recipient: recipient,
            token: address(token),
            amount: AMOUNT,
            expiresAt: DEADLINE - 1 days,
            settleDeadline: DEADLINE,
            intendedChainId: block.chainid
        });
        receiver = InvoiceReceiver(factory.deploy(t));
    }

    /// settle() succeeds only for the right caller at the right time, and pays exactly AMOUNT to the recipient.
    function check_settle(address caller, uint256 deposit, uint256 time) public {
        vm.assume(deposit <= type(uint128).max);
        vm.assume(caller != address(receiver) && caller != recipient);
        token.mint(address(receiver), deposit);
        vm.warp(time);
        vm.prank(caller);
        (bool ok,) = address(receiver).call(abi.encodeCall(InvoiceReceiver.settle, ()));
        if (ok) {
            assert(deposit >= AMOUNT);
            assert(time <= DEADLINE ? caller == executor : caller == authority);
            assert(token.balanceOf(recipient) == AMOUNT);
            assert(token.balanceOf(address(receiver)) == deposit - AMOUNT);
        } else {
            assert(token.balanceOf(recipient) == 0);
        }
    }

    /// refund() succeeds only for the authority and never takes the owed AMOUNT before the deadline.
    function check_refund(address caller, address to, uint256 deposit, uint256 amount, uint256 time) public {
        vm.assume(deposit <= type(uint128).max);
        vm.assume(to != address(receiver) && to != recipient);
        token.mint(address(receiver), deposit);
        vm.warp(time);
        vm.prank(caller);
        (bool ok,) = address(receiver).call(abi.encodeCall(InvoiceReceiver.refund, (to, amount)));
        if (ok) {
            assert(caller == authority);
            assert(amount <= deposit);
            if (time <= DEADLINE && deposit >= AMOUNT) assert(token.balanceOf(address(receiver)) >= AMOUNT);
        }
    }

    /// recover() can never move the invoice token on the intended chain, whoever calls it.
    function check_recoverNeverTakesInvoiceToken(address caller, address to, uint256 deposit, uint256 amount) public {
        vm.assume(deposit <= type(uint128).max);
        token.mint(address(receiver), deposit);
        vm.prank(caller);
        (bool ok,) = address(receiver).call(abi.encodeCall(InvoiceReceiver.recover, (address(token), to, amount)));
        assert(!ok);
        assert(token.balanceOf(address(receiver)) == deposit);
    }
}
