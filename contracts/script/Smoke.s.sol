// SPDX-License-Identifier: MIT
pragma solidity 0.8.36;

import {Script} from "forge-std/Script.sol";
import {VmSafe} from "forge-std/Vm.sol";

import {Invoice, EarlyPayTier, DiscountProof} from "../src/types/SealTypes.sol";
import {ISymbolonVault} from "../src/interfaces/ISymbolonVault.sol";

import {SymbolonVault} from "../src/SymbolonVault.sol";
import {VaultFactory} from "../src/VaultFactory.sol";

/// @notice Live smoke test of a deployment:
///   1. `--sig "createVault()" --broadcast`: a manual-upgrade Vault owned by the deployer, with the deployer's Seal as
///      a payee
///   2. `cast send <usdc> "transfer(address,uint256)" <vault> 1000000`: fund it
///   3. `pnpm smoke` in packages/seal: seals a 1 USDC invoice to that Vault with the TypeScript seal package
///   4. `--sig "payCalldata()"`, then `cast send <vault> <calldata>`: the owner pays it through the Vault and ledger
/// @dev Arc's USDC moves balances through a native precompile that Foundry's local EVM can't execute, so anything that
/// moves USDC is sent with `cast` (executed by the node) instead of being simulated in a Forge script.
contract Smoke is Script {
    uint256 internal constant SMOKE_CAP = 5e6;
    uint64 internal constant LOOSENING_DELAY = 1 days;
    uint64 internal constant CHANGE_COOLDOWN = 72 hours;
    uint8 internal constant DECIMALS = 6;

    error SmokeInvoiceHasEarlyPay();

    function createVault() external returns (address vault) {
        uint256 key = vm.envUint("DEPLOYER_PK");
        address owner = vm.addr(key);
        string memory registry = _registry();
        VaultFactory factory = VaultFactory(vm.parseJsonAddress(registry, ".contracts.VaultFactory"));
        address usdc = vm.parseJsonAddress(registry, ".external.usdc");

        address[] memory tokens = new address[](1);
        tokens[0] = usdc;
        ISymbolonVault.Policy memory policy = ISymbolonVault.Policy({
            perTxCap: SMOKE_CAP,
            autoPayLimit: SMOKE_CAP,
            ownerThreshold: SMOKE_CAP,
            newVendorMinPaid: 0,
            screeningMaxAge: 0,
            newPayeeDelay: 0,
            changeCooldown: CHANGE_COOLDOWN,
            looseningDelay: LOOSENING_DELAY,
            maxBridgeFee: 0
        });

        vm.startBroadcast(key);
        vault = factory.createVault(owner, address(0), policy, tokens, DECIMALS, false);
        // the vendor in this smoke test is the deployer's own Seal, paid to a fresh label-derived address
        SymbolonVault(vault)
            .addPayee(
                owner,
                _smokePayout(),
                uint32(vm.parseJsonUint(registry, ".cctpDomain")),
                ISymbolonVault.PayeeTerms({
                    budget: bytes32(0), requirePo: false, requireDelivery: false, monthlyCap: SMOKE_CAP
                })
            );
        vm.stopBroadcast();

        if (vm.isContext(VmSafe.ForgeContext.ScriptBroadcast) || vm.isContext(VmSafe.ForgeContext.ScriptResume)) {
            string memory o = "smoke";
            vm.serializeAddress(o, "vault", vault);
            vm.serializeAddress(o, "payout", _smokePayout());
            // forge-lint: disable-next-line(unsafe-cheatcode)
            vm.writeJson(vm.serializeUint(o, "createdBlock", block.number), _smokePath("vault"));
        }
    }

    /// @notice The owner's `pay` calldata for the sealed smoke invoice, for `cast send`
    function payCalldata() external view returns (address vault, bytes memory data) {
        // forge-lint: disable-next-line(unsafe-cheatcode)
        string memory sealedJson = vm.readFile(_smokePath("invoice"));
        // forge-lint: disable-next-line(unsafe-cheatcode)
        vault = vm.parseJsonAddress(vm.readFile(_smokePath("vault")), ".vault");

        Invoice memory inv = _invoice(sealedJson);
        DiscountProof memory none;
        ISymbolonVault.PayParams memory params = ISymbolonVault.PayParams({
            invoice: inv,
            sealSig: vm.parseJsonBytes(sealedJson, ".signature"),
            credit: inv.amount,
            discount: none,
            maxFee: 0,
            decisionHash: keccak256("symbolon.smoke")
        });
        data = abi.encodeCall(SymbolonVault.pay, (params, new ISymbolonVault.SignedApproval[](0)));
    }

    function _invoice(string memory json) internal pure returns (Invoice memory inv) {
        inv.seal = vm.parseJsonAddress(json, ".invoice.seal");
        inv.token = vm.parseJsonAddress(json, ".invoice.token");
        inv.amount = vm.parseJsonUint(json, ".invoice.amount");
        inv.issuedAt = uint64(vm.parseJsonUint(json, ".invoice.issuedAt"));
        inv.dueDate = uint64(vm.parseJsonUint(json, ".invoice.dueDate"));
        inv.payoutAddress = vm.parseJsonAddress(json, ".invoice.payoutAddress");
        inv.payoutDomain = uint32(vm.parseJsonUint(json, ".invoice.payoutDomain"));
        inv.payerRef = vm.parseJsonBytes32(json, ".invoice.payerRef");
        inv.invoiceNumberHash = vm.parseJsonBytes32(json, ".invoice.invoiceNumberHash");
        inv.poRef = vm.parseJsonBytes32(json, ".invoice.poRef");
        inv.documentHash = vm.parseJsonBytes32(json, ".invoice.documentHash");
        inv.replaces = vm.parseJsonBytes32(json, ".invoice.replaces");
        // the smoke invoice carries no Early Pay curve; a non-empty one would need parsing here
        if (vm.parseJsonUint(json, ".invoice.earlyPayCount") != 0) revert SmokeInvoiceHasEarlyPay();
        inv.earlyPay = new EarlyPayTier[](0);
    }

    function _registry() internal view returns (string memory) {
        // forge-lint: disable-next-line(unsafe-cheatcode)
        return vm.readFile(string.concat("deployments/", vm.toString(block.chainid), ".json"));
    }

    function _smokePath(string memory name) internal view returns (string memory) {
        return string.concat("deployments/smoke/", vm.toString(block.chainid), "-", name, ".json");
    }

    function _smokePayout() internal pure returns (address) {
        return address(uint160(uint256(keccak256("symbolon.smoke.payout"))));
    }
}
