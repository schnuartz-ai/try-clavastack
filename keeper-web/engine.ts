import * as bitcoinJS from 'bitcoinjs-lib';
import { URRegistryDecoder } from '../upstream/bitcoin-keeper/src/services/qr/bc-ur-registry';
import { decodeURBytes, encodePsbtUR } from '../upstream/bitcoin-keeper/src/services/qr';
import { generateVault } from '../upstream/bitcoin-keeper/src/services/wallets/factories/VaultFactory';
import WalletOperations from '../upstream/bitcoin-keeper/src/services/wallets/operations';
import WalletUtilities from '../upstream/bitcoin-keeper/src/services/wallets/operations/utils';
import ecc from '../upstream/bitcoin-keeper/src/services/wallets/operations/taproot-utils/noble_ecc';
import {
  EntityKind,
  MultisigScriptType,
  NetworkType,
  ScriptTypes,
  SignerType,
  VaultType,
} from '../upstream/bitcoin-keeper/src/services/wallets/enums';
import type { Vault, VaultSigner } from '../upstream/bitcoin-keeper/src/services/wallets/interfaces/vault';

export const TESTNET = bitcoinJS.networks.testnet;
export const TESTNET_NAME = NetworkType.TESTNET;

export function createKeeperUrDecoder() {
  return new URRegistryDecoder();
}

export function decodeKeeperUr(decoder: URRegistryDecoder, frame: string) {
  return decodeURBytes(decoder, frame);
}

function descriptorMetadata(payload: unknown) {
  let data: any = payload;
  if (typeof data === 'string') {
    const trimmed = data.trim();
    if (trimmed.startsWith('addwallet ')) data = trimmed.slice(trimmed.indexOf('&') + 1);
    else {
      try { data = JSON.parse(trimmed); } catch { /* a descriptor string is handled below */ }
    }
  }
  if (data && typeof data === 'object' && typeof data.descriptor === 'string') data = data.descriptor;
  if (data && typeof data === 'object' && data.xPub && data.derivationPath && data.mfp) {
    return {
      xpub: String(data.xPub),
      masterFingerprint: String(data.mfp).replace(/^0x/i, '').toUpperCase(),
      derivationPath: String(data.derivationPath).replace(/h/gi, "'"),
    };
  }
  if (typeof data !== 'string') throw new Error('This QR does not contain a Specter DIY wallet descriptor.');

  const match = data.match(/\[([0-9a-fA-F]{8})\/([^\]]+)\]((?:[xyzutv]pub)[1-9A-HJ-NP-Za-km-z]+)/i);
  if (!match) throw new Error('No testnet account key was found in the Specter QR. Open a BIP84 testnet wallet and show its descriptor QR.');
  const path = `m/${match[2].replace(/[hH]/g, "'").replace(/\/+$/, '')}`;
  if (!/^m\/84'\/1'\/\d+'$/.test(path)) {
    throw new Error(`Keeper simulator expects a BIP84 testnet account key; received ${path}.`);
  }
  return { masterFingerprint: match[1].toUpperCase(), derivationPath: path, xpub: match[3] };
}

export async function createVaultFromSpecterQr(payload: unknown): Promise<Vault> {
  const metadata = descriptorMetadata(payload);
  const signer: VaultSigner = {
    masterFingerprint: metadata.masterFingerprint,
    xfp: metadata.masterFingerprint,
    derivationPath: metadata.derivationPath,
    xpub: WalletUtilities.getXpubFromExtendedKey(metadata.xpub, TESTNET),
    registeredVaults: [],
  };
  const vault = await generateVault({
    type: VaultType.SINGE_SIG,
    vaultName: 'Specter DIY · TESTNET',
    vaultDescription: 'Single-signature testnet wallet. Specter DIY holds the signing key.',
    scheme: { m: 1, n: 1, multisigScriptType: MultisigScriptType.DEFAULT_MULTISIG },
    signers: [signer],
    networkType: NetworkType.TESTNET,
  });
  if (vault.entityKind !== EntityKind.VAULT || vault.scriptType !== ScriptTypes.P2WPKH || !vault.specs.receivingAddress) {
    throw new Error('Keeper could not build a valid BIP84 testnet vault from this signer.');
  }
  // Keeper normally fills this public address cache while syncing Electrum.
  // The offline browser adapter uses the same source utilities and cache shape.
  const firstReceive = WalletUtilities.getAddressAndPubByIndex(
    signer.xpub,
    false,
    0,
    TESTNET,
    WalletUtilities.getSingleKeyDerivationPurpose(vault),
  );
  if (firstReceive.address !== vault.specs.receivingAddress) {
    throw new Error('Keeper address cache does not match the source-derived receive address.');
  }
  vault.specs.addresses = { external: { 0: firstReceive.address }, internal: {} };
  vault.specs.addressPubs = { [firstReceive.address]: firstReceive.pub };
  return vault;
}

