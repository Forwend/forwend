// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {InvoiceReceiverFactory} from "../src/InvoiceReceiverFactory.sol";

/// Deploys the factory through the CREATE2 deployer, so the address is the same on every chain for the same
/// refund authority and first executor. Does nothing if it is already deployed. Run with script/deploy.sh.
contract Deploy is Script {
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 internal constant SALT = keccak256("forwend.invoice-receiver-factory.v1");

    function run() external virtual returns (InvoiceReceiverFactory) {
        return deployFactory();
    }

    function deployFactory() public returns (InvoiceReceiverFactory factory) {
        address authority = vm.envAddress("REFUND_AUTHORITY");
        address executor = vm.envAddress("EXECUTOR"); // the first executor, even after setExecutor
        bytes memory init = abi.encodePacked(type(InvoiceReceiverFactory).creationCode, abi.encode(authority, executor));
        address predicted = vm.computeCreate2Address(SALT, keccak256(init), CREATE2_DEPLOYER);
        if (predicted.code.length == 0) {
            // Called directly: on a live chain forge 1.8 runs `new {salt: ...}` from the broadcasting account instead.
            vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
            (bool ok,) = CREATE2_DEPLOYER.call(abi.encodePacked(SALT, init));
            vm.stopBroadcast();
            require(ok && predicted.code.length != 0, "factory deploy failed");
        }
        factory = InvoiceReceiverFactory(predicted);
        // The CREATE2 address commits to both arguments; setExecutor later changes only the stored executor.
        require(factory.refundAuthority() == authority, "factory config mismatch");
        console.log("factory", predicted);
    }
}
