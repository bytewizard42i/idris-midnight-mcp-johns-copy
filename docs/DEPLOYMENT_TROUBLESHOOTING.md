# Midnight Contract Deployment Troubleshooting

**Last Updated**: February 25, 2026
**Compiler**: 0.29.0 | **Runtime**: 0.14.0 | **Proof Server**: 7.0.0 | **Network**: Preprod

These notes were compiled while deploying six production contracts to Midnight Preprod.
They document real errors encountered and verified solutions.

---

## 1. Runtime Version Mismatch

### Error
```
CompactError: Version mismatch: compiled code expects 0.14.0, runtime is 0.11.0-rc.1
```

### Cause
The `@midnight-ntwrk/compact-runtime` package in your project's `node_modules` is older than what the compiled contract expects. Compiled contracts call `__compactRuntime.checkRuntimeVersion('0.14.0')` on import — if your installed runtime doesn't match, it throws immediately.

### Fix
Ensure your project's `package.json` has the correct runtime version:
```json
"@midnight-ntwrk/compact-runtime": "0.14.0"
```
Then run `npm install`. The runtime version must match what the compiler produced. Check your compiled output's `contract-info.json` for the `runtime-version` field.

### Tip
If you're working in a monorepo with older alpha/beta SDK versions, you can isolate the deployment project in a separate directory with the correct dependencies rather than upgrading the entire monorepo.

---

## 2. Witness Constructor Error ("first (witnesses) argument to Contract construct")

### Error
```
CompactError: first (witnesses) argument to Contract construct
```

### Cause
When using `CompiledContract.make(name, ContractClass)` with dynamically imported contract modules, the `Contract` class constructor requires a witnesses object. Contracts with **no witnesses** accept `new Contract({})`, but contracts **with witnesses** (e.g., `witness getCurrentTimestamp(): Uint<64>`) fail because `CompiledContract.make` tries to instantiate the class before `withVacantWitnesses` runs in the pipe chain.

### Fix
Wrap the Contract class to provide default witness stubs:

```typescript
import fs from 'fs';
import path from 'path';

function getWitnessNames(managedDir: string, contractName: string): string[] {
  const infoPath = path.join(managedDir, contractName, 'compiler', 'contract-info.json');
  const info = JSON.parse(fs.readFileSync(infoPath, 'utf-8'));
  return (info.witnesses || []).map((w: any) => w.name);
}

function wrapContractWithDefaultWitnesses(ContractClass: any, witnessNames: string[]): any {
  return class WrappedContract extends ContractClass {
    constructor(witnesses: any = {}) {
      const defaultWitnesses: Record<string, Function> = {};
      for (const name of witnessNames) {
        defaultWitnesses[name] = (..._args: any[]) => undefined;
      }
      super({ ...defaultWitnesses, ...witnesses });
    }
  };
}

// Usage:
const contractModule = await import(pathToFileURL(contractModulePath).href);
const witnessNames = getWitnessNames(managedDir, contractName);
const WrappedContract = wrapContractWithDefaultWitnesses(contractModule.Contract, witnessNames);

const compiledContract = CompiledContract.make(contractName, WrappedContract).pipe(
  CompiledContract.withVacantWitnesses,
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);
```

### Note
This is only needed for **dynamic imports** from compiled `.js` files. If you use a pre-built package (like `@midnight-ntwrk/counter-contract`), the package handles this internally.

---

## 3. Missing ZK Keys for Read-Only Circuits

### Error
```
ZKConfigurationReadError: Failed to read verifier key for myContract#myCircuit
```

### Cause
The Compact compiler (0.29.0) **does not generate ZK keys** (prover, verifier, zkir) for export circuits that don't read or write ledger state. These are effectively pure computations — no transaction is produced, so no ZK proof is needed.

Example of a circuit the compiler skips:
```compact
// This circuit ONLY takes parameters and returns a computed value.
// It never reads from or writes to the ledger.
export circuit verifyTwinBondIntegrity(
    expectedTwinBondHash: Bytes<32>,
    currentImageTwinHash: Bytes<32>,
    currentDigitalTwinHash: Bytes<32>
): Boolean {
  const recomputedBondHash = computeTwinBondHash(currentImageTwinHash, currentDigitalTwinHash);
  return disclose(expectedTwinBondHash == recomputedBondHash);
}
```

The circuit is listed in `contract-info.json` but has no corresponding files in `keys/` or `zkir/`.