export function prepareKeeperPsbt(vault: Vault) {
  if (vault.networkType !== NetworkType.TESTNET) throw new Error('Only testnet PSBTs are permitted.');
  const psbt = new bitcoinJS.Psbt({ network: TESTNET });
  psbt.setVersion(2);
  const input = {
    txId: '4f'.repeat(32),
    vout: 0,
    address: vault.specs.receivingAddress,
    value: 100_000,
  };
  WalletOperations.addInputToPSBT(psbt, vault, input as any, TESTNET);
  psbt.addOutput({ address: vault.specs.receivingAddress!, value: 90_000 });
  const base64 = psbt.toBase64();
  const frames = encodePsbtUR(base64, 180);
  if (!frames?.length) throw new Error('Keeper could not encode the PSBT as crypto-psbt UR.');
  return {
    base64,
    frames,
    inputValue: input.value,
    outputValue: 90_000,
    address: vault.specs.receivingAddress!,
  };
}

export function inspectKeeperPsbt(psbtText: string, vault: Vault, requestedPsbtText: string) {
  const psbt = bitcoinJS.Psbt.fromBase64(psbtText, { network: TESTNET });
  const requested = bitcoinJS.Psbt.fromBase64(requestedPsbtText, { network: TESTNET });
  if (psbt.inputCount !== 1) throw new Error('Expected the one-input test PSBT created by this Keeper session.');
  const signedTx = (psbt as any).__CACHE.__TX;
  const requestedTx = (requested as any).__CACHE.__TX;
  if (signedTx.toHex() !== requestedTx.toHex()) {
    throw new Error('The returned PSBT changed the Keeper test transaction.');
  }
  const utxo = psbt.data.inputs[0].witnessUtxo || requested.data.inputs[0].witnessUtxo;
  if (utxo?.value !== 100_000) {
    throw new Error('The returned PSBT does not match Keeper’s 100,000 sat test fixture.');
  }
  const expectedPubkey = WalletUtilities.getPublicKeyByIndex(
    vault.signers[0].xpub,
    0,
    0,
    TESTNET,
  ).publicKey;
  const partialSigs = psbt.data.inputs[0].partialSig || [];
  if (partialSigs.length) {
    const signerSignature = partialSigs.find((item) => item.pubkey.equals(expectedPubkey));
    if (!signerSignature || !psbt.validateSignaturesOfInput(0,
      (pubkey, hash, signature) => ecc.verify(hash, pubkey, signature), expectedPubkey)) {
      throw new Error('The returned partial signature did not verify against the Specter signer key.');
    }
    return { valid: true, status: 'Cryptographic signature verified', signedInputs: 1, finalized: false };
  }

  if (psbt.data.inputs[0].finalScriptWitness) {
    const tx = psbt.extractTransaction();
    const witness = tx.ins[0].witness;
    if (witness.length < 2 || !witness[witness.length - 1].equals(expectedPubkey)) {
      throw new Error('The finalized input does not contain the selected Specter signer key.');
    }
    const decoded = bitcoinJS.script.signature.decode(witness[0]);
    const scriptCode = bitcoinJS.payments.p2pkh({ pubkey: expectedPubkey }).output!;
    const sighash = signedTx.hashForWitnessV0(0, scriptCode, utxo.value, decoded.hashType);
    if (!ecc.verify(sighash, expectedPubkey, decoded.signature)) {
      throw new Error('The finalized witness signature is invalid for the Specter signer key.');
    }
    return { valid: true, status: 'Cryptographic finalized witness verified', signedInputs: 1, finalized: true };
  }
  throw new Error('The PSBT returned without a signature.');
}
