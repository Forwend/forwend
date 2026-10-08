// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Base} from "./Base.t.sol";
import {InvoiceReceiver} from "../src/InvoiceReceiver.sol";
import {InvoiceTerms} from "../src/InvoiceTypes.sol";

contract FuzzTest is Base {
    /// For any deposit and any time, settle either pays exactly `amount` or reverts, and the rest stays held.
    function testFuzz_settlePaysExactlyAmount(uint256 deposit, uint256 time) public {
        deposit = bound(deposit, 1, AMOUNT * 10);
        time = bound(time, block.timestamp, DEADLINE + 10 days);
        InvoiceTerms memory t = terms();
        pay(t, deposit);
        InvoiceReceiver r = deployed(t);
        vm.warp(time);
        vm.prank(time <= DEADLINE ? executor : authority);
        if (deposit < AMOUNT) {
            vm.expectRevert(InvoiceReceiver.NotPaid.selector);
            r.settle();
            return;
        }
        r.settle();
        assertEq(token.balanceOf(recipient), AMOUNT);
        assertEq(token.balanceOf(address(r)), deposit - AMOUNT);
    }

    /// Refundable never includes the recipient's amount while it is still owed.
    function testFuzz_refundableKeepsOwedAmount(uint256 deposit, uint256 time) public {
        deposit = bound(deposit, 1, AMOUNT * 10);
        time = bound(time, block.timestamp, DEADLINE + 10 days);
        InvoiceTerms memory t = terms();
        pay(t, deposit);
        InvoiceReceiver r = deployed(t);
        vm.warp(time);
        uint256 expected = time > DEADLINE ? deposit : (deposit > AMOUNT ? deposit - AMOUNT : 0);
        assertEq(r.refundable(), expected);
        if (expected == 0) return;
        vm.prank(authority);
        r.refund(payer, expected);
        assertEq(token.balanceOf(address(r)), deposit - expected);
    }

    /// Nobody but the refund authority can refund or recover, whatever the amount.
    function testFuzz_strangersCannotMoveMoney(address caller, uint256 amount) public {
        vm.assume(caller != authority);
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT * 2);
        InvoiceReceiver r = deployed(t);
        vm.startPrank(caller);
        vm.expectRevert(InvoiceReceiver.Unauthorized.selector);
        r.refund(caller, amount);
        vm.expectRevert(InvoiceReceiver.Unauthorized.selector);
        r.recover(address(token), caller, amount);
        vm.stopPrank();
    }
}
