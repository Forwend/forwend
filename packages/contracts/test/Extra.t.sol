// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Base} from "./Base.t.sol";
import {InvoiceReceiver} from "../src/InvoiceReceiver.sol";
import {InvoiceReceiverFactory} from "../src/InvoiceReceiverFactory.sol";
import {InvoiceTerms} from "../src/InvoiceTypes.sol";
import {MockToken, NoReturnToken, ReentrantToken} from "./mocks/MockToken.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract ExtraTest is Base {
    function test_refundReentrancyBlocked() public {
        ReentrantToken evil = new ReentrantToken();
        InvoiceTerms memory t = termsFor(address(evil));
        pay(t, AMOUNT * 2);
        InvoiceReceiver r = deployed(t);
        evil.arm(address(r), abi.encodeCall(InvoiceReceiver.refund, (attacker, 1)));
        vm.prank(authority);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        r.refund(payer, AMOUNT);
    }

    function test_recoverReentrancyBlocked() public {
        ReentrantToken evil = new ReentrantToken();
        InvoiceTerms memory t = terms();
        address at = factory.predict(t);
        evil.mint(at, 5e6);
        InvoiceReceiver r = deployed(t);
        evil.arm(address(r), abi.encodeCall(InvoiceReceiver.recover, (address(evil), attacker, 1)));
        vm.prank(authority);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        r.recover(address(evil), payer, 5e6);
    }

    function test_tokenWithoutReturnValueWorks() public {
        NoReturnToken usdt = new NoReturnToken();
        InvoiceTerms memory t = termsFor(address(usdt));
        address at = factory.predict(t);
        usdt.mint(at, AMOUNT + 1e6);
        InvoiceReceiver r = deployed(t);
        vm.prank(executor);
        r.settle();
        vm.prank(authority);
        r.refund(payer, 1e6);
        assertEq(usdt.balanceOf(recipient), AMOUNT);
        assertEq(usdt.balanceOf(payer), 1e6);
    }

    function test_eventsEmitted() public {
        InvoiceTerms memory t = terms();
        address at = pay(t, AMOUNT + 2e6);
        vm.expectEmit(address(factory));
        emit InvoiceReceiverFactory.ReceiverDeployed(at, t.invoiceId);
        InvoiceReceiver r = deployed(t);

        vm.expectEmit(at);
        emit InvoiceReceiver.Settled(recipient, AMOUNT);
        vm.prank(executor);
        r.settle();

        vm.expectEmit(at);
        emit InvoiceReceiver.Refunded(payer, 1e6);
        vm.prank(authority);
        r.refund(payer, 1e6);

        MockToken other = new MockToken();
        other.mint(at, 3e6);
        vm.expectEmit(at);
        emit InvoiceReceiver.Recovered(address(other), payer, 3e6);
        vm.prank(authority);
        r.recover(address(other), payer, 3e6);
    }

    function test_recoverRejectsBadDestination() public {
        InvoiceReceiver r = deployed(terms());
        vm.startPrank(authority);
        vm.expectRevert(InvoiceReceiver.InvalidDestination.selector);
        r.recover(address(0), address(0), 0);
        vm.expectRevert(InvoiceReceiver.InvalidDestination.selector);
        r.recover(address(0), address(r), 0);
        vm.stopPrank();
    }
}
