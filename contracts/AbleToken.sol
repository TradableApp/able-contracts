// SPDX-License-Identifier: MIT
pragma solidity ^0.8.21;

import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {
  ERC20Upgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {
  ERC20BurnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import {
  ERC20PausableUpgradeable
} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {
  OwnableUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import {
  UUPSUpgradeable
} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

/**
 * @title ABLE Token
 * @author Tradable
 * @notice A deflationary, pausable, and upgradeable ERC20 token for payments, platform utility,
 * and AI agent transactions.
 * @dev Implements ERC20, Burnable, Pausable, Ownable, and UUPS functionalities using OpenZeppelin
 * upgradeable contracts.
 */
contract AbleToken is
  Initializable,
  ERC20Upgradeable,
  ERC20BurnableUpgradeable,
  ERC20PausableUpgradeable,
  OwnableUpgradeable,
  UUPSUpgradeable
{
  /// @notice EIP-7201 compliant storage struct for the AbleToken contract.
  /// @custom:storage-location erc7201:openzeppelin.storage.AbleToken
  struct AbleTokenStorage {
    bool _gap; // Storage gap for future upgrades to prevent storage collisions.
  }

  /// @notice The EIP-7201 storage slot identifier for this contract's storage.
  bytes32 private constant ABLE_TOKEN_STORAGE_LOCATION =
    keccak256("openzeppelin.storage.AbleToken");

  /**
   * @notice Initializes the contract, setting the name, symbol, initial supply, and owner.
   * @dev This function can only be called once on the proxy contract. It's designed to be flexible,
   *      allowing different token configurations from a single contract source.
   * @param _name The name of the ERC20 token (e.g., "ABLE Token").
   * @param _symbol The symbol of the ERC20 token (e.g., "ABLE").
   * @param _initialSupply The total amount of tokens to be minted to the initial owner.
   * @param _initialOwner The address that will receive the initial supply and contract ownership.
   */
  function initialize(
    string memory _name,
    string memory _symbol,
    uint256 _initialSupply,
    address _initialOwner
  ) public initializer {
    __ERC20_init(_name, _symbol);
    __ERC20Burnable_init();
    __ERC20Pausable_init();
    __Ownable_init(_initialOwner);
    __UUPSUpgradeable_init();

    _mint(_initialOwner, _initialSupply);
  }

  /**
   * @notice Pauses all token transfers, minting, and burning.
   * @dev Can only be called by the contract owner. Emits a {Paused} event.
   *      All functions using the `whenNotPaused` modifier will be blocked.
   */
  function pause() public onlyOwner {
    _pause();
  }

  /**
   * @notice Unpauses the contract, resuming all token transfers.
   * @dev Can only be called by the contract owner. Emits an {Unpaused} event.
   */
  function unpause() public onlyOwner {
    _unpause();
  }

  /**
   * @notice Hook that is called before any token transfer, including minting and burning.
   * @dev Overridden to combine the ERC20 and ERC20Pausable `_update` functions, ensuring transfers
   *      are blocked when the contract is paused.
   * @param from The address from which tokens are being sent.
   * @param to The address to which tokens are being sent.
   * @param value The amount of tokens being transferred.
   */
  function _update(
    address from,
    address to,
    uint256 value
  ) internal override(ERC20Upgradeable, ERC20PausableUpgradeable) {
    super._update(from, to, value);
  }

  /**
   * @notice This internal function is part of the UUPS upgrade mechanism.
   * @dev Authorizes an upgrade to a new implementation contract. Access is restricted to the owner.
   * @param newImplementation The address of the new implementation contract.
   */
  function _authorizeUpgrade(address newImplementation) internal override onlyOwner {
    // solhint-disable-previous-line no-empty-blocks
    // Intentionally left blank. The onlyOwner modifier provides the necessary access control.
  }
}
