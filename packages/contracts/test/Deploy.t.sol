// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../script/Deploy.s.sol";
import {InvoiceReceiverFactory} from "../src/InvoiceReceiverFactory.sol";

contract DeployTest is Test {
    address internal authority = makeAddr("authority");
    address internal firstExecutor = makeAddr("firstExecutor");

    function setUp() public {
        vm.setEnv("REFUND_AUTHORITY", vm.toString(authority));
        vm.setEnv("EXECUTOR", vm.toString(firstExecutor));
        vm.setEnv("DEPLOYER_PRIVATE_KEY", vm.toString(uint256(0xA11CE)));
    }

    /// The address commits to the first executor; after setExecutor the script returns the same factory.
    function test_scriptKeepsFactoryAfterExecutorRotation() public {
        Deploy d = new Deploy();
        InvoiceReceiverFactory factory = d.deployFactory();
        vm.prank(authority);
        factory.setExecutor(makeAddr("newExecutor"));
        assertEq(address(d.deployFactory()), address(factory));
    }
}