However, the SDK's `NodeZkConfigProvider` tries to load keys for **all** circuits listed in `contract-info.json`, causing deployment to fail.

### Fix (Proper)
Refactor the circuit to interact with the ledger. For example, look up the expected hash from ledger state instead of taking it as a parameter:

```compact
export circuit verifyTwinBondIntegrity(
    imageTwinHash: Bytes<32>,
    digitalTwinHash: Bytes<32>
): Boolean {
  // Read the stored bond hash from ledger — this forces ZK key generation
  const storedBondHash = twinBondHashByImageHash.lookup(disclose(imageTwinHash));
  const recomputedBondHash = computeTwinBondHash(imageTwinHash, digitalTwinHash);
  return disclose(storedBondHash == recomputedBondHash);
}
```

### Fix (Workaround for Deployment)
If refactoring isn't feasible yet, copy an existing circuit's key files as placeholders:
```bash
cp keys/someOtherCircuit.prover keys/myCircuit.prover
cp keys/someOtherCircuit.verifier keys/myCircuit.verifier
cp zkir/someOtherCircuit.zkir zkir/myCircuit.zkir
cp zkir/someOtherCircuit.bzkir zkir/myCircuit.bzkir
```
This works for **deployment** because the constructor doesn't invoke these circuits. The placeholder keys will fail if the circuit is actually called at runtime — use this only as a temporary measure.

---

## 4. `disclose()` Rules (Quick Reference)

The `disclose()` function is required whenever a value crosses the private→public boundary:

| Scenario | `disclose()` needed? |
|----------|---------------------|
| Witness-derived value used in ledger `.insert()` | ✅ Yes |
| Witness-derived value in `return` statement | ✅ Yes |
| Witness-derived value in `assert()` condition | ✅ Yes |
| Comparison involving witness-derived values | ✅ Yes |
| Circuit parameter used directly in ledger ops | ✅ Yes |
| Value read from public ledger | ❌ No (already public) |
| Literal/constant values | ❌ No |

### Common Mistake
Forgetting `disclose()` on return values:
```compact
// WRONG — will compile but may cause runtime issues
return (someValue == otherValue);

// CORRECT
return disclose(someValue == otherValue);
```

---

## 5. DUST Balance Timing

### Symptom
Deployment fails with insufficient DUST errors immediately after funding with tNight.

### Cause
After receiving tNight from the faucet, it takes approximately **5 minutes** for DUST to accumulate. DUST is the gas token used for contract deployment and transactions.

### Fix
Wait 5+ minutes after faucet funding before attempting deployment. Check DUST balance programmatically:
```typescript
const state = await walletFacade.state();
const dustBalance = state.balances.get('DUST')?.valueOf() ?? 0n;
if (dustBalance < 1_000_000n) {
  console.log('Waiting for DUST to accumulate...');
  // Poll or wait
}
```

---

## 6. Compact Compiler Update Requires GitHub Token

### Error
```
Error: Failed to update
Caused by: Error while fetching compact releases — Bad credentials
```

### Fix
The `compact update` command fetches from GitHub and needs authentication:
```bash
GITHUB_TOKEN=your_github_token compact update
```

---

## 7. Dynamic Import Module Resolution in ESM

### Symptom
When dynamically importing compiled contract `.js` files, `@midnight-ntwrk/compact-runtime` resolves from the **file's location**, not from your project root.

### Cause
Node.js ESM resolves bare specifiers relative to the importing file. If your compiled contracts live in a different project/directory, they'll look for `compact-runtime` in that project's `node_modules`.

### Fix
Copy compiled contract outputs into your deployment project so they resolve dependencies from your project's `node_modules`:
```bash
cp -r /path/to/source/managed/my-contract /path/to/deploy-project/contracts/
```

---

## Environment Reference

| Component | Version | Notes |
|-----------|---------|-------|
| Compact compiler | 0.29.0 | Language version 0.21.0 |
| compact-runtime | 0.14.0 | Must match compiler output |
| compact-js | 2.4.0 | Contract deployment API |
| midnight-js-contracts | 2.4.0 | `deployContract` / `findDeployedContract` |
| wallet-sdk-facade | 1.0.0 | Wallet management |
| Proof Server | 7.0.0 | Docker: `midnightntwrk/proof-server:7.0.0` |
| Network | Preprod | Faucet: https://faucet.preprod.midnight.network/ |
