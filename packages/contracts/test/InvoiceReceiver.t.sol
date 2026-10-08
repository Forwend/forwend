// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Base} from "./Base.t.sol";
import {InvoiceReceiverFactory} from "../src/InvoiceReceiverFactory.sol";
import {InvoiceReceiver} from "../src/InvoiceReceiver.sol";
import {InvoiceTerms} from "../src/InvoiceTypes.sol";
import {MockToken, FeeToken, ReentrantToken} from "./mocks/MockToken.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract FactoryTest is Base {
    function test_predictMatchesDeploy() public {
        InvoiceTerms memory t = terms();
        address predicted = factory.predict(t);
        assertEq(predicted.code.length, 0);
        assertEq(factory.deploy(t), predicted);
        assertTrue(factory.isReceiver(predicted));
    }

    function test_otherTermsGiveOtherAddress() public {
        InvoiceTerms memory a = terms();
        InvoiceTerms memory b = terms();
        b.recipient = makeAddr("someone else");
        assertTrue(factory.predict(a) != factory.predict(b));
    }

    function test_deployTwiceReturnsSameReceiver() public {
        InvoiceTerms memory t = terms();
        vm.prank(attacker); // anyone may deploy; same terms, same contract
        address first = factory.deploy(t);
        assertEq(factory.deploy(t), first);
    }

    function test_rejectsInvalidTerms() public {
        InvoiceTerms memory t;
        t = terms();
        t.amount = 0;
        _expectInvalid(t);
        t = terms();
        t.token = address(0);
        _expectInvalid(t);
        t = terms();
        t.recipient = address(0);
        _expectInvalid(t);
        t = terms();
        t.recipient = address(factory);
        _expectInvalid(t);
        t = terms();
        t.recipient = address(token);
        _expectInvalid(t);
        t = terms();
        t.expiresAt = 0;
        t.settleDeadline = 0;
        _expectInvalid(t);
        t = terms();
        t.settleDeadline = t.expiresAt - 1;
        _expectInvalid(t);
        t = terms();
        t.intendedChainId = 0;
        _expectInvalid(t);
    }

    function test_allowsDeployAfterExpiryForLateDeposits() public {
        vm.warp(DEADLINE + 30 days);
        assertTrue(factory.deploy(terms()) != address(0));
    }

    function _expectInvalid(InvoiceTerms memory t) private {
        vm.expectRevert(InvoiceReceiverFactory.InvalidTerms.selector);
        factory.predict(t);
        vm.expectRevert(InvoiceReceiverFactory.InvalidTerms.selector);
        factory.deploy(t);
    }

    function test_onlyAuthorityChangesExecutorAndPause() public {
        vm.startPrank(attacker);
        vm.expectRevert(InvoiceReceiverFactory.Unauthorized.selector);
        factory.setExecutor(attacker);
        vm.expectRevert(InvoiceReceiverFactory.Unauthorized.selector);
        factory.setPaused(true);
        vm.stopPrank();

        vm.startPrank(authority);
        factory.setExecutor(makeAddr("new executor"));
        factory.setPaused(true);
        vm.expectRevert(InvoiceReceiverFactory.ZeroAddress.selector);
        factory.setExecutor(address(0));
        vm.stopPrank();
        assertEq(factory.executor(), makeAddr("new executor"));
        assertTrue(factory.paused());
    }

    function test_constructorRejectsZero() public {
        vm.expectRevert(InvoiceReceiverFactory.ZeroAddress.selector);
        new InvoiceReceiverFactory(address(0), executor);
        vm.expectRevert(InvoiceReceiverFactory.ZeroAddress.selector);
        new InvoiceReceiverFactory(authority, address(0));
    }

    function test_implementationCannotBeUsedDirectly() public {
        InvoiceReceiver impl = InvoiceReceiver(factory.implementation());
        vm.expectRevert(InvoiceReceiver.NotClone.selector);
        impl.settle();
        vm.prank(authority);
        vm.expectRevert(InvoiceReceiver.NotClone.selector);
        impl.refund(payer, 1);
        vm.prank(authority);
        vm.expectRevert(InvoiceReceiver.NotClone.selector);
        impl.recover(address(0), payer, 0);
    }

    function test_receiverHasNoSignatureValidationOrApprove() public {
        address r = factory.deploy(terms());
        (bool ok,) = r.call(abi.encodeWithSignature("isValidSignature(bytes32,bytes)", bytes32(0), ""));
        assertFalse(ok);
        (ok,) = r.call(abi.encodeWithSignature("approve(address,uint256)", attacker, 1));
        assertFalse(ok);
    }
}

