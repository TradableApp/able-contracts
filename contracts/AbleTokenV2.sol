// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

// Important: Import the V1 contract to inherit its storage layout and functionality.
import "./AbleToken.sol";

/// @title ABLE Token V2
/// @author Your Name/Organization
/// @notice Adds a version function to the AbleToken contract.
/// @dev This contract is intended as an upgrade for AbleToken.
/// It inherits from AbleToken to ensure storage layout compatibility.
contract AbleTokenV2 is AbleToken {
  /// @notice Returns the current version of the contract implementation.
  /// @dev This function is new in V2.
  /// @return A string representing the version, "v2".
  function version() public pure returns (string memory) {
    return "v2";
  }
}
