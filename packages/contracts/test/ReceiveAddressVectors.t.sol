// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {ReceiveAddressVectors} from "../script/ReceiveAddressVectors.s.sol";

contract ReceiveAddressVectorsTest is Test {
    /// The Go address code is tested against this file, so any change to the init code must regenerate it.
    function test_vectorsFileMatchesPredict() public {
        assertEq(
            vm.readFile("vectors/receive-address.json"),
            new ReceiveAddressVectors().json(),
            "stale vectors: run `pnpm vectors` in packages/contracts"
        );
    }
}
