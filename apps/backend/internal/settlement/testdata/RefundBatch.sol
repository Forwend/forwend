// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface Receiver {
    function refund(address to, uint256 amount) external;
}

contract RefundBatch {
    function refundTwice(address receiver, address to, uint256 amount) external {
        Receiver(receiver).refund(to, amount);
        Receiver(receiver).refund(to, amount);
    }
}
