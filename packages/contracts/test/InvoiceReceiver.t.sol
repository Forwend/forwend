// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Base} from "./Base.t.sol";
import {InvoiceReceiverFactory} from "../src/InvoiceReceiverFactory.sol";
import {InvoiceReceiver} from "../src/InvoiceReceiver.sol";
import {InvoiceTerms} from "../src/InvoiceTypes.sol";
import {MockToken, FeeToken, ReentrantToken} from "./mocks/MockToken.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Clones} from "@openzeppelin/contracts/proxy/Clones.sol";

contract FactoryTest is Base {
    function test_predictMatchesDeploy() public {
        InvoiceTerms memory t = terms();
        address predicted = factory.predict(t);
        assertEq(predicted.code.length, 0);
        vm.prank(executor);
        assertEq(factory.deploy(t), predicted);
        assertTrue(factory.isReceiver(predicted));
        assertEq(factory.deployedAt(predicted), block.timestamp);
        assertEq(factory.receiverOf(t.invoiceId), predicted);
    }

    function test_otherTermsGiveOtherAddress() public {
        InvoiceTerms memory a = terms();
        InvoiceTerms memory b = terms();
        b.recipient = makeAddr("someone else");
        assertTrue(factory.predict(a) != factory.predict(b));
    }

    function test_onlyOurKeysDeploy() public {
        InvoiceTerms memory t = terms();
        vm.prank(attacker);
        vm.expectRevert(InvoiceReceiverFactory.Unauthorized.selector);
        factory.deploy(t);
        vm.prank(authority);
        address first = factory.deploy(t);
        vm.prank(executor);
        assertEq(factory.deploy(t), first);
    }

    function test_receiverOfFirstDeployWins() public {
        InvoiceTerms memory a = terms();
        InvoiceTerms memory b = terms();
        b.amount = AMOUNT + 1; // same invoiceId, other terms (a backend bug)
        address first = address(deployed(a));
        deployed(b);
        assertEq(factory.receiverOf(a.invoiceId), first);
    }

    /// Any address a payer could have been shown must stay deployable, or its money would be stuck forever.
    function test_invalidTermsStayDeployableAndRefundable() public {
        InvoiceTerms[5] memory bad;
        for (uint256 i; i < bad.length; i++) {
            bad[i] = terms();
            bad[i].invoiceId = bytes32(i + 100);
        }
        bad[0].amount = 0;
        bad[1].recipient = address(0);
        bad[2].recipient = address(factory);
        bad[3].recipient = address(token);
        bad[4].recipient = factory.implementation();
        for (uint256 i; i < bad.length; i++) {
            pay(bad[i], AMOUNT);
            InvoiceReceiver r = deployed(bad[i]);
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
    }

    function test_deadlineBeforeExpiryStillWorks() public {
        InvoiceTerms memory t = terms();
        t.settleDeadline = t.expiresAt - 1;
        t.intendedChainId = 0; // and a chain id no chain has
        pay(t, AMOUNT);
        InvoiceReceiver r = deployed(t);
        vm.prank(authority);
        r.recover(address(token), payer, AMOUNT); // never the intended chain, so recover returns it
        assertEq(token.balanceOf(payer), AMOUNT);
    }

    function test_allowsDeployAfterExpiryForLateDeposits() public {
        vm.warp(DEADLINE + 30 days);
        assertTrue(address(deployed(terms())) != address(0));
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
        vm.prank(attacker);
        vm.expectRevert(InvoiceReceiver.Unauthorized.selector);
        impl.recover(address(0), attacker, 0);
    }

    /// The implementation has one address on every chain and is never an invoice's receiver: money sent to it returns.
    function test_implementationReturnsMoneySentToIt() public {
        InvoiceReceiver impl = InvoiceReceiver(factory.implementation());
        token.mint(address(impl), 7e6);
        vm.deal(address(impl), 1 ether);
        vm.startPrank(authority);
        vm.expectEmit(address(impl));
        emit InvoiceReceiver.Recovered(bytes32(0), address(token), payer, 7e6);
        impl.recover(address(token), payer, 7e6);
        impl.recover(address(0), payer, 1 ether);
        vm.expectRevert(InvoiceReceiver.InvalidDestination.selector);
        impl.recover(address(0), address(impl), 0);
        vm.stopPrank();
        assertEq(token.balanceOf(payer), 7e6);
        assertEq(payer.balance, 1 ether);
    }

    function test_cloneMadeOutsideFactoryReverts() public {
        InvoiceTerms memory t = terms();
        address fake = Clones.cloneWithImmutableArgs(factory.implementation(), abi.encode(t));
        token.mint(fake, AMOUNT);
        InvoiceReceiver r = InvoiceReceiver(fake);
        vm.warp(DEADLINE + 1);
        vm.startPrank(authority);
        vm.expectRevert(InvoiceReceiver.NotClone.selector);
        r.settle();
        vm.expectRevert(InvoiceReceiver.NotClone.selector);
        r.refund(payer, AMOUNT);
        vm.expectRevert(InvoiceReceiver.NotClone.selector);
        r.recover(address(token), payer, AMOUNT);
        vm.stopPrank();
        vm.expectRevert(InvoiceReceiver.NotClone.selector);
        r.terms();
        vm.expectRevert(InvoiceReceiver.NotClone.selector);
        r.status();
        vm.expectRevert(InvoiceReceiver.NotClone.selector);
        r.refundable();
        vm.expectRevert(InvoiceReceiver.NotClone.selector);
        r.deadline();
    }

    function test_receiverHasNoSignatureValidationOrApprove() public {
        address r = address(deployed(terms()));
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

    function test_refundableIsZeroOffIntendedChain() public {
        InvoiceTerms memory t = terms();
        pay(t, AMOUNT + 1e6);
        InvoiceReceiver r = deployed(t);
        vm.warp(DEADLINE + 1);
        assertEq(r.refundable(), AMOUNT + 1e6);
        vm.chainId(block.chainid + 1);
        assertEq(r.refundable(), 0);
        assertEq(r.status().refundable, 0);
    }

    /// Off its chain the invoice token may not exist: refundable() still answers instead of reverting.
    function test_refundableOffIntendedChainNeedsNoToken() public {
        InvoiceTerms memory t = termsFor(makeAddr("token on another chain"));
        t.intendedChainId = block.chainid + 1;
        InvoiceReceiver r = deployed(t);
        assertEq(r.refundable(), 0);
    }
}

contract FactoryRecoverTest is Base {
    function test_returnsTokenSentToTheFactory() public {
        token.mint(address(factory), 7e6);
        vm.expectEmit(address(factory));
        emit InvoiceReceiverFactory.Recovered(address(token), payer, 7e6);
        vm.prank(authority);
        factory.recover(address(token), payer, 7e6);
        assertEq(token.balanceOf(payer), 7e6);
        assertEq(token.balanceOf(address(factory)), 0);
    }

    function test_returnsNativeCoinHeldByTheFactory() public {
        vm.deal(address(factory), 1 ether);
        vm.prank(authority);
        factory.recover(address(0), payer, 1 ether);
        assertEq(payer.balance, 1 ether);
    }

    function test_onlyAuthorityRecoversFromTheFactory() public {
        token.mint(address(factory), 7e6);
        address[3] memory others = [executor, attacker, recipient];
        for (uint256 i; i < others.length; i++) {
            vm.prank(others[i]);
            vm.expectRevert(InvoiceReceiverFactory.Unauthorized.selector);
            factory.recover(address(token), others[i], 7e6);
        }
        assertEq(token.balanceOf(address(factory)), 7e6);
    }

    function test_factoryRecoverRejectsBadDestination() public {
        token.mint(address(factory), 7e6);
        vm.startPrank(authority);
        vm.expectRevert(InvoiceReceiverFactory.InvalidDestination.selector);
        factory.recover(address(token), address(0), 7e6);
        vm.expectRevert(InvoiceReceiverFactory.InvalidDestination.selector);
        factory.recover(address(token), address(factory), 7e6);
        vm.stopPrank();
    }

    function test_factoryRecoverWorksWhilePaused() public {
        token.mint(address(factory), 7e6);
        vm.startPrank(authority);
        factory.setPaused(true);
        factory.recover(address(token), payer, 7e6);
        vm.stopPrank();
        assertEq(token.balanceOf(payer), 7e6);
    }

    /// The factory moves only its own balance: a receiver's money, deployed or not, stays where it is.
    function test_factoryRecoverNeverTakesReceiverMoney() public {
        InvoiceTerms memory t = terms();
        address waiting = pay(t, AMOUNT);
        InvoiceTerms memory other = terms();
        other.invoiceId = keccak256("invoice-2");
        InvoiceReceiver r = InvoiceReceiver(pay(other, AMOUNT));
        deployed(other);
        token.mint(address(factory), 1e6);

        vm.startPrank(authority);
        vm.expectRevert();
        factory.recover(address(token), attacker, 1e6 + 1);
        factory.recover(address(token), payer, 1e6);
        vm.stopPrank();
        assertEq(token.balanceOf(waiting), AMOUNT);
        assertEq(token.balanceOf(address(r)), AMOUNT);
        assertEq(token.balanceOf(attacker), 0);
    }

    /// Our own contracts and code-less addresses are not tokens: each call reverts and every balance stays.
    function test_factoryRecoverRejectsOurContractsAsTokens() public {
        InvoiceTerms memory t = terms();
        address waiting = pay(t, AMOUNT);
        InvoiceTerms memory other = terms();
        other.invoiceId = keccak256("invoice-2");
        address live = pay(other, AMOUNT);
        deployed(other);
        address[5] memory notTokens = [waiting, live, factory.implementation(), address(factory), makeAddr("no code")];
        vm.startPrank(authority);
        for (uint256 i; i < notTokens.length; i++) {
            vm.expectRevert();
            factory.recover(notTokens[i], attacker, 1);
        }
        vm.stopPrank();
        assertEq(token.balanceOf(waiting), AMOUNT);
        assertEq(token.balanceOf(live), AMOUNT);
    }

    function test_failedNativeReturnReverts() public {
        vm.deal(address(factory), 1 ether);
        vm.prank(authority);
        vm.expectRevert(InvoiceReceiverFactory.NativeTransferFailed.selector);
        factory.recover(address(0), address(token), 1 ether);
        assertEq(address(factory).balance, 1 ether);
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
