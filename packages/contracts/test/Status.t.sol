// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Base} from "./Base.t.sol";
import {InvoiceReceiver} from "../src/InvoiceReceiver.sol";
import {InvoiceStatus, InvoiceTerms} from "../src/InvoiceTypes.sol";

contract StatusTest is Base {
    function test_beforeDeployShowsPaidMoney() public {
        InvoiceTerms memory t = terms();
        address at = pay(t, AMOUNT + 2e6);
        InvoiceStatus memory s = factory.status(t);
        assertEq(s.receiver, at);
        assertFalse(s.deployed);
        assertTrue(s.onIntendedChain);
        assertEq(s.balance, AMOUNT + 2e6);
        assertFalse(s.settled);
        assertEq(s.refundable, 2e6);
        assertTrue(s.settleable);
        assertEq(s.settler, executor);
        assertEq(s.deadline, DEADLINE);
    }

    function test_afterSettle() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT + 1e6);
        InvoiceReceiver r = deployed(t);
        vm.prank(executor);
        r.settle();
        InvoiceStatus memory s = factory.status(t);
        assertTrue(s.deployed);
        assertTrue(s.settled);
        assertFalse(s.settleable);
        assertEq(s.balance, 1e6);
        assertEq(s.refundable, 1e6);
    }

    function test_afterDeadlineAuthoritySettlesAndAllIsRefundable() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT / 2);
        deployed(t);
        vm.warp(DEADLINE + 1);
        InvoiceStatus memory s = factory.status(t);
        assertEq(s.settler, authority);
        assertEq(s.refundable, AMOUNT / 2);
        assertFalse(s.settleable); // not fully paid
    }

    function test_pausedAndWrongChainAreNotSettleable() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT);
        vm.prank(authority);
        factory.setPaused(true);
        assertFalse(factory.status(t).settleable);
        vm.prank(authority);
        factory.setPaused(false);
        vm.chainId(block.chainid + 1);
        InvoiceStatus memory s = factory.status(t);
        assertFalse(s.onIntendedChain);
        assertFalse(s.settleable);
        assertEq(s.refundable, 0); // refund() does not work on another chain; recover() does
    }

    function test_tokenWithoutCodeReadsAsZero() public {
        InvoiceStatus memory s = factory.status(termsFor(makeAddr("no code token")));
        assertEq(s.balance, 0);
    }

    function test_statusByInvoiceId() public {
        InvoiceTerms memory t = terms();
        assertEq(factory.statusOf(t.invoiceId).receiver, address(0)); // not deployed yet
        pay(t, AMOUNT);
        InvoiceReceiver r = deployed(t);
        InvoiceStatus memory byId = factory.statusOf(t.invoiceId);
        assertEq(byId.receiver, address(r));
        assertEq(byId.balance, AMOUNT);
        assertTrue(byId.deployed);
    }

    function test_receiverStatusMatchesFactory() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT);
        InvoiceReceiver r = deployed(t);
        assertEq(keccak256(abi.encode(r.status())), keccak256(abi.encode(factory.status(t))));
    }

    /// settleable is true exactly when settle() by the settler succeeds, and refundable is exactly what refund allows.
    function testFuzz_statusMatchesBehaviour(uint256 deposit, uint256 time) public {
        deposit = bound(deposit, 0, AMOUNT * 3);
        time = bound(time, block.timestamp, DEADLINE + 10 days);
        InvoiceTerms memory t = terms();
        if (deposit > 0) pay(t, deposit);
        InvoiceReceiver r = deployed(t);
        vm.warp(time);
        InvoiceStatus memory s = factory.status(t);
        assertEq(s.refundable, r.refundable());
        uint256 snapshot = vm.snapshotState();
        vm.prank(s.settler);
        (bool ok,) = address(r).call(abi.encodeCall(InvoiceReceiver.settle, ()));
        assertEq(ok, s.settleable);
        vm.revertToState(snapshot);
        if (s.refundable == 0) return;
        vm.prank(authority);
        vm.expectRevert(InvoiceReceiver.ExceedsRefundable.selector);
        r.refund(payer, s.refundable + 1);
        vm.prank(authority);
        r.refund(payer, s.refundable);
    }
}
