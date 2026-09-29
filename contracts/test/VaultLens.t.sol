// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {VaultTest} from "./utils/VaultTest.sol";
import {Invoice, PayoutChange, SealRotation} from "../src/types/SealTypes.sol";
import {ISymbolonVault} from "../src/interfaces/ISymbolonVault.sol";
import {VaultLens} from "../src/periphery/VaultLens.sol";

/// @notice Every field the lens decodes, written through real Vault calls and read back exactly
contract VaultLensTest is VaultTest {
    function test_lens_vaultState() public view {
        VaultLens.VaultState memory st = lens.getVaultState(address(vault));
        assertEq(st.owner, owner);
        assertEq(st.pendingOwner, address(0));
        assertEq(st.steward, steward);
        assertEq(st.screener, screener);
        assertFalse(st.paused);
        assertEq(st.accountingDecimals, 6);
        assertFalse(st.autoUpdate);
        assertEq(st.policy.perTxCap, PER_TX_CAP);
        assertEq(st.policy.autoPayLimit, AUTO_PAY);
        assertEq(st.policy.ownerThreshold, OWNER_THRESHOLD);
        assertEq(st.policy.changeCooldown, COOLDOWN);
        assertEq(st.policy.looseningDelay, LOOSENING_DELAY);
        assertEq(st.policy.maxBridgeFee, MAX_BRIDGE_FEE);
    }

    function testFuzz_lens_policyRoundTrip(
        uint256 perTxCap,
        uint256 autoPayLimit,
        uint256 ownerThreshold,
        uint32 newVendorMinPaid,
        uint64 screeningMaxAge,
        uint64 newPayeeDelay,
        uint64 changeCooldown,
        uint64 looseningDelay,
        uint256 maxBridgeFee
    ) public {
        ISymbolonVault.Policy memory p = ISymbolonVault.Policy({
            perTxCap: perTxCap,
            autoPayLimit: autoPayLimit,
            ownerThreshold: ownerThreshold,
            newVendorMinPaid: newVendorMinPaid,
            screeningMaxAge: screeningMaxAge,
            newPayeeDelay: newPayeeDelay,
            changeCooldown: changeCooldown,
            looseningDelay: looseningDelay,
            maxBridgeFee: maxBridgeFee
        });
        vm.startPrank(owner);
        vault.setPolicy(p);
        // a loosening policy queues; repeat it after the current delay to apply it
        vm.warp(block.timestamp + LOOSENING_DELAY);
        vault.setPolicy(p);
        vm.stopPrank();

        ISymbolonVault.Policy memory r = lens.getPolicy(address(vault));
        assertEq(r.perTxCap, perTxCap);
        assertEq(r.autoPayLimit, autoPayLimit);
        assertEq(r.ownerThreshold, ownerThreshold);
        assertEq(r.newVendorMinPaid, newVendorMinPaid);
        assertEq(r.screeningMaxAge, screeningMaxAge);
        assertEq(r.newPayeeDelay, newPayeeDelay);
        assertEq(r.changeCooldown, changeCooldown);
        assertEq(r.looseningDelay, looseningDelay);
        assertEq(r.maxBridgeFee, maxBridgeFee);
    }

    function test_lens_payeeEveryField() public {
        bytes32 design = keccak256("design");
        vm.prank(owner);
        vault.setBudget(design, 9_000 * ONE_USDC, 30 days);

        ISymbolonVault.PayeeTerms memory terms = ISymbolonVault.PayeeTerms({
            budget: design, requirePo: true, requireDelivery: true, monthlyCap: 4_321 * ONE_USDC
        });
        // moving to another budget is loosening; tightening the rest applies with it
        vm.startPrank(owner);
        vault.updatePayeeTerms(seal, terms);
        vm.warp(block.timestamp + LOOSENING_DELAY);
        vault.updatePayeeTerms(seal, terms);
        vm.stopPrank();

        bytes32 poRef = keccak256("PO-1");
        vm.prank(owner);
        vault.openPurchaseOrder(poRef, seal, design, 2_000 * ONE_USDC, uint64(block.timestamp));
        Invoice memory inv = _invoice(700 * ONE_USDC);
        inv.poRef = poRef;
        bytes32 fp = ledger.fingerprint(inv);
        vm.prank(requester);
        vault.confirmDelivery(fp);
        vm.prank(screener);
        vault.setScreening(seal, ISymbolonVault.Risk.Low, uint64(block.timestamp - 5));
        _stewardPays(inv, 700 * ONE_USDC);

        address newWallet = makeAddr("newWallet");
        PayoutChange memory change = PayoutChange({seal: seal, newPayout: newWallet, payoutDomain: 7, nonce: 3});
        bytes memory sig = _signPayoutChange(change, sealKey);
        vm.prank(owner);
        vault.confirmPayoutChange(change, sig);

        ISymbolonVault.Payee memory p = lens.getPayee(address(vault), seal);
        assertTrue(p.exists);
        assertEq(p.paidCount, 1);
        assertEq(p.payout, payout);
        assertEq(p.payoutDomain, ARC_DOMAIN);
        assertEq(p.lastChangeNonce, 3);
        assertEq(p.pendingPayout, newWallet);
        assertEq(p.pendingDomain, 7);
        assertEq(p.pendingActiveAt, uint64(block.timestamp + COOLDOWN));
        assertEq(uint8(p.risk), uint8(ISymbolonVault.Risk.Low));
        assertEq(p.screenedAt, uint64(block.timestamp - 5));
        assertEq(p.spendPeriod, uint64(block.timestamp / 30 days));
        assertEq(p.spentInPeriod, 700 * ONE_USDC);
        assertEq(p.terms.budget, design);
        assertTrue(p.terms.requirePo);
        assertTrue(p.terms.requireDelivery);
        assertEq(p.terms.monthlyCap, 4_321 * ONE_USDC);
        assertTrue(lens.deliveryConfirmed(address(vault), fp));

        (address current, uint32 domain) = lens.currentPayout(address(vault), seal);
        assertEq(current, payout);
        assertEq(domain, ARC_DOMAIN);
        vm.warp(block.timestamp + COOLDOWN);
        (current, domain) = lens.currentPayout(address(vault), seal);
        assertEq(current, newWallet);
        assertEq(domain, 7);

        ISymbolonVault.PurchaseOrder memory po = lens.getPurchaseOrder(address(vault), poRef);
        assertTrue(po.open);
        assertEq(po.seal, seal);
        assertEq(po.budget, design);
        assertEq(po.remaining, 1_300 * ONE_USDC);

        ISymbolonVault.Budget memory b = lens.getBudget(address(vault), design);
        assertTrue(b.exists);
        assertEq(b.cap, 9_000 * ONE_USDC);
        assertEq(b.periodLength, 30 days);
        assertEq(b.spent, 700 * ONE_USDC);
    }

    function test_lens_rotationRetireAndActiveAt() public {
        (address newSeal,) = makeAddrAndKey("newSeal");
        SealRotation memory rotation = SealRotation({oldSeal: seal, newSeal: newSeal, nonce: 1});
        bytes memory sig = _signRotation(rotation, sealKey);
        vm.prank(owner);
        vault.confirmSealRotation(rotation, sig);

        uint64 when = uint64(block.timestamp + COOLDOWN);
        assertEq(lens.getPayee(address(vault), seal).retireAt, when);
        assertEq(lens.getPayee(address(vault), newSeal).activeAt, when);
        assertEq(lens.getPayee(address(vault), newSeal).payout, payout);
    }

    function test_lens_rolesFlagsAndQueues() public {
        assertTrue(lens.isApprover(address(vault), approver, keccak256("any budget")));
        assertEq(lens.approverBudgetCount(address(vault), approver), 1);
        assertTrue(lens.isRequester(address(vault), requester));
        assertTrue(lens.isSupportedToken(address(vault), address(usdc)));
        assertFalse(lens.isSupportedToken(address(vault), address(token18)));

        vm.prank(owner);
        vault.pause();
        assertTrue(lens.paused(address(vault)));
        assertEq(lens.screener(address(vault)), screener);
        assertEq(lens.accountingDecimals(address(vault)), 6);

        ISymbolonVault.Policy memory looser = _policy();
        looser.perTxCap = PER_TX_CAP * 2;
        bytes32 id = lens.changeId(abi.encodeCall(ISymbolonVault.setPolicy, (looser)));
        vm.prank(owner);
        vault.setPolicy(looser);
        assertEq(lens.queuedChangeEta(address(vault), id), uint64(block.timestamp + LOOSENING_DELAY));

        address impl = makeAddr("impl");
        vm.prank(owner);
        vault.scheduleUpgrade(impl);
        assertEq(lens.scheduledUpgrade(address(vault), impl), uint64(block.timestamp + LOOSENING_DELAY));
    }

    function test_lens_requiredApprovalMatchesVault() public {
        assertEq(uint8(lens.requiredApproval(address(vault), seal, AUTO_PAY)), uint8(ISymbolonVault.ApprovalLevel.None));
        assertEq(
            uint8(lens.requiredApproval(address(vault), seal, AUTO_PAY + 1)),
            uint8(ISymbolonVault.ApprovalLevel.Approver)
        );
        assertEq(
            uint8(lens.requiredApproval(address(vault), seal, OWNER_THRESHOLD + 1)),
            uint8(ISymbolonVault.ApprovalLevel.Owner)
        );
        vm.prank(screener);
        vault.setScreening(seal, ISymbolonVault.Risk.High, uint64(block.timestamp));
        assertEq(uint8(lens.requiredApproval(address(vault), seal, 1)), uint8(ISymbolonVault.ApprovalLevel.Owner));
    }

    function test_extsload_allThreeFormsAgree() public view {
        bytes32 flagsSlot = bytes32(uint256(0x8c3a65422d204b878dcfcd37b62d14f92d1c4186f096d97c7671c3a1b01b2400) + 17);
        bytes32 stewardSlot = bytes32(uint256(flagsSlot) - 1);
        bytes32 single = vault.extsload(flagsSlot);

        bytes32[] memory range = vault.extsload(stewardSlot, 2);
        assertEq(range.length, 2);
        assertEq(address(uint160(uint256(range[0]))), steward);
        assertEq(range[1], single);

        bytes32[] memory slots = new bytes32[](2);
        slots[0] = flagsSlot;
        slots[1] = stewardSlot;
        bytes32[] memory list = vault.extsload(slots);
        assertEq(list[0], single);
        assertEq(list[1], range[0]);
        assertEq(address(uint160(uint256(single))), screener);
    }
}
