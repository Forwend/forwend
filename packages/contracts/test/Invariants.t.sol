// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {InvoiceReceiverFactory} from "../src/InvoiceReceiverFactory.sol";
import {InvoiceReceiver} from "../src/InvoiceReceiver.sol";
import {InvoiceTerms} from "../src/InvoiceTypes.sol";
import {MockToken} from "./mocks/MockToken.sol";

contract Handler is Test {
    InvoiceReceiverFactory public factory;
    MockToken public token;
    InvoiceTerms internal t;
    address public receiver;
    address public authority;
    address public executor;
    address public recipient;
    address public payer = makeAddr("payer");
    address public attacker = makeAddr("attacker");
    address public returnedTo = makeAddr("returned to");

    uint256 public totalIn;
    uint256 public totalRefunded;
    uint256 public refundedToAttacker;
    uint256 public totalStray;
    uint256 public totalReturnedByFactory;
    bool public tookOwedBeforeDeadline;

    constructor(InvoiceReceiverFactory factory_, MockToken token_, InvoiceTerms memory t_) {
        factory = factory_;
        token = token_;
        t = t_;
        receiver = factory.predict(t_);
        authority = factory.refundAuthority();
        executor = factory.executor();
        recipient = t_.recipient;
    }

    function deposit(uint256 amount) external {
        amount = bound(amount, 1, t.amount * 2);
        token.mint(payer, amount);
        vm.prank(payer);
        token.transfer(receiver, amount);
        totalIn += amount;
    }

    function deploy() external {
        vm.prank(executor);
        factory.deploy(t);
    }

    function warp(uint256 dt) external {
        vm.warp(block.timestamp + bound(dt, 1, 2 days));
    }

    function settle(uint256 who) external {
        if (receiver.code.length == 0) return;
        vm.prank(_actor(who));
        try InvoiceReceiver(receiver).settle() {} catch {}
    }

    function refund(uint256 who, uint256 amount, bool toAttacker) external {
        if (receiver.code.length == 0) return;
        InvoiceReceiver r = InvoiceReceiver(receiver);
        uint256 before = token.balanceOf(receiver);
        bool owedProtected = !r.settled() && block.timestamp <= t.settleDeadline && before >= t.amount;
        amount = bound(amount, 0, before);
        vm.prank(_actor(who));
        try r.refund(toAttacker ? attacker : payer, amount) {
            totalRefunded += amount;
            if (toAttacker) refundedToAttacker += amount;
            if (owedProtected && token.balanceOf(receiver) < t.amount) tookOwedBeforeDeadline = true;
        } catch {}
    }

    function recover(uint256 who, uint256 amount) external {
        if (receiver.code.length == 0) return;
        vm.prank(_actor(who));
        try InvoiceReceiver(receiver).recover(address(token), attacker, amount) {} catch {}
    }

    function strayToFactory(uint256 amount) external {
        amount = bound(amount, 1, t.amount);
        token.mint(address(factory), amount);
        totalStray += amount;
    }

    function factoryRecover(uint256 who, uint256 amount) external {
        amount = bound(amount, 0, t.amount * 4);
        vm.prank(_actor(who));
        try factory.recover(address(token), returnedTo, amount) {
            totalReturnedByFactory += amount;
        } catch {}
    }

    function _actor(uint256 who) internal view returns (address) {
        address[4] memory actors = [executor, authority, attacker, recipient];
        return actors[who % 4];
    }
}

contract InvariantsTest is Test {
    Handler internal handler;
    MockToken internal token;
    InvoiceTerms internal t;

    function setUp() public {
        vm.warp(1_000_000);
        InvoiceReceiverFactory factory = new InvoiceReceiverFactory(makeAddr("authority"), makeAddr("executor"));
        token = new MockToken();
        t = InvoiceTerms({
            invoiceId: keccak256("invoice-1"),
            recipient: makeAddr("recipient"),
            token: address(token),
            amount: 500e6,
            expiresAt: 1_000_000 + 1 hours,
            settleDeadline: 1_000_000 + 1 hours + 1 days,
            intendedChainId: block.chainid,
            networkFee: 1e6,
            platformFee: 2e6
        });
        handler = new Handler(factory, token, t);
        targetContract(address(handler));
    }

    function invariant_recipientGetsZeroOrExactlyAmountLessFees() public view {
        uint256 got = token.balanceOf(t.recipient);
        assertTrue(got == 0 || got == t.amount - t.networkFee - t.platformFee);
    }

    function invariant_conservation() public view {
        assertEq(
            token.balanceOf(t.recipient) + handler.totalRefunded() + token.balanceOf(handler.receiver())
                + token.balanceOf(handler.executor()) + token.balanceOf(handler.authority()),
            handler.totalIn()
        );
    }

    /// The executor and the authority get the fees once, at settlement, and nothing else.
    function invariant_feesOnlyAtSettlement() public view {
        uint256 fees = token.balanceOf(handler.executor()) + token.balanceOf(handler.authority());
        address receiver = handler.receiver();
        bool settled = receiver.code.length != 0 && InvoiceReceiver(receiver).settled();
        assertEq(fees, settled ? t.networkFee + t.platformFee : 0);
        uint256 toExecutor = token.balanceOf(handler.executor());
        assertTrue(toExecutor == 0 || toExecutor == t.networkFee);
    }

    function invariant_refundsNeverTakeOwedAmountBeforeDeadline() public view {
        assertFalse(handler.tookOwedBeforeDeadline());
    }

    function invariant_factoryReturnsOnlyItsOwnBalance() public view {
        assertEq(token.balanceOf(handler.returnedTo()), handler.totalReturnedByFactory());
        assertEq(token.balanceOf(address(handler.factory())), handler.totalStray() - handler.totalReturnedByFactory());
    }

    function invariant_invoiceTokenNeverRecovered() public view {
        // recover() is aimed at the attacker; only the authority's refunds to it may reach it
        assertEq(token.balanceOf(handler.attacker()), handler.refundedToAttacker());
    }
}
