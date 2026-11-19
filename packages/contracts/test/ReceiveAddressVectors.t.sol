// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ReceiveAddressVectors} from "../script/ReceiveAddressVectors.s.sol";

contract ReceiveAddressVectorsTest is Test {
    /// Go's address code is tested against this file: regenerate it after any init-code change.
    function test_vectorsFileMatchesPredict() public {
        assertEq(
            vm.readFile("vectors/receive-address.json"),
            new ReceiveAddressVectors().json(),
            "stale vectors: run `pnpm vectors` in packages/contracts"
        );
    }
}