contract SettleTest is Base {
    function test_exactPayment() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT);
        InvoiceReceiver r = deployed(t);
        vm.prank(executor);
        r.settle();
        assertEq(token.balanceOf(recipient), AMOUNT);
        assertTrue(r.settled());
    }

    function test_partialThenTopUp() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT / 2);
        InvoiceReceiver r = deployed(t);
        vm.prank(executor);
        vm.expectRevert(InvoiceReceiver.NotPaid.selector);
        r.settle();
        pay(t, AMOUNT / 2);
        vm.prank(executor);
        r.settle();
        assertEq(token.balanceOf(recipient), AMOUNT);
    }

    function test_overpaySettlesAmountAndHoldsExcess() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT + 70e6);
        InvoiceReceiver r = deployed(t);
        vm.prank(executor);
        r.settle();
        assertEq(token.balanceOf(recipient), AMOUNT);
        assertEq(token.balanceOf(address(r)), 70e6);
        assertEq(r.refundable(), 70e6);
    }

    function test_doubleSettleBlocked() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT * 2);
        InvoiceReceiver r = deployed(t);
        vm.startPrank(executor);
        r.settle();
        vm.expectRevert(InvoiceReceiver.AlreadySettled.selector);
        r.settle();
        vm.stopPrank();
        assertEq(token.balanceOf(recipient), AMOUNT);
    }

    function test_onlyExecutorBeforeDeadline() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT);
        InvoiceReceiver r = deployed(t);
        address[3] memory others = [attacker, authority, recipient];
        for (uint256 i; i < others.length; i++) {
            vm.prank(others[i]);
            vm.expectRevert(InvoiceReceiver.Unauthorized.selector);
            r.settle();
        }
    }

    function test_afterDeadlineOnlyAuthoritySettles() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT);
        InvoiceReceiver r = deployed(t);
        vm.warp(DEADLINE + 1);
        vm.prank(executor);
        vm.expectRevert(InvoiceReceiver.Unauthorized.selector);
        r.settle();
        vm.prank(authority);
        r.settle();
        assertEq(token.balanceOf(recipient), AMOUNT);
    }

    function test_settleAtDeadlineStillExecutor() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT);
        InvoiceReceiver r = deployed(t);
        vm.warp(DEADLINE);
        vm.prank(executor);
        r.settle();
    }

    function test_pauseBlocksSettleButNotRefund() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT + 1e6);
        InvoiceReceiver r = deployed(t);
        vm.prank(authority);
        factory.setPaused(true);
        vm.prank(executor);
        vm.expectRevert(InvoiceReceiver.Paused.selector);
        r.settle();
        vm.prank(authority);
        r.refund(payer, 1e6);
        assertEq(token.balanceOf(payer), 1e6);
    }

    function test_rotatedExecutor() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT);
        InvoiceReceiver r = deployed(t);
        address next = makeAddr("next executor");
        vm.prank(authority);
        factory.setExecutor(next);
        vm.prank(executor);
        vm.expectRevert(InvoiceReceiver.Unauthorized.selector);
        r.settle();
        vm.prank(next);
        r.settle();
    }

    function test_wrongChainCannotSettle() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT);
        InvoiceReceiver r = deployed(t);
        vm.chainId(block.chainid + 1);
        vm.prank(executor);
        vm.expectRevert(InvoiceReceiver.WrongChain.selector);
        r.settle();
    }

    function test_feeOnTransferTokenRejected() public {
        FeeToken fee = new FeeToken();
        InvoiceTerms memory t = termsFor(address(fee));
        pay(t, AMOUNT * 2);
        InvoiceReceiver r = deployed(t);
        vm.prank(executor);
        vm.expectRevert(InvoiceReceiver.RecipientMismatch.selector);
        r.settle();
    }

    function test_reentrancyBlocked() public {
        ReentrantToken evil = new ReentrantToken();
        InvoiceTerms memory t = termsFor(address(evil));
        pay(t, AMOUNT * 2);
        InvoiceReceiver r = deployed(t);
        evil.arm(address(r), abi.encodeCall(InvoiceReceiver.settle, ()));
        vm.prank(executor);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        r.settle();
    }
}

