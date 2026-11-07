// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Base} from "./Base.t.sol";
import {InvoiceReceiver} from "../src/InvoiceReceiver.sol";
import {InvoiceReceiverFactory} from "../src/InvoiceReceiverFactory.sol";
import {InvoiceTerms} from "../src/InvoiceTypes.sol";

contract FuzzTest is Base {
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
        vm.expectRevert(InvoiceReceiverFactory.Unauthorized.selector);
        factory.recover(address(token), caller, amount);
        InvoiceReceiver impl = InvoiceReceiver(factory.implementation());
        vm.expectRevert(InvoiceReceiver.Unauthorized.selector);
        impl.recover(address(token), caller, amount);
        vm.stopPrank();
    }

    function testFuzz_factoryReturnsOnlyItsOwnBalance(uint256 deposit, uint256 stray, uint256 amount) public {
        deposit = bound(deposit, 0, AMOUNT * 10);
        stray = bound(stray, 0, AMOUNT * 10);
        InvoiceTerms memory t = terms();
        address at = deposit > 0 ? pay(t, deposit) : factory.predict(t);
        deployed(t);
        token.mint(address(factory), stray);
        vm.prank(authority);
        (bool ok,) =
            address(factory).call(abi.encodeCall(InvoiceReceiverFactory.recover, (address(token), payer, amount)));
        assertEq(ok, amount <= stray);
        assertEq(token.balanceOf(at), deposit);
        assertEq(token.balanceOf(payer), ok ? amount : 0);
    }

    function testFuzz_refundableIsZeroOffIntendedChain(uint256 deposit, uint256 time, uint256 chainId) public {
        deposit = bound(deposit, 1, AMOUNT * 10);
        time = bound(time, block.timestamp, DEADLINE + 10 days);
        chainId = bound(chainId, 1, type(uint64).max);
        InvoiceTerms memory t = terms();
        pay(t, deposit);
        InvoiceReceiver r = deployed(t);
        vm.warp(time);
        vm.chainId(chainId);
        if (chainId != t.intendedChainId) assertEq(r.refundable(), 0);
        assertEq(r.refundable(), factory.status(t).refundable);
    }
}
