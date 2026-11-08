// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {console} from "forge-std/Script.sol";
import {InvoiceReceiverFactory} from "../src/InvoiceReceiverFactory.sol";
import {InvoiceTerms} from "../src/InvoiceTypes.sol";
import {Deploy} from "./Deploy.s.sol";

/// Deploys a probe receiver with identical terms on every chain: its address must equal predict() everywhere (C-03).
/// The payment flow runs with cast in deploy.sh: Foundry can't execute Arc's and Tempo's built-in tokens locally.
contract Smoke is Deploy {
    address internal constant TEST_RECIPIENT = address(uint160(uint256(keccak256("forwend.testnet.recipient"))));

    function run() external override returns (InvoiceReceiverFactory factory) {
        factory = deployFactory();
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");

        InvoiceTerms memory probe = InvoiceTerms({
            invoiceId: keccak256("forwend.testnet.probe.v1"),
            recipient: TEST_RECIPIENT,
            token: 0x036CbD53842c5426634e7929541eC2318f3dCF7e,
            amount: 1e6,
            expiresAt: 1_798_761_600, // 2027-01-01
            settleDeadline: 1_798_848_000,
            intendedChainId: 84532,
            networkFee: 0,
            platformFee: 0
        });
        vm.startBroadcast(deployerKey);
        address deployed = factory.deploy(probe);
        vm.stopBroadcast();
        require(deployed == factory.predict(probe) && deployed.code.length > 0, "probe mismatch");
        console.log("probe receiver", deployed);
    }
}
