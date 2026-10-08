// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {InvoiceReceiverFactory} from "../src/InvoiceReceiverFactory.sol";
import {InvoiceReceiver} from "../src/InvoiceReceiver.sol";
import {InvoiceTerms} from "../src/InvoiceTypes.sol";

/// Pays, settles and refunds with the real USDC contract on a Base Sepolia fork.
/// Needs BASE_SEPOLIA_RPC (`node script/rpc.mjs base-sepolia`); reported as skipped without it.
contract BaseSepoliaForkTest is Test {
    IERC20 internal constant USDC = IERC20(0x036CbD53842c5426634e7929541eC2318f3dCF7e);

    function test_realUsdcFlow() public {
        string memory rpc = vm.envOr("BASE_SEPOLIA_RPC", string(""));
        vm.skip(bytes(rpc).length == 0);
        vm.createSelectFork(rpc);

        address authority = makeAddr("authority");
        address executor = makeAddr("executor");
        address recipient = makeAddr("recipient");
        address payer = makeAddr("payer");
        InvoiceReceiverFactory factory = new InvoiceReceiverFactory(authority, executor);
        InvoiceTerms memory t = InvoiceTerms({
            invoiceId: keccak256("fork-invoice"),
            recipient: recipient,
            token: address(USDC),
            amount: 25e6,
            expiresAt: uint64(block.timestamp + 1 hours),
            settleDeadline: uint64(block.timestamp + 1 hours + 1 days),
            intendedChainId: block.chainid
        });

        address at = factory.predict(t);
        deal(address(USDC), payer, 30e6);
        vm.prank(payer);
        USDC.transfer(at, 30e6); // 5 USDC overpaid

        InvoiceReceiver r = InvoiceReceiver(factory.deploy(t));
        vm.prank(executor);
        r.settle();
        vm.prank(authority);
        r.refund(payer, 5e6);

        assertEq(USDC.balanceOf(recipient), 25e6);
        assertEq(USDC.balanceOf(payer), 5e6);
        assertEq(USDC.balanceOf(at), 0);
    }
}
