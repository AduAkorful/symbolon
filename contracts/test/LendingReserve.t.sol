// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {VaultTest} from "./utils/VaultTest.sol";
import {ISymbolonVault} from "../src/interfaces/ISymbolonVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MockERC20} from "./mocks/MockERC20.sol";
import {MockLendingVenue} from "./mocks/MockLendingVenue.sol";
import {VaultLens} from "../src/periphery/VaultLens.sol";

/// @notice The lending reserve (plan 05zk): one owner-approved ERC-4626 venue, opt-in, capped, bounded by the Vault's own
/// balance deltas. Written before the logic: against the size stub these fail, and they define what `LendingLogic` must do.
contract LendingReserveTest is VaultTest {
    uint256 internal constant VENUE_LIQUIDITY = 10_000_000 * ONE_USDC;
    uint256 internal constant MIN_OPERATING = 100_000 * ONE_USDC;
    uint16 internal constant MAX_LENDING_BPS = 5_000; // the contract's ceiling (plan 05zk Q3)
    uint256 internal constant DEPOSIT = 200_000 * ONE_USDC;
    bytes32 internal constant DECISION = keccak256("lending decision");

    MockLendingVenue internal venue;

    function setUp() public override {
        super.setUp();
        venue = new MockLendingVenue(IERC20(address(usdc)));
        // other depositors' money, so the venue can pay out at a price above 1
        usdc.mint(address(venue), VENUE_LIQUIDITY);
        _setOperatingFloor(MIN_OPERATING);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // helpers
    // ---------------------------------------------------------------------------------------------------------------

    function _policyOf(bool enabled, uint16 bps, address venue_)
        internal
        pure
        returns (ISymbolonVault.LendingPolicy memory)
    {
        return ISymbolonVault.LendingPolicy({enabled: enabled, maxLendingBps: bps, venue: venue_});
    }

    /// @dev The one operating floor is the reserve policy's `minOperating`; setting it (reserve off) is a tightening change
    function _setOperatingFloor(uint256 floor) internal {
        vm.prank(owner);
        vault.setReservePolicy(ISymbolonVault.ReservePolicy({enabled: false, maxReserveBps: 0, minOperating: floor}));
    }

    function _applyLooseningLending(ISymbolonVault.LendingPolicy memory p) internal {
        vm.startPrank(owner);
        vault.setLendingPolicy(p);
        vm.warp(block.timestamp + LOOSENING_DELAY);
        vault.setLendingPolicy(p);
        vm.stopPrank();
    }

    function _enable() internal {
        _applyLooseningLending(_policyOf(true, MAX_LENDING_BPS, address(venue)));
    }

    function _enableWithCap(uint16 bps) internal {
        _applyLooseningLending(_policyOf(true, bps, address(venue)));
    }

    /// @dev Asserts the money really moved, so a test built on it can't pass against logic that moves nothing
    function _deposited() internal returns (uint256 shares) {
        _enable();
        uint256 cashBefore = usdc.balanceOf(address(vault));
        vm.prank(steward);
        shares = vault.depositLending(DEPOSIT, 0, DECISION);
        assertGt(shares, 0, "shares minted");
        assertEq(venue.balanceOf(address(vault)), shares, "the Vault holds them");
        assertEq(cashBefore - usdc.balanceOf(address(vault)), DEPOSIT, "cash left the Vault");
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Policy
    // ---------------------------------------------------------------------------------------------------------------

    function test_lending_isOffOnAFreshVault() public {
        vm.prank(steward);
        vm.expectRevert(ISymbolonVault.LendingDisabled.selector);
        vault.depositLending(DEPOSIT, 0, DECISION);
    }

    function test_setLendingPolicy_enablingWaitsForTheLooseningDelay() public {
        ISymbolonVault.LendingPolicy memory p = _policyOf(true, MAX_LENDING_BPS, address(venue));
        vm.prank(owner);
        vault.setLendingPolicy(p);

        vm.prank(steward);
        vm.expectRevert(ISymbolonVault.LendingDisabled.selector);
        vault.depositLending(DEPOSIT, 0, DECISION);

        vm.warp(block.timestamp + LOOSENING_DELAY);
        vm.expectEmit(address(vault));
        emit ISymbolonVault.LendingPolicySet(p);
        vm.prank(owner);
        vault.setLendingPolicy(p);

        vm.prank(steward);
        vault.depositLending(DEPOSIT, 0, DECISION);
        assertGt(venue.balanceOf(address(vault)), 0);
    }

    function test_setLendingPolicy_disablingAndLoweringTheCapApplyImmediately() public {
        _enable();
        vm.prank(owner);
        vault.setLendingPolicy(_policyOf(true, 1_000, address(venue)));
        // 10% cap now: the 200,000 deposit (20% of 1,000,000) is refused straight away
        vm.prank(steward);
        vm.expectPartialRevert(ISymbolonVault.LendingShareExceeded.selector);
        vault.depositLending(DEPOSIT, 0, DECISION);

        vm.prank(owner);
        vault.setLendingPolicy(_policyOf(false, 1_000, address(venue)));
        vm.prank(steward);
        vm.expectRevert(ISymbolonVault.LendingDisabled.selector);
        vault.depositLending(1, 0, DECISION);
    }

    function test_setLendingPolicy_raisingTheCapIsDelayed() public {
        _enableWithCap(2_000);
        vm.prank(owner);
        vault.setLendingPolicy(_policyOf(true, 4_000, address(venue)));
        // queued, not applied: a 30% deposit still breaks the 20% cap
        vm.prank(steward);
        vm.expectPartialRevert(ISymbolonVault.LendingShareExceeded.selector);
        vault.depositLending(300_000 * ONE_USDC, 0, DECISION);
    }

    function test_setLendingPolicy_changingTheVenueIsDelayed() public {
        _enable();
        MockLendingVenue other = new MockLendingVenue(IERC20(address(usdc)));
        vm.prank(owner);
        vault.setLendingPolicy(_policyOf(true, MAX_LENDING_BPS, address(other)));
        vm.prank(steward);
        vault.depositLending(DEPOSIT, 0, DECISION);
        assertGt(venue.balanceOf(address(vault)), 0, "still the old venue");
        assertEq(other.balanceOf(address(vault)), 0);
    }

    function test_setLendingPolicy_venueCannotChangeWhileSharesAreHeld() public {
        _deposited();
        MockLendingVenue other = new MockLendingVenue(IERC20(address(usdc)));
        vm.prank(owner);
        vm.expectRevert(ISymbolonVault.LendingVaultInUse.selector);
        vault.setLendingPolicy(_policyOf(true, MAX_LENDING_BPS, address(other)));
    }

    function test_setLendingPolicy_venueCannotBeClearedWhileSharesAreHeld() public {
        _deposited();
        vm.prank(owner);
        vm.expectRevert(ISymbolonVault.LendingVaultInUse.selector);
        vault.setLendingPolicy(_policyOf(false, 0, address(0)));
    }

    function test_setLendingPolicy_venueCanChangeOnceTheSharesAreRedeemed() public {
        uint256 shares = _deposited();
        vm.prank(owner);
        vault.redeemLending(shares, 0, DECISION);
        MockLendingVenue other = new MockLendingVenue(IERC20(address(usdc)));
        _applyLooseningLending(_policyOf(true, MAX_LENDING_BPS, address(other)));
        vm.prank(steward);
        vault.depositLending(DEPOSIT, 0, DECISION);
        assertGt(other.balanceOf(address(vault)), 0);
    }

    function test_setLendingPolicy_ceilingIs5000Bps() public {
        vm.prank(owner);
        vm.expectRevert(ISymbolonVault.InvalidLendingPolicy.selector);
        vault.setLendingPolicy(_policyOf(true, MAX_LENDING_BPS + 1, address(venue)));

        // exactly the ceiling is accepted (queued, since enabling loosens)
        vm.prank(owner);
        vault.setLendingPolicy(_policyOf(true, MAX_LENDING_BPS, address(venue)));
    }

    function test_setLendingPolicy_rejectsAVenueWhoseAssetIsNotSupported() public {
        MockERC20 other = new MockERC20("Other", "OTH", 6);
        MockLendingVenue wrong = new MockLendingVenue(IERC20(address(other)));
        vm.prank(owner);
        vm.expectRevert(ISymbolonVault.InvalidLendingPolicy.selector);
        vault.setLendingPolicy(_policyOf(true, MAX_LENDING_BPS, address(wrong)));
    }

    function test_setLendingPolicy_rejectsZeroSelfLedgerAndTokenAsVenue() public {
        address[4] memory bad = [address(0), address(vault), address(ledger), address(usdc)];
        for (uint256 i; i < bad.length; ++i) {
            vm.prank(owner);
            vm.expectRevert();
            vault.setLendingPolicy(_policyOf(true, MAX_LENDING_BPS, bad[i]));
        }
    }

    function test_setLendingPolicy_disabledWithNoVenueIsAccepted() public {
        vm.prank(owner);
        vault.setLendingPolicy(_policyOf(false, 0, address(0)));
        // and enabling without a venue is not
        vm.prank(owner);
        vm.expectRevert(ISymbolonVault.InvalidLendingPolicy.selector);
        vault.setLendingPolicy(_policyOf(true, MAX_LENDING_BPS, address(0)));
    }

    function test_setLendingPolicy_onlyOwner() public {
        vm.prank(steward);
        vm.expectRevert();
        vault.setLendingPolicy(_policyOf(false, 0, address(venue)));
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Deposit
    // ---------------------------------------------------------------------------------------------------------------

    function test_depositLending_movesCashToVenueSharesHeldByTheVault() public {
        _enable();
        uint256 expected = venue.previewDeposit(DEPOSIT);
        uint256 cashBefore = usdc.balanceOf(address(vault));

        vm.expectEmit(address(vault));
        emit ISymbolonVault.LendingDeposited(steward, DEPOSIT, expected, DECISION);
        vm.prank(steward);
        uint256 shares = vault.depositLending(DEPOSIT, expected, DECISION);

        assertEq(shares, expected);
        assertEq(venue.balanceOf(address(vault)), expected, "the Vault, and nobody else, holds the shares");
        assertEq(venue.balanceOf(steward), 0);
        assertEq(cashBefore - usdc.balanceOf(address(vault)), DEPOSIT);
        assertEq(usdc.allowance(address(vault), address(venue)), 0, "approval reset");
    }

    function test_depositLending_ownerMayToo() public {
        _enable();
        vm.prank(owner);
        vault.depositLending(DEPOSIT, 0, DECISION);
        assertGt(venue.balanceOf(address(vault)), 0);
    }

    function test_depositLending_revertsBelowMinShares() public {
        _enable();
        uint256 expected = venue.previewDeposit(DEPOSIT);
        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.LendingSlippage.selector, expected + 1, expected));
        vault.depositLending(DEPOSIT, expected + 1, DECISION);
    }

    function test_depositLending_minSharesIsCheckedAgainstTheBalanceNotTheReturnValue() public {
        _enable();
        // the venue mints 5 units short but claims 1,000 more than it minted
        venue.setLie(1_000, 5);
        uint256 honest = venue.previewDeposit(DEPOSIT);
        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.LendingSlippage.selector, honest, honest - 5));
        vault.depositLending(DEPOSIT, honest, DECISION);
    }

    function test_depositLending_refusesAVenueThatMintsJunkEvenWithMinSharesZero() public {
        _enable();
        venue.setSkimBps(500); // 5% of the shares withheld, far beyond the 10 bps entry tolerance
        vm.prank(steward);
        vm.expectPartialRevert(ISymbolonVault.LendingSlippage.selector);
        vault.depositLending(DEPOSIT, 0, DECISION);
    }

    function test_depositLending_allowsOneUnitOfRoundingOnATinyAmount() public {
        _enable();
        venue.setPrice(1.001058e18); // the live vault's share price on 2026-10-13
        vm.prank(steward);
        vault.depositLending(100, 0, DECISION); // 100 units (0.0001 USDC): one unit lost is 1%, still accepted
        assertGt(venue.balanceOf(address(vault)), 0);
    }

    function test_depositLending_capsTheShareOfTheTreasury() public {
        _enableWithCap(2_000); // 20%
        // exactly 20% of 1,000,000 is allowed
        uint256 cashBefore = usdc.balanceOf(address(vault));
        vm.prank(steward);
        uint256 shares = vault.depositLending(200_000 * ONE_USDC, 0, DECISION);
        assertEq(venue.balanceOf(address(vault)), shares);
        assertEq(cashBefore - usdc.balanceOf(address(vault)), 200_000 * ONE_USDC, "the money moved");
    }

    function test_depositLending_oneUnitOverTheCapIsRefused() public {
        _enableWithCap(2_000);
        vm.prank(steward);
        vm.expectPartialRevert(ISymbolonVault.LendingShareExceeded.selector);
        vault.depositLending(200_000 * ONE_USDC + 1, 0, DECISION);
    }

    function test_depositLending_keepsTheOperatingFloor() public {
        _enable();
        _setOperatingFloor(600_000 * ONE_USDC);
        // 400,000 leaves exactly the floor: allowed
        vm.prank(steward);
        vault.depositLending(400_000 * ONE_USDC, 0, DECISION);
        // one more unit would dip below it
        vm.prank(steward);
        vm.expectRevert(
            abi.encodeWithSelector(ISymbolonVault.OperatingFloor.selector, 600_000 * ONE_USDC, 600_000 * ONE_USDC - 1)
        );
        vault.depositLending(1, 0, DECISION);
    }

    function test_depositLending_blockedWhilePaused() public {
        _enable();
        vm.prank(owner);
        vault.pause();
        vm.prank(steward);
        vm.expectRevert(ISymbolonVault.VaultPaused.selector);
        vault.depositLending(DEPOSIT, 0, DECISION);
        vm.prank(owner);
        vm.expectRevert(ISymbolonVault.VaultPaused.selector);
        vault.depositLending(DEPOSIT, 0, DECISION);
    }

    function test_depositLending_onlyStewardOrOwner() public {
        _enable();
        address[2] memory others = [approver, requester];
        for (uint256 i; i < others.length; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(ISymbolonVault.NotTreasurer.selector);
            vault.depositLending(DEPOSIT, 0, DECISION);
        }
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Redeem
    // ---------------------------------------------------------------------------------------------------------------

    function test_redeemLending_returnsCashToTheVault() public {
        uint256 shares = _deposited();
        venue.setPrice(1.2e18);
        uint256 expected = venue.previewRedeem(shares);
        uint256 cashBefore = usdc.balanceOf(address(vault));

        vm.expectEmit(address(vault));
        emit ISymbolonVault.LendingRedeemed(steward, shares, expected, DECISION);
        vm.prank(steward);
        assertEq(vault.redeemLending(shares, expected, DECISION), expected);

        assertEq(usdc.balanceOf(address(vault)) - cashBefore, expected);
        assertEq(venue.balanceOf(address(vault)), 0);
    }

    function test_redeemLending_withoutAVenueIsRefused() public {
        vm.prank(owner);
        vm.expectRevert(ISymbolonVault.LendingDisabled.selector);
        vault.redeemLending(1, 0, DECISION);
    }

    function test_redeemLending_worksWithLendingDisabled() public {
        uint256 shares = _deposited();
        vm.prank(owner);
        vault.setLendingPolicy(_policyOf(false, MAX_LENDING_BPS, address(venue)));
        vm.prank(steward);
        vault.redeemLending(shares, 0, DECISION);
        assertEq(venue.balanceOf(address(vault)), 0);
    }

    function test_redeemLending_pausedBlocksTheStewardButNotTheOwner() public {
        uint256 shares = _deposited();
        vm.prank(owner);
        vault.pause();
        vm.prank(steward);
        vm.expectRevert(ISymbolonVault.VaultPaused.selector);
        vault.redeemLending(shares, 0, DECISION);
        vm.prank(owner);
        vault.redeemLending(shares, 0, DECISION);
        assertEq(venue.balanceOf(address(vault)), 0);
    }

    function test_redeemLending_onlyStewardOrOwner() public {
        uint256 shares = _deposited();
        vm.prank(approver);
        vm.expectRevert(ISymbolonVault.NotTreasurer.selector);
        vault.redeemLending(shares, 0, DECISION);
    }

    function test_redeemLending_minAssetsIsCheckedAgainstTheBalance() public {
        uint256 shares = _deposited();
        venue.setLie(1_000_000, 7); // pays 7 short while claiming a million more
        uint256 honest = venue.previewRedeem(shares);
        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.LendingSlippage.selector, honest, honest - 7));
        vault.redeemLending(shares, honest, DECISION);
    }

    function test_redeemLending_whenTheVenueCannotPayOutTheSharesStayHeldAndNothingIsLost() public {
        uint256 shares = _deposited();
        venue.setExitReverts(true);
        uint256 cashBefore = usdc.balanceOf(address(vault));
        vm.prank(owner);
        vm.expectRevert(MockLendingVenue.ExitBlocked.selector);
        vault.redeemLending(shares, 0, DECISION);
        assertEq(venue.balanceOf(address(vault)), shares, "shares untouched");
        assertEq(usdc.balanceOf(address(vault)), cashBefore, "cash untouched");

        // and the Vault keeps working: it can still pay (the reserve is not the operating cash)
        venue.setExitReverts(false);
        vm.prank(owner);
        vault.redeemLending(shares, 0, DECISION);
    }

    function test_redeemLending_whenTheVenueGatesTheVaultOutTheSharesStayHeld() public {
        uint256 shares = _deposited();
        venue.setGated(address(vault), true);
        vm.prank(owner);
        vm.expectRevert(abi.encodeWithSelector(MockLendingVenue.GateClosed.selector, address(vault)));
        vault.redeemLending(shares, 0, DECISION);
        assertEq(venue.balanceOf(address(vault)), shares);
    }

    function test_redeemLending_roundTripLosesAtMostOneUnitPerLeg() public {
        _enable();
        venue.setPrice(1.001058e18);
        uint256 cashBefore = usdc.balanceOf(address(vault));
        vm.startPrank(owner);
        uint256 shares = vault.depositLending(DEPOSIT, 0, DECISION);
        assertEq(cashBefore - usdc.balanceOf(address(vault)), DEPOSIT, "the deposit moved the cash");
        // the exact deposit as minAssets is not reachable; one unit under it is
        vault.redeemLending(shares, DEPOSIT - 1, DECISION);
        vm.stopPrank();
        assertEq(venue.balanceOf(address(vault)), 0, "all shares redeemed");
        assertLe(usdc.balanceOf(address(vault)), cashBefore);
        assertGe(usdc.balanceOf(address(vault)), cashBefore - 2);
    }

    function testFuzz_lending_roundTripNeverCreatesValue(uint256 amount, uint256 price) public {
        amount = bound(amount, ONE_USDC, 400_000 * ONE_USDC);
        price = bound(price, 0.5e18, 5e18);
        venue.setPrice(price);
        _enable();
        uint256 cashBefore = usdc.balanceOf(address(vault));
        vm.startPrank(owner);
        uint256 shares = vault.depositLending(amount, 0, DECISION);
        assertEq(cashBefore - usdc.balanceOf(address(vault)), amount, "the deposit moved the cash");
        assertEq(venue.balanceOf(address(vault)), shares);
        vault.redeemLending(shares, 0, DECISION);
        vm.stopPrank();
        assertEq(venue.balanceOf(address(vault)), 0, "all shares redeemed");
        uint256 cashAfter = usdc.balanceOf(address(vault));
        assertLe(cashAfter, cashBefore, "rounding never favours the Vault");
        // two floor divisions lose at most a unit of shares' worth of asset plus one unit
        assertLe(cashBefore - cashAfter, price / 1e18 + 2);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Reentrancy and isolation from payments
    // ---------------------------------------------------------------------------------------------------------------

    function test_depositLending_venueCallingBackIntoTheVaultIsBlocked() public {
        _enable();
        venue.setCallback(address(vault), abi.encodeCall(vault.depositLending, (ONE_USDC, 0, DECISION)));
        vm.prank(steward);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vault.depositLending(DEPOSIT, 0, DECISION);
    }

    function test_redeemLending_venueCallingBackIntoTheVaultIsBlocked() public {
        uint256 shares = _deposited();
        venue.setCallback(address(vault), abi.encodeCall(vault.redeemLending, (1, 0, DECISION)));
        vm.prank(steward);
        vm.expectRevert(ReentrancyGuard.ReentrancyGuardReentrantCall.selector);
        vault.redeemLending(shares, 0, DECISION);
    }

    function test_lendingShares_cannotBeUsedToPayOrWithdraw() public {
        _deposited();
        uint256 shares = venue.balanceOf(address(vault));
        vm.prank(owner);
        vm.expectRevert(); // a venue's share token is not a supported payment token
        vault.setSupportedToken(address(venue), true);
        // withdraw moves any token the owner asks for, and is owner-only: the steward cannot reach the shares
        vm.prank(steward);
        vm.expectRevert();
        vault.withdraw(address(venue), steward, shares);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Lens
    // ---------------------------------------------------------------------------------------------------------------

    function test_lens_aVaultThatNeverSetLendingReadsAsOffWithNoVenue() public view {
        ISymbolonVault.LendingPolicy memory p = lens.getLendingPolicy(address(vault));
        assertFalse(p.enabled);
        assertEq(p.maxLendingBps, 0);
        assertEq(p.venue, address(0));
        VaultLens.LendingStatus memory st = lens.lendingStatus(address(vault));
        assertEq(st.asset, address(0));
        assertEq(st.shares, 0);
        assertFalse(st.valueKnown);
    }

    function testFuzz_lens_lendingPolicyRoundTripLeavesNeighboursAlone(bool enabled, uint16 bps) public {
        bps = uint16(bound(bps, 0, MAX_LENDING_BPS));
        ISymbolonVault.LendingPolicy memory p = _policyOf(enabled, bps, address(venue));
        _applyLooseningLending(p);
        ISymbolonVault.LendingPolicy memory got = lens.getLendingPolicy(address(vault));
        assertEq(got.enabled, enabled);
        assertEq(got.maxLendingBps, bps);
        assertEq(got.venue, address(venue));
        // the words either side of it are untouched
        assertEq(lens.getReservePolicy(address(vault)).minOperating, MIN_OPERATING);
        assertEq(lens.accountingDecimals(address(vault)), 6);
        assertFalse(lens.autoUpdate(address(vault)));
    }

    function test_lens_lendingStatusReportsSharesValueAndAsset() public {
        uint256 shares = _deposited();
        venue.setPrice(1.05e18);
        VaultLens.LendingStatus memory st = lens.lendingStatus(address(vault));
        assertEq(st.asset, address(usdc));
        assertEq(st.cash, usdc.balanceOf(address(vault)));
        assertEq(st.shares, shares);
        assertTrue(st.valueKnown);
        assertEq(st.lendingValue, venue.convertToAssets(shares));
        assertEq(st.redeemable, venue.previewRedeem(shares));
        assertTrue(st.policy.enabled);
        assertEq(st.policy.venue, address(venue));
    }

    function test_lens_aVenueThatCannotBeReadIsReportedNotThrown() public {
        _deposited();
        vm.mockCallRevert(address(venue), abi.encodeWithSelector(MockLendingVenue.convertToAssets.selector), "");
        VaultLens.LendingStatus memory st = lens.lendingStatus(address(vault));
        assertFalse(st.valueKnown);
        assertEq(st.lendingValue, 0);
        assertGt(st.shares, 0, "the shares are still shown");
    }
}

