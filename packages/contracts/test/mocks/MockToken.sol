// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockToken is ERC20 {
    constructor() ERC20("Mock USD", "mUSD") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}

/// Takes a fee on every transfer, like USDT would if its fee switch were turned on.
contract FeeToken is MockToken {
    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0) && to != address(0)) {
            uint256 fee = value / 100;
            super._update(from, address(0xFEE), fee);
            value -= fee;
        }
        super._update(from, to, value);
    }
}

/// Calls back into the receiver during transfer.
contract ReentrantToken is MockToken {
    address public target;
    bytes public data;

    function arm(address target_, bytes calldata data_) external {
        target = target_;
        data = data_;
    }

    function _update(address from, address to, uint256 value) internal override {
        super._update(from, to, value);
        if (target != address(0) && from == target) {
            (bool ok, bytes memory ret) = target.call(data);
            if (!ok) {
                assembly {
                    revert(add(ret, 32), mload(ret))
                }
            }
        }
    }
}

/// USDT-style token: transfer returns nothing.
contract NoReturnToken {
    mapping(address => uint256) public balanceOf;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
    }
}

/// A token whose balanceOf always reverts.
contract BrokenToken {
    function balanceOf(address) external pure returns (uint256) {
        revert("broken");
    }
}
