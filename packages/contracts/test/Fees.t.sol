// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Vm} from "forge-std/Vm.sol";
import {Base} from "./Base.t.sol";
import {InvoiceReceiver} from "../src/InvoiceReceiver.sol";
import {InvoiceTerms, InvoiceStatus, MAX_FEE_DIVISOR, feesWithinCeiling} from "../src/InvoiceTypes.sol";

/// R-226: settlement pays the recipient the amount less the fees in the terms, the network fee to the settler and the
/// platform fee to the refund authority; fees above a tenth of the amount are refused, and refunds take none.
contract FeesTest is Base {
    uint256 internal constant NETWORK_FEE = 10_000;
    uint256 internal constant PLATFORM_FEE = 2_500_000;

    function feeTerms(uint256 networkFee, uint256 platformFee) internal view returns (InvoiceTerms memory t) {
        t = terms();
        t.networkFee = networkFee;
        t.platformFee = platformFee;
    }

    function test_settlePaysTheRecipientTheAmountLessTheFees() public {
        InvoiceTerms memory t = feeTerms(NETWORK_FEE, PLATFORM_FEE);
        pay(t, AMOUNT);
        InvoiceReceiver r = deployed(t);
        uint256 net = AMOUNT - NETWORK_FEE - PLATFORM_FEE;
        vm.expectEmit(address(r));
        emit InvoiceReceiver.Settled(t.invoiceId, recipient, net);
        vm.expectEmit(address(r));
        emit InvoiceReceiver.FeesPaid(t.invoiceId, executor, NETWORK_FEE, PLATFORM_FEE);
        vm.prank(executor);
        r.settle();
        assertEq(token.balanceOf(recipient), net);
        assertEq(token.balanceOf(executor), NETWORK_FEE);
        assertEq(token.balanceOf(authority), PLATFORM_FEE);
        assertEq(token.balanceOf(address(r)), 0);
    }

    function test_noFeesPayTheWholeAmountAndLogNoFees() public {
        InvoiceTerms memory t = feeTerms(0, 0);
        pay(t, AMOUNT);
        InvoiceReceiver r = deployed(t);
        vm.recordLogs();
        vm.prank(executor);
        r.settle();
        Vm.Log[] memory logs = vm.getRecordedLogs();
        for (uint256 i; i < logs.length; i++) {
            assertTrue(logs[i].topics[0] != InvoiceReceiver.FeesPaid.selector, "FeesPaid without fees");
        }
        assertEq(token.balanceOf(recipient), AMOUNT);
        assertEq(token.balanceOf(executor), 0);
        assertEq(token.balanceOf(authority), 0);
    }

    function test_onlyOneFeePaysOnlyThatOne() public {
        InvoiceTerms memory t = feeTerms(0, PLATFORM_FEE);
        pay(t, AMOUNT);
        InvoiceReceiver r = deployed(t);
        vm.prank(executor);
        r.settle();
        assertEq(token.balanceOf(recipient), AMOUNT - PLATFORM_FEE);
        assertEq(token.balanceOf(executor), 0);
        assertEq(token.balanceOf(authority), PLATFORM_FEE);
    }

    function test_feesAtTheCeilingSettle() public {
        uint256 ceiling = AMOUNT / MAX_FEE_DIVISOR;
        InvoiceTerms memory t = feeTerms(ceiling - 1, 1);
        pay(t, AMOUNT);
        InvoiceReceiver r = deployed(t);
        assertTrue(factory.status(t).settleable);
        vm.prank(executor);
        r.settle();
        assertEq(token.balanceOf(recipient), AMOUNT - ceiling);
    }

    /// Unsafe fees are refused when money moves, as other unsafe terms are, and the money goes back by refund whole.
    function test_feesAboveTheCeilingAreRefusedAndRefundable() public {
        uint256 ceiling = AMOUNT / MAX_FEE_DIVISOR;
        InvoiceTerms[4] memory bad = [
            feeTerms(ceiling + 1, 0),
            feeTerms(0, ceiling + 1),
            feeTerms(ceiling, 1),
            feeTerms(type(uint256).max, type(uint256).max)
        ];
        for (uint256 i; i < bad.length; i++) {
            bad[i].invoiceId = bytes32(i + 200);
            pay(bad[i], AMOUNT);
            InvoiceReceiver r = deployed(bad[i]);
            assertFalse(factory.status(bad[i]).settleable);
            vm.prank(executor);
            vm.expectRevert(InvoiceReceiver.InvalidTerms.selector);
            r.settle();
        }
        vm.warp(DEADLINE + 1);
        for (uint256 i; i < bad.length; i++) {
            InvoiceReceiver r = InvoiceReceiver(factory.predict(bad[i]));
            vm.prank(authority);
            r.refund(payer, AMOUNT);
        }
        assertEq(token.balanceOf(payer), AMOUNT * bad.length);
        assertEq(token.balanceOf(recipient), 0);
    }

    /// Whoever settles paid the gas: after the deadline the refund authority settles and takes both fees.
    function test_aLateSettleByTheAuthorityTakesTheNetworkFee() public {
        InvoiceTerms memory t = feeTerms(NETWORK_FEE, PLATFORM_FEE);
        pay(t, AMOUNT);
        InvoiceReceiver r = deployed(t);
        vm.warp(DEADLINE + 1);
        vm.prank(authority);
        r.settle();
        assertEq(token.balanceOf(authority), NETWORK_FEE + PLATFORM_FEE);
        assertEq(token.balanceOf(executor), 0);
        assertEq(token.balanceOf(recipient), AMOUNT - NETWORK_FEE - PLATFORM_FEE);
    }

    /// The recipient's own balance check counts only its transfer, so a recipient that also settles still settles.
    function test_aRecipientThatIsTheExecutorGetsBoth() public {
        InvoiceTerms memory t = feeTerms(NETWORK_FEE, 0);
        t.recipient = executor;
        pay(t, AMOUNT);
        InvoiceReceiver r = deployed(t);
        vm.prank(executor);
        r.settle();
        assertEq(token.balanceOf(executor), AMOUNT);
    }

    function test_refundsTakeNoFee() public {
        InvoiceTerms memory t = feeTerms(NETWORK_FEE, PLATFORM_FEE);
        pay(t, AMOUNT + 70e6);
        InvoiceReceiver r = deployed(t);
        assertEq(r.refundable(), 70e6);
        vm.prank(authority);
        r.refund(payer, 70e6);
        assertEq(token.balanceOf(payer), 70e6);
        // Never settled: after the deadline the whole amount goes back, with no fee taken.
        vm.warp(DEADLINE + 1);
        vm.prank(authority);
        r.refund(payer, AMOUNT);
        assertEq(token.balanceOf(payer), AMOUNT + 70e6);
        assertEq(token.balanceOf(executor) + token.balanceOf(authority), 0);
    }

    function test_statusAddressCommitsToTheFees() public view {
        assertTrue(factory.predict(feeTerms(0, 0)) != factory.predict(feeTerms(1, 0)));
        assertTrue(factory.predict(feeTerms(1, 0)) != factory.predict(feeTerms(0, 1)));
        InvoiceStatus memory s = factory.status(feeTerms(NETWORK_FEE, PLATFORM_FEE));
        assertEq(s.receiver, factory.predict(feeTerms(NETWORK_FEE, PLATFORM_FEE)));
    }

    function testFuzz_settleSplitsTheAmountExactly(uint256 amount, uint256 networkFee, uint256 platformFee) public {
        amount = bound(amount, 1, type(uint128).max);
        networkFee = bound(networkFee, 0, amount / MAX_FEE_DIVISOR);
        platformFee = bound(platformFee, 0, amount / MAX_FEE_DIVISOR - networkFee);
        InvoiceTerms memory t = feeTerms(networkFee, platformFee);
        t.amount = amount;
        pay(t, amount);
        InvoiceReceiver r = deployed(t);
        vm.prank(executor);
        r.settle();
        assertEq(token.balanceOf(recipient), amount - networkFee - platformFee);
        assertEq(token.balanceOf(executor), networkFee);
        assertEq(token.balanceOf(authority), platformFee);
        assertEq(token.balanceOf(address(r)), 0);
    }

    /// The ceiling over the whole uint256 range: it never reverts, agrees with a plain sum (which can't overflow once
    /// each fee is under the ceiling), and leaves the recipient at least nine tenths.
    function testFuzz_ceilingOverTheWholeRange(uint256 amount, uint256 networkFee, uint256 platformFee) public pure {
        InvoiceTerms memory t;
        t.amount = amount;
        t.networkFee = networkFee;
        t.platformFee = platformFee;
        uint256 ceiling = amount / MAX_FEE_DIVISOR;
        bool want = networkFee <= ceiling && platformFee <= ceiling && networkFee + platformFee <= ceiling;
        assertEq(feesWithinCeiling(t), want);
        if (want) assertGe(amount - networkFee - platformFee, amount - ceiling);
    }
}
