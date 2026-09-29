// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ITokenMessengerV2} from "../../src/interfaces/ITokenMessengerV2.sol";

/// @notice Records burns like CCTP V2's TokenMessenger: pulls `amount` from the caller
contract MockTokenMessenger is ITokenMessengerV2 {
    using SafeERC20 for IERC20;

    struct Burn {
        uint256 amount;
        uint32 destinationDomain;
        bytes32 mintRecipient;
        address burnToken;
        bytes32 destinationCaller;
        uint256 maxFee;
        uint32 minFinalityThreshold;
    }

    Burn[] public burns;

    function depositForBurn(
        uint256 amount,
        uint32 destinationDomain,
        bytes32 mintRecipient,
        address burnToken,
        bytes32 destinationCaller,
        uint256 maxFee,
        uint32 minFinalityThreshold
    ) external {
        require(maxFee < amount, "Max fee must be less than amount");
        IERC20(burnToken).safeTransferFrom(msg.sender, address(this), amount);
        burns.push(
            Burn({
                amount: amount,
                destinationDomain: destinationDomain,
                mintRecipient: mintRecipient,
                burnToken: burnToken,
                destinationCaller: destinationCaller,
                maxFee: maxFee,
                minFinalityThreshold: minFinalityThreshold
            })
        );
    }

    function burnCount() external view returns (uint256) {
        return burns.length;
    }
}
