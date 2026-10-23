// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {InvoiceReceiverFactory} from "../src/InvoiceReceiverFactory.sol";
import {InvoiceReceiver} from "../src/InvoiceReceiver.sol";
import {InvoiceTerms} from "../src/InvoiceTypes.sol";
import {MockToken} from "./mocks/MockToken.sol";

abstract contract Base is Test {
    uint256 internal constant AMOUNT = 500e6;
    uint64 internal constant EXPIRES = 1_000_000;
    uint64 internal constant DEADLINE = EXPIRES + 1 days;

    address internal authority = makeAddr("authority");
    address internal executor = makeAddr("executor");
    address internal recipient = makeAddr("recipient");
    address internal payer = makeAddr("payer");
    address internal attacker = makeAddr("attacker");

    InvoiceReceiverFactory internal factory;
    MockToken internal token;

    function setUp() public virtual {
        vm.warp(EXPIRES - 1 hours);
        factory = new InvoiceReceiverFactory(authority, executor);
        token = new MockToken();
    }

    function terms() internal view returns (InvoiceTerms memory) {
        return termsFor(address(token));
    }

    function termsFor(address token_) internal view returns (InvoiceTerms memory) {
        return InvoiceTerms({
            invoiceId: keccak256("invoice-1"),
            recipient: recipient,
            token: token_,
            amount: AMOUNT,
            expiresAt: EXPIRES,
            settleDeadline: DEADLINE,
            intendedChainId: block.chainid
        });
    }

    function pay(InvoiceTerms memory t, uint256 amount) internal returns (address at) {
        at = factory.predict(t);
        MockToken(t.token).mint(payer, amount);
        vm.prank(payer);
        MockToken(t.token).transfer(at, amount);
    }

    function deployed(InvoiceTerms memory t) internal returns (InvoiceReceiver) {
        vm.prank(executor);
        return InvoiceReceiver(factory.deploy(t));
    }
}
