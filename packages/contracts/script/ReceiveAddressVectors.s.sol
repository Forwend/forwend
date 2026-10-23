// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Script} from "forge-std/Script.sol";
import {InvoiceReceiverFactory} from "../src/InvoiceReceiverFactory.sol";
import {InvoiceTerms} from "../src/InvoiceTypes.sol";

/// Writes vectors/receive-address.json for the Go address tests; regenerate with `pnpm vectors`. Reads no environment
/// variables: forge runs test suites in parallel and Deploy.t.sol sets them.
contract ReceiveAddressVectors is Script {
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;
    bytes32 internal constant SALT = keccak256("forwend.invoice-receiver-factory.v1");
    string internal constant PATH = "vectors/receive-address.json";

    function run() external {
        vm.writeFile(PATH, json());
    }

    function json() public returns (string memory out) {
        string memory deployments = vm.readFile("deployments.json");
        address authority = vm.parseJsonAddress(deployments, ".chains.base-sepolia.refundAuthority");
        address executor = vm.parseJsonAddress(deployments, ".chains.base-sepolia.executor");
        bytes memory init = abi.encodePacked(type(InvoiceReceiverFactory).creationCode, abi.encode(authority, executor));
        (bool ok, bytes memory ret) = CREATE2_DEPLOYER.call(abi.encodePacked(SALT, init));
        require(ok, "factory deploy failed");
        InvoiceReceiverFactory factory = InvoiceReceiverFactory(address(bytes20(ret)));

        uint256[4] memory chainIds = [uint256(84532), 421614, 5042002, 42431];
        uint256[3] memory amounts = [uint256(1), type(uint256).max, 123_456_789];
        uint64[2] memory expiries = [uint64(0), type(uint64).max];

        out = string.concat(
            "{\n  \"factory\": \"",
            vm.toString(address(factory)),
            "\",\n  \"implementation\": \"",
            vm.toString(factory.implementation()),
            "\",\n  \"vectors\": [\n"
        );
        for (uint256 i; i < 24; i++) {
            InvoiceTerms memory t = InvoiceTerms({
                invoiceId: keccak256(abi.encode("invoice", i)),
                recipient: address(uint160(uint256(keccak256(abi.encode("recipient", i))))),
                token: address(uint160(uint256(keccak256(abi.encode("token", i))))),
                amount: amounts[(i / 4) % 3],
                expiresAt: expiries[i / 12],
                settleDeadline: uint64(uint256(keccak256(abi.encode("deadline", i)))),
                intendedChainId: chainIds[i % 4]
            });
            out = string.concat(out, i == 0 ? "" : ",\n", vector(t, factory.predict(t)));
        }
        out = string.concat(out, "\n  ]\n}\n");
    }

    function vector(InvoiceTerms memory t, address receiver) internal pure returns (string memory) {
        return string.concat(
            string.concat(
                "    {\"invoiceId\": \"",
                vm.toString(t.invoiceId),
                "\", \"recipient\": \"",
                vm.toString(t.recipient),
                "\", \"token\": \"",
                vm.toString(t.token)
            ),
            string.concat(
                "\", \"amount\": \"",
                vm.toString(t.amount),
                "\", \"expiresAt\": \"",
                vm.toString(t.expiresAt),
                "\", \"settleDeadline\": \"",
                vm.toString(t.settleDeadline),
                "\", \"intendedChainId\": \"",
                vm.toString(t.intendedChainId),
                "\", \"receiver\": \"",
                vm.toString(receiver),
                "\"}"
            )
        );
    }
}
