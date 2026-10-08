// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {InvoiceReceiverFactory} from "../src/InvoiceReceiverFactory.sol";
import {InvoiceTerms} from "../src/InvoiceTypes.sol";

/// Deploys the factory the way production does (through the CREATE2 deployer) on two chain ids and checks that the
/// factory and the receiver for the same terms get the same addresses on both (C-03).
contract CrossChainTest is Test {
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 internal constant SALT = keccak256("forwend.invoice-receiver-factory.v1");

    address internal authority = makeAddr("authority");
    address internal executor = makeAddr("executor");

    function deployOn(uint256 chainId) internal returns (address factory, address receiver) {
        uint256 snapshot = vm.snapshotState();
        vm.chainId(chainId);
        bytes memory init = abi.encodePacked(type(InvoiceReceiverFactory).creationCode, abi.encode(authority, executor));
        (bool ok, bytes memory ret) = CREATE2_DEPLOYER.call(abi.encodePacked(SALT, init));
        assertTrue(ok);
        factory = address(bytes20(ret));
        InvoiceTerms memory t = InvoiceTerms({
            invoiceId: keccak256("invoice-1"),
            recipient: makeAddr("recipient"),
            token: makeAddr("usdc"),
            amount: 500e6,
            expiresAt: 1_000_000,
            settleDeadline: 1_000_000 + 1 days,
            intendedChainId: 84532
        });
        receiver = InvoiceReceiverFactory(factory).deploy(t);
        vm.revertToState(snapshot);
    }

    function test_sameAddressesOnEveryChain() public {
        assertGt(CREATE2_DEPLOYER.code.length, 0);
        (address factoryA, address receiverA) = deployOn(84532);
        (address factoryB, address receiverB) = deployOn(5042002);
        assertEq(factoryA, factoryB);
        assertEq(receiverA, receiverB);
    }
}
