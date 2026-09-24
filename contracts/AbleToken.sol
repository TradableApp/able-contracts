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
  Ownable2StepUpgradeable
} from "@openzeppelin/contracts-upgradeable/access/Ownable2StepUpgradeable.sol";
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
  Ownable2StepUpgradeable,
  UUPSUpgradeable
{
  /// @notice Retained solely to preserve the deployed ERC-7201 storage namespace.
  /// @dev Nothing reads or writes this struct. It must stay declared and unchanged: deleting or
  ///      renaming a namespace that the deployed implementation declared makes OpenZeppelin's
  ///      `assertStorageUpgradeSafe` reject the upgrade, stranding the live proxy.
  /// @custom:storage-location erc7201:openzeppelin.storage.AbleToken
  struct AbleTokenStorage {
    bool _gap; // Frozen — do not add, remove or rename.
  }

  /// @notice Thrown by {renounceOwnership} — ownership of this token cannot be abandoned.
  error OwnershipCannotBeRenounced();

  /**
   * @notice Locks the implementation contract so it can never be initialised directly.
   * @dev An uninitialised implementation can be claimed by anyone. That cannot reach the proxy's
   *      storage, but it does leave a source-verified, identical-bytecode "ABLE Token" at a real
   *      address — ideal material for fake liquidity pools and phishing.
   */
  /// @custom:oz-upgrades-unsafe-allow constructor
  constructor() {
    _disableInitializers();
  }

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
    // __Ownable_init assigns _owner and is required: OZ v5's __Ownable2Step_init() is an empty
    // body that does not chain to it. __Ownable2Step_init() is a no-op today, called so that any
    // state a future OZ release adds is initialised — and called second, so it can never observe
    // a zero owner. This runs on fresh deployments only: upgrading the live proxy onto a release
    // that adds Ownable2Step state would need a reinitializer.
    __Ownable_init(_initialOwner);
    __Ownable2Step_init();
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
   * @notice Disabled — ownership of this token cannot be renounced.
   * @dev Renouncing would set the owner to address(0) permanently, leaving an upgradeable,
   *      pausable token that can never again be paused, unpaused or upgraded. Inheriting
   *      {Ownable2StepUpgradeable} does not cover this: it overrides `transferOwnership` but
   *      leaves `renounceOwnership` as the inherited single-step version.
   *
   *      `onlyOwner` is kept so a non-owner gets {OwnableUnauthorizedAccount} while the owner
   *      gets {OwnershipCannotBeRenounced}.
   *
   *      solc suggests `view` here; do not apply it. That flips the ABI's `stateMutability`, and
   *      consumers dispatch on it — ethers routes `view` through `eth_call` rather than a
   *      transaction, and wallets file it under reads rather than admin writes.
   */
  function renounceOwnership() public override onlyOwner {
    revert OwnershipCannotBeRenounced();
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

  /// @dev Reserved slots for future non-namespaced storage. Not present in the implementation
  ///      currently deployed behind the live proxies — it was added after that deployment. The
  ///      difference is an append, which OpenZeppelin permits, and the storage tests assert it
  ///      against the deployment manifest.
  uint256[50] private __gap;
}
