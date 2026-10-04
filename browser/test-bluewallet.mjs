import {chromium} from 'playwright';
import assert from 'node:assert/strict';
import {mkdir,writeFile} from 'node:fs/promises';
import {createDemoFiles} from './demo-data.js';
import {BIP32Factory} from 'bip32';
import * as ecc from 'tiny-secp256k1';
import * as bip39 from 'bip39';
import {networks,payments,Psbt,script} from 'bitcoinjs-lib';
import QRCode from 'qrcode';
import {PNG} from 'pngjs';
import jsQR from 'jsqr';
const base=process.env.TEST_BASE_URL||'http://127.0.0.1:8765';
const browser=await chromium.launch({...(process.env.CI?{}:{channel:'chrome'}),headless:true});
const errors=[],checks=[];
const page=await browser.newPage({viewport:{width:1512,height:1100}});
page.on('pageerror',e=>errors.push(e.message));
page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
const pass=name=>{checks.push(name);console.log('PASS '+name);};
const demo=createDemoFiles('testnet'), mainDemo=createDemoFiles('mainnet');
const seed='abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';
const root=BIP32Factory(ecc).fromSeed(bip39.mnemonicToSeedSync(seed),networks.testnet);
const expected=payments.p2wpkh({pubkey:root.derivePath("m/84'/1'/0'/0/0").publicKey,network:networks.testnet}).address;
const standard=seed.split(' ').map(word=>String(bip39.wordlists.english.indexOf(word)).padStart(4,'0')).join('');
const fileText=name=>new TextDecoder().decode(demo.files.find(f=>f.name===name).bytes).trim();
try{
 await mkdir('test-results/bluewallet',{recursive:true});
 await page.goto(`${base}/blue-wallet/runtime.html?test=1`);
 await page.getByTestId('Wallets').waitFor({timeout:45000});
 const audit=await page.evaluate(async ({seed,standard,ghost,zoo,psbt,mainPsbt,mainXpub,multisigJson,multisigPsbt,seed24,standard24})=>{
  const api=window.__blueTest;
  const wallet=new api.HDSegwitBech32Wallet();wallet.setSecret(seed);
  const numeric=new api.HDSegwitBech32Wallet();numeric.setSecret(standard);
  const compact=new api.HDSegwitBech32Wallet();compact.setSecret(api.normalizeQr({data:'',binaryData:Array(16).fill(0),chunks:[{type:'byte'}]},true));
  const word24=new api.HDSegwitBech32Wallet();word24.setSecret(seed24);
  const num24=new api.HDSegwitBech32Wallet();num24.setSecret(standard24);
  const compact24=new api.HDSegwitBech32Wallet();compact24.setSecret(api.normalizeQr({data:'',binaryData:Array(32).fill(0),chunks:[{type:'byte'}]},true));
  const vault=new api.MultisigHDWallet();vault.setSecret(multisigJson);const multisigAddress=vault._getExternalAddressByIndex(0);vault.replaceCosignerXpubWithSeed(1,ghost);vault.replaceCosignerXpubWithSeed(2,zoo);const multi=api.bitcoin.Psbt.fromBase64(multisigPsbt);const multisigSigned=!!vault.cosignPsbt(multi).tx;
  const rejected=[];
  for(const input of [mainXpub,'1BoatSLRHtKNngkdXEeobR76b53LETtpyT','bc1qk0a9hr7wjfxeenz9nwenw9flhq0tmsf6vsgnn2',"m/84'/0'/0'"]){try{new api.WatchOnlyWallet().setSecret(input);rejected.push(false);}catch{rejected.push(true);}}
  let mainPsbtRejected=false;try{api.bitcoin.Psbt.fromBase64(mainPsbt);}catch{mainPsbtRejected=true;}
  let broadcastRejected=false;try{api.noBroadcast();}catch{broadcastRejected=true;}
  let importRejected=false;try{await api.startImport(mainXpub,false,false,true,()=>{},()=>{},async()=> '').promise;}catch{importRejected=true;}
  let walletBroadcastRejected=false;try{await wallet.broadcastTx('00');}catch{walletBroadcastRejected=true;}
  let badSeedRejected=false;try{api.normalizeQr({data:'2048'.repeat(12)},true);}catch{badSeedRejected=true;}
  const signer=new api.HDSegwitBech32Wallet();signer.setSecret(ghost);
  const signed=api.bitcoin.Psbt.fromBase64(psbt);const result=signer.cosignPsbt(signed);
  const imported=await api.startImport(seed,false,false,true,()=>{},()=>{},async()=> '').promise;
  return {address24:word24._getExternalAddressByIndex(0),numeric24:num24._getExternalAddressByIndex(0),compact24:compact24._getExternalAddressByIndex(0),multisigAddress,multisigSigned,importRejected,walletBroadcastRejected,path:wallet.getDerivationPath(),xpub:wallet.getXpub(),address:wallet._getExternalAddressByIndex(0),valid:wallet.validateMnemonic(),numeric:numeric._getExternalAddressByIndex(0),compact:compact._getExternalAddressByIndex(0),rejected,mainPsbtRejected,broadcastRejected,badSeedRejected,signed:!!result.tx,hex:result.tx?result.tx.toHex():null,psbt:signed.toBase64(),importTypes:imported.wallets.map(w=>w.type)};
 },{seed24:bip39.entropyToMnemonic('00'.repeat(32)),standard24:bip39.entropyToMnemonic('00'.repeat(32)).split(' ').map(w=>String(bip39.wordlists.english.indexOf(w)).padStart(4,'0')).join(''),multisigJson:fileText('testnet-ghost-zoo-mirror-2of3.json'),multisigPsbt:fileText('testnet-multisig-unsigned.psbt'),zoo:demo.roots.zoo.mnemonic,seed,standard,ghost:demo.roots.ghost.mnemonic,psbt:fileText('testnet-ghost-payment-low-fee.psbt'),mainPsbt:new TextDecoder().decode(mainDemo.files.find(f=>f.name==='mainnet-ghost-payment-low-fee.psbt').bytes).trim(),mainXpub:BIP32Factory(ecc).fromSeed(bip39.mnemonicToSeedSync(seed)).neutered().toBase58()});
 console.log(audit);
 assert.equal(audit.multisigAddress,JSON.parse(fileText('testnet-ghost-zoo-mirror-2of3.json')).address);assert(audit.multisigSigned);assert(audit.importRejected);assert(audit.walletBroadcastRejected);assert.equal(audit.numeric24,audit.address24);assert.equal(audit.compact24,audit.address24);
 assert.equal(audit.path,"m/84'/1'/0'");assert(audit.xpub.startsWith('vpub'));assert.equal(audit.address,expected);assert(audit.valid);assert.equal(audit.numeric,expected);assert.equal(audit.compact,expected);assert(audit.rejected.every(Boolean));assert(audit.mainPsbtRejected);assert(audit.broadcastRejected);assert(audit.badSeedRejected);assert(audit.signed);assert(audit.importTypes.includes('HDsegwitBech32'));
 const signed=Psbt.fromBase64(audit.psbt,{network:networks.testnet});assert(signed.data.inputs[0].finalScriptWitness?.length);assert(signed.extractTransaction().toHex()===audit.hex);
 const tx=signed.extractTransaction(),[sig,pub]=tx.ins[0].witness,decoded=script.signature.decode(sig),prev=Psbt.fromBase64(fileText('testnet-ghost-payment-low-fee.psbt')).data.inputs[0].witnessUtxo;
 assert(ecc.verify(tx.hashForWitnessV0(0,script.compile([118,169,prev.script.subarray(2),136,172]),prev.value,decoded.hashType),pub,decoded.signature),'Independent ECDSA verification failed');
 pass('Original import, independent BIP84 address, Standard/CompactSeedQR, real synthetic PSBT signature, Mainnet/broadcast rejection');
 await page.getByText('Add now',{exact:true}).click();await page.getByTestId('ImportWallet').click();
 await page.getByTestId('MnemonicInput').fill(seed);await page.getByTestId('DoImport').click();
 await page.getByText('HD SegWit (BIP84 Bech32 Native)',{exact:false}).waitFor({timeout:30000});
 console.log('DISCOVERY',await page.locator('body').innerText());
 await page.screenshot({path:'test-results/bluewallet/discovery.png'});
 pass('Original Add Wallet / Import Wallet UI discovers the public seed');
 await page.getByText('HD SegWit (BIP84 Bech32 Native)',{exact:true}).click();
 await page.getByRole('button',{name:'Import',exact:true}).click();
 await page.getByTestId('Wallets').waitFor();
 await page.getByRole('button',{name:'OK',exact:true}).click();
 await page.setViewportSize({width:390,height:844});
 const saved=await page.evaluate(()=>window.__blueTest.BlueApp.getInstance().getWallets().map(w=>({type:w.type,label:w.getLabel(),address:w._getExternalAddressByIndex?.(0)})));
 assert(saved.some(w=>w.type==='HDsegwitBech32'&&w.address===expected));
 const actual=saved.find(w=>w.type==='HDsegwitBech32'&&w.address===expected);assert(actual.label.trim());
 await page.getByTestId(actual.label).waitFor();
 await page.getByTestId(actual.label).scrollIntoViewIfNeeded();
 await page.getByTestId(actual.label).click();
 console.log('SAVED WALLET UI',await page.locator('body').innerText());
 await page.getByText('Receive',{exact:true}).first().waitFor();
 await page.screenshot({path:'test-results/bluewallet/imported.png'});
 pass('Original wallet UI closes confirmation and displays the saved BIP84 wallet');
 await page.getByText('Receive',{exact:true}).first().click();
 const receiveCard=page.getByTestId('ReceiveCard');await receiveCard.waitFor();
 const qrSvg=receiveCard.locator('svg').first();await qrSvg.waitFor();
 let receiveQr;for(let attempt=0;attempt<8&&!receiveQr;attempt++){await page.waitForTimeout(250);const image=PNG.sync.read(await qrSvg.screenshot());receiveQr=jsQR(new Uint8ClampedArray(image.data),image.width,image.height);}
 assert(receiveQr?.data.includes(expected),'Rendered receive QR differs from independent Testnet BIP84 address');
 await page.screenshot({path:'test-results/bluewallet/receive.png'});
 pass('Original Receive screen renders a decodable QR with the independent Testnet BIP84 address');
 await page.evaluate(()=>window.__blueTest.navigationRef.navigate('AddWalletRoot',{screen:'ImportWallet'}));
 await page.getByTestId('MnemonicInput').fill(BIP32Factory(ecc).fromSeed(bip39.mnemonicToSeedSync(seed)).neutered().toBase58());await page.getByTestId('DoImport').click();
 await page.getByRole('dialog').getByText(/Mainnet imports are disabled/).waitFor();await page.getByRole('button',{name:'OK',exact:true}).click();assert(!(await page.locator('body').innerText()).includes('could not start'));
 pass('Original Import Wallet UI rejects Mainnet with a recoverable alert');
 assert.deepEqual(errors,[],'Runtime errors during original UI and signing workflows');
 await writeFile('test-results/bluewallet/audit.json',JSON.stringify({checks,audit,errors},null,2));
}finally{await browser.close();}
