// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Base} from "./Base.t.sol";
import {InvoiceReceiver} from "../src/InvoiceReceiver.sol";
import {InvoiceTerms, MAX_HOLD} from "../src/InvoiceTypes.sol";
import {BrokenToken, MockToken, ReturnBombToken} from "./mocks/MockToken.sol";

/// Money can never be held longer than MAX_HOLD after deployment, and a broken invoice token never blocks recovery.
contract HoldTest is Base {
    function test_hugeDeadlineIsCappedForPartialPayment() public {
        InvoiceTerms memory t = terms();
        t.expiresAt = type(uint64).max - 1;
        t.settleDeadline = type(uint64).max; // e.g. milliseconds by mistake, or a compromised API
        pay(t, AMOUNT / 2);
        InvoiceReceiver r = deployed(t);
        uint256 deployTime = block.timestamp;
        assertEq(r.deadline(), deployTime + MAX_HOLD);
        assertEq(r.refundable(), 0);
        vm.warp(deployTime + MAX_HOLD + 1);
        vm.prank(authority);
        r.refund(payer, AMOUNT / 2);
        assertEq(token.balanceOf(payer), AMOUNT / 2);
    }

    function test_executorLosesSettleAtTheCap() public {
        InvoiceTerms memory t = terms();
        t.settleDeadline = type(uint64).max;
        pay(t, AMOUNT);
        InvoiceReceiver r = deployed(t);
        vm.warp(block.timestamp + MAX_HOLD + 1);
        vm.prank(executor);
        vm.expectRevert(InvoiceReceiver.Unauthorized.selector);
        r.settle();
        vm.prank(authority);
        r.settle();
        assertEq(token.balanceOf(recipient), AMOUNT);
    }

    function test_normalDeadlineIsKeptWhenEarlierThanCap() public {
        InvoiceReceiver r = deployed(terms());
        assertEq(r.deadline(), DEADLINE);
    }

    function test_tokenWithoutCodeDoesNotBlockRecover() public {
        InvoiceTerms memory t = termsFor(makeAddr("no code token"));
        MockToken other = new MockToken();
        address at = factory.predict(t);
        other.mint(at, 4e6);
        vm.deal(at, 1 ether);
        InvoiceReceiver r = deployed(t);
        vm.startPrank(authority);
        r.recover(address(other), payer, 4e6);
        r.recover(address(0), payer, 1 ether);
        vm.stopPrank();
        assertEq(other.balanceOf(payer), 4e6);
        assertEq(payer.balance, 1 ether);
    }

    function test_revertingBalanceTokenDoesNotBlockRecover() public {
        BrokenToken broken = new BrokenToken();
        InvoiceTerms memory t = termsFor(address(broken));
        MockToken other = new MockToken();
        address at = factory.predict(t);
        other.mint(at, 4e6);
        InvoiceReceiver r = deployed(t);
        vm.prank(authority);
        r.recover(address(other), payer, 4e6);
        assertEq(other.balanceOf(payer), 4e6);
    }

    function test_returnBombTokenDoesNotBlockRecover() public {
        ReturnBombToken bomb = new ReturnBombToken();
        InvoiceTerms memory t = termsFor(address(bomb));
        MockToken other = new MockToken();
        address at = factory.predict(t);
        other.mint(at, 4e6);
        InvoiceReceiver r = deployed(t);
        vm.prank(authority);
        r.recover(address(other), payer, 4e6); // the reply copy is capped at 32 bytes
        assertEq(other.balanceOf(payer), 4e6);
    }
}
