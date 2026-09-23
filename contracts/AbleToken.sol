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
  /// @dev Nothing reads or writes this struct — it never held live data. It must nevertheless
  ///      stay declared: deleting a namespace that the deployed implementation declared makes
  ///      OpenZeppelin's `assertStorageUpgradeSafe` reject the upgrade ("Deleted namespace
  ///      `erc7201:openzeppelin.storage.AbleToken`"), which would block `upgradeProxy` on the
  ///      live proxy. Removing it buys nothing and costs the upgrade path.
  ///
  ///      Do not add fields either, and do not rename `_gap`. There is no accessor for this
  ///      slot, so a new field would be unreachable while still widening the namespace the
  ///      upgrade checker compares against the live deployment. A rename is rejected outright —
  ///      `assertStorageUpgradeSafe` reports "Renamed `_gap` to ..." and the upgrade fails, so
  ///      the misleading name is kept deliberately. Treat this struct as frozen: it is a marker
  ///      for the upgrade checker, not storage.
  /// @custom:storage-location erc7201:openzeppelin.storage.AbleToken
  struct AbleTokenStorage {
    bool _gap; // Frozen — do not add, remove or rename. See the NatSpec above.
  }

  /// @notice Thrown by {renounceOwnership} — ownership of this token cannot be abandoned.
  error OwnershipCannotBeRenounced();

  /**
   * @notice Locks the implementation contract so it can never be initialised directly.
   * @dev Without this, anyone can call {initialize} on the implementation that sits behind
   *      the proxy and become its owner. That cannot reach the proxy's storage, and OZ v5's
   *      `onlyProxy` guard blocks upgrading through it — but it does leave an attacker with a
   *      source-verified, identical-bytecode "ABLE Token" at a real address, which is ideal
   *      material for fake liquidity pools and phishing. OpenZeppelin's documented rule is
   *      blunt: "Do not leave an implementation contract uninitialized."
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
    // __Ownable_init is what actually assigns _owner, and it is required: OZ v5's
    // __Ownable2Step_init() is an empty body that does NOT chain to __Ownable_init_unchained().
    // Do not remove it. The __Ownable2Step_init() call below is a no-op today and is kept so
    // that state added to Ownable2Step by a future OZ release is initialised automatically —
    // an omission there would not fail any test, it would only show up on a live deployment.
    // The order matters for that same reason: if Ownable2Step ever gains state, initialising it
    // before _owner is assigned could leave it referencing an owner that is still address(0).
    //
    // Scope: this covers FRESH proxy deployments only. initialize() is never re-run on an
    // upgrade, so an already-deployed proxy moving to an OZ release that adds Ownable2Step
    // state would get that state zero-initialised by the EVM, not by this call. Such an upgrade
    // needs a reinitializer — which matters here, because the live proxy is exactly that case.
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
   * @dev Inherited {renounceOwnership} would set the owner to address(0) permanently, which on
   *      an upgradeable, pausable token means no further {pause}, {unpause} or upgrade is ever
   *      possible. There is no recovery from that, so the function is made to revert rather
   *      than left reachable.
   *
   *      Switching to {Ownable2StepUpgradeable} does not make this unnecessary. That contract
   *      overrides `transferOwnership` and `_transferOwnership`, but deliberately leaves
   *      `renounceOwnership` alone — it is still `OwnableUpgradeable`'s, which calls
   *      `_transferOwnership(address(0))` in a single step with no pending-owner to accept.
   *      Two-step ownership protects transfers, not renouncing. This override is the only
   *      thing standing between the token and a permanently ownerless proxy, so do not remove
   *      it on the reasoning that the base class now handles ownership safely.
   *
   *      `onlyOwner` is kept, so a non-owner receives {OwnableUnauthorizedAccount} while the
   *      owner receives {OwnershipCannotBeRenounced}. That split is deliberate: each caller is
   *      told the thing that is true of them, and it keeps the modifier set identical to the
   *      inherited function being replaced. Dropping it would report the policy to callers who
   *      are also not authorised, which is less informative, not more.
   *
   *      solc warns "Function state mutability can be restricted to view" here. Do NOT act on
   *      it. Marking this `view` flips the ABI's `stateMutability` from `nonpayable` to `view`,
   *      and consumers dispatch on that field: ethers v6 sends `view` calls through `eth_call`
   *      instead of a transaction, and Safe{Wallet} files them under read-only rather than the
   *      admin write panel next to {pause} and {transferOwnership}. The warning is unavoidable
   *      for any always-reverting override — `onlyOwner` reads state but writes none — so it is
   *      accepted deliberately in exchange for an ABI that matches the inherited function.
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

  /// @dev Reserved slots for future non-namespaced storage. Note this is NOT present in the
  ///      implementation currently deployed behind the live proxies: it was added after that
  ///      deployment, so `.openzeppelin/base.json` records `storage: []` for the deployed
  ///      implementation while every artifact built from this source carries the gap. That
  ///      difference is an append, which OpenZeppelin permits, and is asserted by the storage
  ///      tests — but do not try to reconcile the two layouts by eye and conclude one is wrong.
  uint256[50] private __gap;
}
