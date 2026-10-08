// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {InvoiceReceiverFactory} from "../src/InvoiceReceiverFactory.sol";

/// Deploys the factory through the CREATE2 deployer, so the address is the same on every chain for the same
/// refund authority and first executor. Does nothing if it is already deployed. Run with script/deploy.sh.
contract Deploy is Script {
    bytes32 internal constant SALT = keccak256("forwend.invoice-receiver-factory.v1");

    function run() external virtual returns (InvoiceReceiverFactory) {
        return deployFactory();
    }

    function deployFactory() public returns (InvoiceReceiverFactory factory) {
        address authority = vm.envAddress("REFUND_AUTHORITY");
        address executor = vm.envAddress("EXECUTOR");
        bytes memory init = abi.encodePacked(type(InvoiceReceiverFactory).creationCode, abi.encode(authority, executor));
        address predicted = vm.computeCreate2Address(SALT, keccak256(init));
        if (predicted.code.length == 0) {
            vm.startBroadcast(vm.envUint("DEPLOYER_PRIVATE_KEY"));
            factory = new InvoiceReceiverFactory{salt: SALT}(authority, executor);
            vm.stopBroadcast();
            require(address(factory) == predicted, "factory address mismatch");
        }
        factory = InvoiceReceiverFactory(predicted);
        require(factory.refundAuthority() == authority && factory.executor() == executor, "factory config mismatch");
        console.log("factory", predicted);
    }
}
