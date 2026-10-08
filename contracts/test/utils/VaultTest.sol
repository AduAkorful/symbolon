// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {SymbolonTest} from "./SymbolonTest.sol";
import {Invoice, Approval} from "../../src/types/SealTypes.sol";
import {ISymbolonVault} from "../../src/interfaces/ISymbolonVault.sol";
import {IUsycTeller} from "../../src/interfaces/IUsycTeller.sol";
import {SymbolonVault} from "../../src/SymbolonVault.sol";
import {VaultFactory} from "../../src/VaultFactory.sol";
import {ReleaseRegistry} from "../../src/ReleaseRegistry.sol";
import {VaultLens} from "../../src/periphery/VaultLens.sol";

/// @notice A funded Vault with an owner, steward, approver, requester and screener, and one verified vendor
abstract contract VaultTest is SymbolonTest {
    uint256 internal constant VAULT_FUNDS = 1_000_000 * ONE_USDC;
    uint256 internal constant AUTO_PAY = 1_000 * ONE_USDC;
    uint256 internal constant OWNER_THRESHOLD = 10_000 * ONE_USDC;
    uint256 internal constant PER_TX_CAP = 50_000 * ONE_USDC;
    uint256 internal constant MONTHLY_CAP = 100_000 * ONE_USDC;
    uint64 internal constant COOLDOWN = 72 hours;
    uint64 internal constant LOOSENING_DELAY = 1 days;
    uint256 internal constant MAX_BRIDGE_FEE = 5 * ONE_USDC;

    bytes32 internal constant OPERATING = bytes32(0);

    ReleaseRegistry internal registry;
    address internal releaseKey = makeAddr("releaseKey");
    SymbolonVault internal implementation;
    VaultFactory internal factory;
    SymbolonVault internal vault;
    VaultLens internal lens;

    address internal owner;
    uint256 internal ownerKey;
    address internal approver;
    uint256 internal approverKey;
    address internal steward = makeAddr("steward");
    address internal requester = makeAddr("requester");
    address internal screener = makeAddr("screener");

    function setUp() public virtual override {
        super.setUp();
        (owner, ownerKey) = makeAddrAndKey("owner");
        (approver, approverKey) = makeAddrAndKey("approver");
        registry = new ReleaseRegistry(releaseKey);
        implementation = new SymbolonVault(ledger, registry, _usycTeller());
        factory = new VaultFactory(address(implementation));
        lens = new VaultLens();

        address[] memory tokens = new address[](1);
        tokens[0] = address(usdc);
        vault = SymbolonVault(payable(factory.createVault(owner, steward, _policy(), tokens, 6, false)));
        usdc.mint(address(vault), VAULT_FUNDS);

        // roles are loosening changes, so they queue and are repeated after the delay
        vm.startPrank(owner);
        vault.setApprover(approver, OPERATING, true);
        vault.setRequester(requester, true);
        vault.setScreener(screener);
        vm.warp(block.timestamp + LOOSENING_DELAY);
        vault.setApprover(approver, OPERATING, true);
        vault.setRequester(requester, true);
        vault.setScreener(screener);
        vault.addPayee(seal, payout, ARC_DOMAIN, _terms());
        vm.stopPrank();
    }

    /// @notice The USYC Teller the implementation is built with; none unless a suite provides one
    function _usycTeller() internal virtual returns (IUsycTeller) {
        return IUsycTeller(address(0));
    }

    function _policy() internal pure returns (ISymbolonVault.Policy memory) {
        return ISymbolonVault.Policy({
            perTxCap: PER_TX_CAP,
            autoPayLimit: AUTO_PAY,
            ownerThreshold: OWNER_THRESHOLD,
            newVendorMinPaid: 0,
            screeningMaxAge: 0,
            newPayeeDelay: 0,
            changeCooldown: COOLDOWN,
            looseningDelay: LOOSENING_DELAY,
            maxBridgeFee: MAX_BRIDGE_FEE
        });
    }

    function _terms() internal pure returns (ISymbolonVault.PayeeTerms memory) {
        return ISymbolonVault.PayeeTerms({
            budget: OPERATING, requirePo: false, requireDelivery: false, monthlyCap: MONTHLY_CAP
        });
    }

    function _params(Invoice memory inv, uint256 credit) internal view returns (ISymbolonVault.PayParams memory p) {
        p.invoice = inv;
        p.sealSig = _signInvoice(inv, sealKey);
        p.credit = credit;
        p.discount = _noDiscount();
        p.decisionHash = keccak256(abi.encode("decision", inv.invoiceNumberHash, credit));
    }

    function _noApprovals() internal pure returns (ISymbolonVault.SignedApproval[] memory) {
        return new ISymbolonVault.SignedApproval[](0);
    }

    function _approvalBy(address signer, uint256 key, Invoice memory inv, uint256 credit)
        internal
        view
        returns (ISymbolonVault.SignedApproval[] memory approvals)
    {
        uint64 deadline = uint64(block.timestamp + 1 hours);
        Approval memory a =
            Approval({vault: address(vault), fingerprint: ledger.fingerprint(inv), credit: credit, deadline: deadline});
        approvals = new ISymbolonVault.SignedApproval[](1);
        approvals[0] =
            ISymbolonVault.SignedApproval({signer: signer, deadline: deadline, signature: _signApproval(a, key)});
    }

    function _stewardPays(Invoice memory inv, uint256 credit) internal returns (uint256) {
        ISymbolonVault.PayParams memory p = _params(inv, credit);
        vm.prank(steward);
        return vault.pay(p, _noApprovals());
    }
}
