// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {CommonBase} from "forge-std/Base.sol";
import {StdCheats} from "forge-std/StdCheats.sol";
import {StdUtils} from "forge-std/StdUtils.sol";

import {VaultTest} from "../utils/VaultTest.sol";
// forge-lint: disable-next-line(unused-import) EarlyPayTier is used by the handler below
import {Invoice, EarlyPayTier, DiscountProof, DiscountKind} from "../../src/types/SealTypes.sol";
import {ISymbolonVault} from "../../src/interfaces/ISymbolonVault.sol";
import {IInvoiceLedger} from "../../src/interfaces/IInvoiceLedger.sol";
import {SymbolonVault} from "../../src/SymbolonVault.sol";
import {MockERC20} from "../mocks/MockERC20.sol";

/// @notice Drives the Steward through random partial payments, retries, Early Pay tiers and cancellations
contract VaultHandler is CommonBase, StdCheats, StdUtils {
    SymbolonVault internal immutable vault;
    IInvoiceLedger internal immutable ledger;
    MockERC20 internal immutable usdc;
    address internal immutable steward;

    Invoice[] internal _invoices;
    bytes[] internal _sigs;
    bytes32[] public fingerprints;

    uint256 public ghostPaid;
    uint256 public ghostCredited;

    constructor(SymbolonVault vault_, IInvoiceLedger ledger_, MockERC20 usdc_, address steward_) {
        vault = vault_;
        ledger = ledger_;
        usdc = usdc_;
        steward = steward_;
    }

    function addInvoice(Invoice memory inv, bytes memory sig) external {
        _invoices.push(inv);
        _sigs.push(sig);
        fingerprints.push(ledger.fingerprint(inv));
    }

    function invoiceCount() external view returns (uint256) {
        return _invoices.length;
    }

    function pay(uint256 index, uint256 credit, bool useTier) external {
        index = bound(index, 0, _invoices.length - 1);
        Invoice memory inv = _invoices[index];
        credit = bound(credit, 1, inv.amount);

        ISymbolonVault.PayParams memory p;
        p.invoice = inv;
        p.sealSig = _sigs[index];
        p.credit = credit;
        if (useTier && inv.earlyPay.length != 0) {
            p.discount.kind = DiscountKind.Tier;
            p.discount.tierIndex = 0;
        }

        vm.prank(steward);
        try vault.pay(p, new ISymbolonVault.SignedApproval[](0)) returns (uint256 paid) {
            ghostPaid += paid;
            ghostCredited += credit;
        } catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 1, 5 days));
    }
}

contract VaultInvariantTest is VaultTest {
    VaultHandler internal handler;
    uint256 internal constant INVOICES = 6;

    function setUp() public override {
        super.setUp();
        handler = new VaultHandler(vault, ledger, usdc, steward);

        for (uint256 i; i < INVOICES; ++i) {
            Invoice memory inv = _invoice((100 + i * 150) * ONE_USDC);
            inv.invoiceNumberHash = keccak256(abi.encode("INV", i));
            if (i % 2 == 0) {
                inv.earlyPay = new EarlyPayTier[](1);
                inv.earlyPay[0] = EarlyPayTier({payBy: uint64(block.timestamp + 7 days), discountBps: 200});
            }
            handler.addInvoice(inv, _signInvoice(inv, sealKey));
        }

        targetContract(address(handler));
    }

    function invariant_creditedNeverExceedsTotal() public view {
        for (uint256 i; i < INVOICES; ++i) {
            IInvoiceLedger.InvoiceState memory st = ledger.status(handler.fingerprints(i));
            assertLe(st.credited, st.total);
        }
    }

    function invariant_vendorReceivedExactlyWhatWasPaid() public view {
        assertEq(usdc.balanceOf(payout), handler.ghostPaid());
    }

    function invariant_vaultBalanceConserved() public view {
        assertEq(usdc.balanceOf(address(vault)) + handler.ghostPaid(), VAULT_FUNDS);
    }

    function invariant_creditedMatchesLedger() public view {
        uint256 sum;
        for (uint256 i; i < INVOICES; ++i) {
            sum += ledger.status(handler.fingerprints(i)).credited;
        }
        assertEq(sum, handler.ghostCredited());
    }

    function invariant_noLingeringAllowance() public view {
        assertEq(usdc.allowance(address(vault), address(ledger)), 0);
    }

    function invariant_paidNeverExceedsCredited() public view {
        assertLe(handler.ghostPaid(), handler.ghostCredited());
    }
}