contract RefundTest is Base {
    function test_onlyAuthorityRefunds() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT + 1e6);
        InvoiceReceiver r = deployed(t);
        address[3] memory others = [attacker, executor, recipient];
        for (uint256 i; i < others.length; i++) {
            vm.prank(others[i]);
            vm.expectRevert(InvoiceReceiver.Unauthorized.selector);
            r.refund(others[i], 1e6);
        }
    }

    function test_beforeDeadlineOnlyExcessIsRefundable() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT + 3e6);
        InvoiceReceiver r = deployed(t);
        vm.prank(authority);
        vm.expectRevert(InvoiceReceiver.ExceedsRefundable.selector);
        r.refund(payer, 3e6 + 1);
        vm.prank(authority);
        r.refund(payer, 3e6);
        vm.prank(executor);
        r.settle(); // the recipient's amount is still there
        assertEq(token.balanceOf(recipient), AMOUNT);
    }

    function test_partialBeforeDeadlineNotRefundable() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT / 2);
        InvoiceReceiver r = deployed(t);
        assertEq(r.refundable(), 0);
        vm.prank(authority);
        vm.expectRevert(InvoiceReceiver.ExceedsRefundable.selector);
        r.refund(payer, 1);
    }

    function test_expiredPartialRefundableAfterDeadline() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT / 2);
        InvoiceReceiver r = deployed(t);
        vm.warp(DEADLINE + 1);
        vm.prank(authority);
        r.refund(payer, AMOUNT / 2);
        assertEq(token.balanceOf(payer), AMOUNT / 2);
    }

    function test_lateDepositAfterSettleRefundable() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT);
        InvoiceReceiver r = deployed(t);
        vm.prank(executor);
        r.settle();
        pay(t, 9e6);
        vm.prank(authority);
        r.refund(payer, 9e6);
        assertEq(token.balanceOf(address(r)), 0);
    }

    function test_twoRefundsWithinRefundable() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT * 3); // two extra payers
        InvoiceReceiver r = deployed(t);
        vm.prank(executor);
        r.settle();
        address second = makeAddr("second payer");
        vm.startPrank(authority);
        r.refund(payer, AMOUNT);
        r.refund(second, AMOUNT);
        vm.expectRevert(InvoiceReceiver.ExceedsRefundable.selector);
        r.refund(payer, 1);
        vm.stopPrank();
        assertEq(token.balanceOf(second), AMOUNT);
    }

    function test_refundRejectsBadDestinationAndZero() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT + 1e6);
        InvoiceReceiver r = deployed(t);
        vm.startPrank(authority);
        vm.expectRevert(InvoiceReceiver.InvalidDestination.selector);
        r.refund(address(0), 1);
        vm.expectRevert(InvoiceReceiver.InvalidDestination.selector);
        r.refund(address(r), 1);
        vm.expectRevert(InvoiceReceiver.ExceedsRefundable.selector);
        r.refund(payer, 0);
        vm.stopPrank();
    }

    function test_wrongChainCannotRefund() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT + 1e6);
        InvoiceReceiver r = deployed(t);
        vm.chainId(block.chainid + 1);
        vm.prank(authority);
        vm.expectRevert(InvoiceReceiver.WrongChain.selector);
        r.refund(payer, 1e6);
    }
}

contract RecoverTest is Base {
    function test_recoversOtherToken() public {
        InvoiceTerms memory t = terms();
        MockToken other = new MockToken();
        address at = factory.predict(t);
        other.mint(at, 7e6);
        InvoiceReceiver r = deployed(t);
        vm.prank(authority);
        r.recover(address(other), payer, 7e6);
        assertEq(other.balanceOf(payer), 7e6);
    }

    function test_neverTakesInvoiceTokenOnIntendedChain() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT);
        InvoiceReceiver r = deployed(t);
        vm.prank(authority);
        vm.expectRevert(InvoiceReceiver.InvoiceToken.selector);
        r.recover(address(token), attacker, AMOUNT);
    }

    function test_recoversInvoiceTokenOnWrongChain() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT);
        InvoiceReceiver r = deployed(t);
        vm.chainId(block.chainid + 1);
        vm.prank(authority);
        r.recover(address(token), payer, AMOUNT);
        assertEq(token.balanceOf(payer), AMOUNT);
    }

    function test_recoversNativeSentBeforeDeploy() public {
        InvoiceTerms memory t = terms();
        address at = factory.predict(t);
        vm.deal(at, 1 ether);
        InvoiceReceiver r = deployed(t);
        vm.prank(authority);
        r.recover(address(0), payer, 1 ether);
        assertEq(payer.balance, 1 ether);
    }

    function test_nativeTransferAfterDeployRejected() public {
        InvoiceReceiver r = deployed(terms());
        vm.deal(payer, 1 ether);
        vm.prank(payer);
        (bool ok,) = address(r).call{value: 1 ether}("");
        assertFalse(ok);
        assertEq(payer.balance, 1 ether);
    }

    function test_onlyAuthorityRecovers() public {
        InvoiceReceiver r = deployed(terms());
        vm.prank(executor);
        vm.expectRevert(InvoiceReceiver.Unauthorized.selector);
        r.recover(address(0), executor, 0);
    }
}

/// On Arc the native coin and USDC are one balance. A token whose balance follows the native balance stands in for it.
contract NativeBackedToken {
    function balanceOf(address a) external view returns (uint256) {
        return a.balance;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        (bool ok,) = to.call{value: amount}("");
        return ok;
    }
}

contract ArcNativeTest is Base {
    function test_nativeRecoverCannotDrainNativeBackedInvoiceToken() public {
        NativeBackedToken usdc = new NativeBackedToken();
        InvoiceTerms memory t = termsFor(address(usdc));
        address at = factory.predict(t);
        vm.deal(at, AMOUNT);
        InvoiceReceiver r = deployed(t);
        vm.prank(authority);
        vm.expectRevert(InvoiceReceiver.InvoiceToken.selector);
        r.recover(address(0), attacker, AMOUNT);
    }
}
