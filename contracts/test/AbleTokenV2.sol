// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

// Important: Import the V1 contract to inherit its storage layout and functionality.
import { AbleToken } from "../AbleToken.sol";

/**
 * @title ABLE Token V2
 * @author Tradable
 * @notice A dummy V2 contract for testing the upgradeability of AbleToken.
 * @dev It inherits from AbleToken to ensure storage layout compatibility and adds a new `version` function.
 */
contract AbleTokenV2 is AbleToken {
  /**
   * @notice Returns the current version of the contract implementation.
   * @dev This function is new in V2 and is used to verify a successful upgrade in tests.
   * @return A string representing the version, "v2".
   */
  function version() public pure returns (string memory) {
    return "v2";
  }
}
