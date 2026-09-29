// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {VaultTest} from "./utils/VaultTest.sol";
import {ISymbolonVault} from "../src/interfaces/ISymbolonVault.sol";
import {IUsycTeller} from "../src/interfaces/IUsycTeller.sol";
import {SymbolonVault} from "../src/SymbolonVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";
import {VaultLens} from "../src/periphery/VaultLens.sol";
import {MockUsycTeller} from "./mocks/MockUsycTeller.sol";

/// @notice The USYC reserve (plan 04): opt-in, entitlement-gated, bounded by the owner's reserve policy
contract ReserveTest is VaultTest {
    uint256 internal constant TREASURY_FUNDS = 10_000_000 * ONE_USDC;
    uint256 internal constant MIN_OPERATING = 100_000 * ONE_USDC;
    uint16 internal constant MAX_RESERVE_BPS = 8_000;
    uint256 internal constant SWEEP = 500_000 * ONE_USDC;
    bytes32 internal constant DECISION = keccak256("decision");

    MockUsycTeller internal teller;

    function _usycTeller() internal override returns (IUsycTeller) {
        teller = new MockUsycTeller(usdc);
        return IUsycTeller(address(teller));
    }

    function setUp() public override {
        super.setUp();
        address treasury = teller.treasuryAccount();
        usdc.mint(treasury, TREASURY_FUNDS);
        vm.prank(treasury);
        usdc.approve(address(teller), type(uint256).max);
        teller.entitlements().setAllowed(address(vault), true);
    }

    function _reservePolicy(bool enabled) internal pure returns (ISymbolonVault.ReservePolicy memory) {
        return
            ISymbolonVault.ReservePolicy({
                enabled: enabled, maxReserveBps: MAX_RESERVE_BPS, minOperating: MIN_OPERATING
            });
    }

    function _enable() internal {
        ISymbolonVault.ReservePolicy memory p = _reservePolicy(true);
        vm.startPrank(owner);
        vault.setReservePolicy(p);
        vm.warp(block.timestamp + LOOSENING_DELAY);
        vault.setReservePolicy(p);
        vm.stopPrank();
    }

    function _usycBalance() internal view returns (uint256) {
        return teller.usycToken().balanceOf(address(vault));
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Policy
    // ---------------------------------------------------------------------------------------------------------------

    function test_setReservePolicy_refusesAVaultCircleHasNotAllowlisted() public {
        teller.entitlements().setAllowed(address(vault), false);
        vm.prank(owner);
        vm.expectRevert(ISymbolonVault.ReserveNotEntitled.selector);
        vault.setReservePolicy(_reservePolicy(true));
    }

    function test_setReservePolicy_enablingWaitsForTheLooseningDelay() public {
        vm.prank(owner);
        vault.setReservePolicy(_reservePolicy(true));
        assertFalse(lens.getReservePolicy(address(vault)).enabled, "queued, not applied");

        vm.prank(owner);
        vm.expectRevert(ISymbolonVault.ReserveDisabled.selector);
        vault.subscribeReserve(ONE_USDC, 0, DECISION);

        vm.warp(block.timestamp + LOOSENING_DELAY);
        vm.prank(owner);
        vault.setReservePolicy(_reservePolicy(true));
        ISymbolonVault.ReservePolicy memory p = lens.getReservePolicy(address(vault));
        assertTrue(p.enabled);
        assertEq(p.maxReserveBps, MAX_RESERVE_BPS);
        assertEq(p.minOperating, MIN_OPERATING);
    }

    function test_setReservePolicy_disablingAndTighteningApplyImmediately() public {
        _enable();
        ISymbolonVault.ReservePolicy memory p = _reservePolicy(true);
        p.minOperating = MIN_OPERATING * 2;
        p.maxReserveBps = MAX_RESERVE_BPS / 2;
        vm.prank(owner);
        vault.setReservePolicy(p);
        assertEq(lens.getReservePolicy(address(vault)).minOperating, MIN_OPERATING * 2);

        // switching off (keeping the tighter limits) is itself a tightening change
        p.enabled = false;
        vm.prank(owner);
        vault.setReservePolicy(p);
        assertFalse(lens.getReservePolicy(address(vault)).enabled);
    }

    function test_setReservePolicy_disablingWhileLooseningOtherLimitsStillWaits() public {
        _enable();
        ISymbolonVault.ReservePolicy memory p = _reservePolicy(false);
        p.minOperating = 0;
        vm.prank(owner);
        vault.setReservePolicy(p);
        assertTrue(lens.getReservePolicy(address(vault)).enabled, "a lower floor rides with it, so it queues");
    }

    function test_setReservePolicy_loweringTheFloorIsDelayed() public {
        _enable();
        ISymbolonVault.ReservePolicy memory p = _reservePolicy(true);
        p.minOperating = 0;
        vm.prank(owner);
        vault.setReservePolicy(p);
        assertEq(lens.getReservePolicy(address(vault)).minOperating, MIN_OPERATING, "queued");
    }

    function testFuzz_lens_reservePolicyRoundTrip(bool enabled, uint16 bps, uint256 minOperating) public {
        bps = uint16(bound(bps, 0, 10_000));
        ISymbolonVault.ReservePolicy memory p =
            ISymbolonVault.ReservePolicy({enabled: enabled, maxReserveBps: bps, minOperating: minOperating});
        vm.startPrank(owner);
        vault.setReservePolicy(p);
        vm.warp(block.timestamp + LOOSENING_DELAY);
        vault.setReservePolicy(p);
        vm.stopPrank();
        ISymbolonVault.ReservePolicy memory got = lens.getReservePolicy(address(vault));
        assertEq(got.enabled, enabled);
        assertEq(got.maxReserveBps, bps);
        assertEq(got.minOperating, minOperating);
        // the neighbouring flags word is untouched
        assertEq(lens.accountingDecimals(address(vault)), 6);
        assertFalse(lens.autoUpdate(address(vault)));
    }

    function test_setReservePolicy_rejectsOver100Percent() public {
        ISymbolonVault.ReservePolicy memory p = _reservePolicy(false);
        p.maxReserveBps = 10_001;
        vm.prank(owner);
        vm.expectRevert(ISymbolonVault.InvalidReservePolicy.selector);
        vault.setReservePolicy(p);
    }

    function test_setReservePolicy_onlyOwner() public {
        vm.prank(steward);
        vm.expectRevert();
        vault.setReservePolicy(_reservePolicy(false));
    }

    function test_setSupportedToken_refusesUsyc() public {
        address usycToken = address(teller.usycToken());
        vm.prank(owner);
        vm.expectRevert(ISymbolonVault.UsycNotPayable.selector);
        vault.setSupportedToken(usycToken, true);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Subscribe
    // ---------------------------------------------------------------------------------------------------------------

    function test_subscribeReserve_movesCashIntoUsycHeldByTheVault() public {
        _enable();
        uint256 expected = SWEEP * 1e18 / teller.price();
        uint256 cashBefore = usdc.balanceOf(address(vault));

        vm.expectEmit(address(vault));
        emit ISymbolonVault.ReserveSubscribed(steward, SWEEP, expected, DECISION);
        vm.prank(steward);
        uint256 shares = vault.subscribeReserve(SWEEP, expected, DECISION);

        assertEq(shares, expected);
        assertEq(_usycBalance(), expected);
        assertEq(cashBefore - usdc.balanceOf(address(vault)), SWEEP);
        assertEq(usdc.allowance(address(vault), address(teller)), 0, "approval reset");

        VaultLens.ReserveStatus memory st = lens.reserveStatus(address(vault));
        assertEq(st.usycTeller, address(teller));
        assertTrue(st.entitled);
        assertEq(st.shares, expected);
        assertEq(st.cash, usdc.balanceOf(address(vault)));
        assertEq(st.reserveValue, expected * teller.price() / 1e18);
    }

    function test_subscribeReserve_netOfTheTellersFee() public {
        _enable();
        teller.setFeeRate(0.001e18);
        uint256 expected = (SWEEP - SWEEP / 1000) * 1e18 / teller.price();
        vm.prank(owner);
        assertEq(vault.subscribeReserve(SWEEP, expected, DECISION), expected);
    }

    function test_subscribeReserve_disabled() public {
        vm.prank(owner);
        vm.expectRevert(ISymbolonVault.ReserveDisabled.selector);
        vault.subscribeReserve(SWEEP, 0, DECISION);
    }

    function test_subscribeReserve_onlyStewardOrOwner() public {
        _enable();
        address[2] memory others = [approver, requester];
        for (uint256 i; i < others.length; ++i) {
            vm.prank(others[i]);
            vm.expectRevert(ISymbolonVault.NotTreasurer.selector);
            vault.subscribeReserve(SWEEP, 0, DECISION);
        }
    }

    function test_subscribeReserve_blockedWhilePaused() public {
        _enable();
        vm.prank(owner);
        vault.pause();
        vm.prank(steward);
        vm.expectRevert(ISymbolonVault.VaultPaused.selector);
        vault.subscribeReserve(SWEEP, 0, DECISION);
        vm.prank(owner);
        vm.expectRevert(ISymbolonVault.VaultPaused.selector);
        vault.subscribeReserve(SWEEP, 0, DECISION);
    }

    function test_subscribeReserve_minSharesIsCheckedAgainstTheBalanceNotTheReturnValue() public {
        _enable();
        // the Teller mints 5 units short but claims 1,000 more than it minted
        teller.setLie(1_000, 5);
        uint256 honest = SWEEP * 1e18 / teller.price();
        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.ReserveSlippage.selector, honest, honest - 5));
        vault.subscribeReserve(SWEEP, honest, DECISION);
    }

    function test_subscribeReserve_keepsTheOperatingFloor() public {
        _enable();
        uint256 tooMuch = VAULT_FUNDS - MIN_OPERATING + 1;
        vm.prank(steward);
        vm.expectRevert(
            abi.encodeWithSelector(ISymbolonVault.OperatingFloor.selector, MIN_OPERATING, MIN_OPERATING - 1)
        );
        vault.subscribeReserve(tooMuch, 0, DECISION);
    }

    function test_subscribeReserve_capsTheReserveShare() public {
        _enable();
        // 85% of 1,000,000 in USYC breaches an 80% cap even though the floor still holds
        uint256 amount = 850_000 * ONE_USDC;
        vm.prank(steward);
        vm.expectPartialRevert(ISymbolonVault.ReserveShareExceeded.selector);
        vault.subscribeReserve(amount, 0, DECISION);
    }

    function test_subscribeReserve_stopsWhenCircleRevokesTheVault() public {
        _enable();
        teller.entitlements().setAllowed(address(vault), false);
        vm.prank(steward);
        vm.expectRevert(MockUsycTeller.NotPermissioned.selector);
        vault.subscribeReserve(SWEEP, 0, DECISION);
        assertFalse(lens.reserveStatus(address(vault)).entitled);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Redeem
    // ---------------------------------------------------------------------------------------------------------------

    function _subscribed() internal returns (uint256 shares) {
        _enable();
        vm.prank(steward);
        shares = vault.subscribeReserve(SWEEP, 0, DECISION);
    }

    function test_redeemReserve_returnsCashToTheVault() public {
        uint256 shares = _subscribed();
        teller.setPrice(1.2e18);
        uint256 expected = shares * 1.2e18 / 1e18;
        uint256 cashBefore = usdc.balanceOf(address(vault));

        vm.expectEmit(address(vault));
        emit ISymbolonVault.ReserveRedeemed(steward, shares, expected, DECISION);
        vm.prank(steward);
        assertEq(vault.redeemReserve(shares, expected, DECISION), expected);
        assertEq(usdc.balanceOf(address(vault)) - cashBefore, expected);
        assertEq(_usycBalance(), 0);
    }

    function test_redeemReserve_worksWithTheReserveDisabled() public {
        uint256 shares = _subscribed();
        vm.prank(owner);
        vault.setReservePolicy(_reservePolicy(false));
        vm.prank(steward);
        vault.redeemReserve(shares, 0, DECISION);
        assertEq(_usycBalance(), 0);
    }

    function test_redeemReserve_pausedBlocksTheStewardButNotTheOwner() public {
        uint256 shares = _subscribed();
        vm.prank(owner);
        vault.pause();
        vm.prank(steward);
        vm.expectRevert(ISymbolonVault.VaultPaused.selector);
        vault.redeemReserve(shares, 0, DECISION);
        vm.prank(owner);
        vault.redeemReserve(shares, 0, DECISION);
        assertEq(_usycBalance(), 0);
    }

    function test_redeemReserve_onlyStewardOrOwner() public {
        uint256 shares = _subscribed();
        vm.prank(approver);
        vm.expectRevert(ISymbolonVault.NotTreasurer.selector);
        vault.redeemReserve(shares, 0, DECISION);
    }

    function test_redeemReserve_minAssetsIsCheckedAgainstTheBalance() public {
        uint256 shares = _subscribed();
        teller.setLie(1_000_000, 7);
        uint256 honest = shares * teller.price() / 1e18;
        vm.prank(steward);
        vm.expectRevert(abi.encodeWithSelector(ISymbolonVault.ReserveSlippage.selector, honest, honest - 7));
        vault.redeemReserve(shares, honest, DECISION);
    }

    function testFuzz_reserve_roundTripNeverCreatesValue(uint256 amount, uint256 price) public {
        amount = bound(amount, ONE_USDC, VAULT_FUNDS - MIN_OPERATING);
        price = bound(price, 0.5e18, 5e18);
        teller.setPrice(price);
        ISymbolonVault.ReservePolicy memory p = _reservePolicy(true);
        p.maxReserveBps = 10_000;
        vm.startPrank(owner);
        vault.setReservePolicy(p);
        vm.warp(block.timestamp + LOOSENING_DELAY);
        vault.setReservePolicy(p);
        uint256 cashBefore = usdc.balanceOf(address(vault));
        uint256 shares = vault.subscribeReserve(amount, 0, DECISION);
        vault.redeemReserve(shares, 0, DECISION);
        vm.stopPrank();
        uint256 cashAfter = usdc.balanceOf(address(vault));
        assertLe(cashAfter, cashBefore, "rounding never favours the Vault");
        // two floor divisions lose at most one unit of shares' worth of asset, plus one unit
        assertLe(cashBefore - cashAfter, price / 1e18 + 2);
    }

    // ---------------------------------------------------------------------------------------------------------------
    // Release 1 -> release 2
    // ---------------------------------------------------------------------------------------------------------------

    function test_upgrade_release1VaultGainsTheReserveDisabledWithStateKept() public {
        SymbolonVault release1 = new SymbolonVault(ledger, registry, IUsycTeller(address(0)));
        VaultFactory oldFactory = new VaultFactory(address(release1));
        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        SymbolonVault old = SymbolonVault(oldFactory.createVault(owner, steward, _policy(), tokens, 6, false));
        usdc.mint(address(old), VAULT_FUNDS);
        VaultLens.ReserveStatus memory before = lens.reserveStatus(address(old));
        assertEq(before.usycTeller, address(0), "release 1 has no reserve");

        vm.startPrank(owner);
        old.addPayee(seal, payout, ARC_DOMAIN, _terms());
        old.scheduleUpgrade(address(implementation));
        vm.warp(block.timestamp + LOOSENING_DELAY);
        old.upgradeToAndCall(address(implementation), "");
        vm.stopPrank();

        (address keptPayout,) = lens.currentPayout(address(old), seal);
        assertEq(keptPayout, payout, "payees kept");
        assertEq(usdc.balanceOf(address(old)), VAULT_FUNDS, "funds kept");
        VaultLens.ReserveStatus memory st = lens.reserveStatus(address(old));
        assertEq(st.usycTeller, address(teller));
        assertFalse(st.policy.enabled, "reserve starts off");
        assertFalse(st.entitled, "Circle hasn't allowlisted this Vault");
    }
}
