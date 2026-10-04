import * as esbuild from 'esbuild';
import {readFile, writeFile, mkdir, copyFile, readdir, unlink} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve, dirname, extname, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const upstream=resolve(root,'upstream/bluewallet'), adapters=resolve(root,'bluewallet-web');
const require=createRequire(resolve(upstream,'package.json'));
const rootRequire=createRequire(resolve(root,'package.json'));
const pin='0a53056a636370073a58d6cdd6de5c0728e5926a';
if(execFileSync('git',['rev-parse','HEAD'],{cwd:upstream,encoding:'utf8'}).trim()!==pin) throw new Error('BlueWallet source pin changed. Review the adapters before updating.');
const nativeAliases=new Map([
 ['@react-native-async-storage/async-storage','storage.ts'], ['react-native-default-preference','storage.ts'],
 ['react-native-context-menu-view','context-menu.tsx'], ['realm','realm.ts'], ['react-native-keychain','native-keychain.ts'], ['react-native-secure-key-store','native-keychain.ts'],
 ['react-native-camera-kit-no-google','camera.tsx'], ['react-native-fs','files.ts'],
 ['react-native-share','share.ts'], ['@react-native-documents/picker','document-picker.ts'],
 ['react-native-image-picker','image-picker.ts'], ['@react-native-clipboard/clipboard','clipboard.ts'], ['lottie-react-native','lottie.tsx'],

]);
const coreAliases=new Map([['bitcoinjs-lib','bitcoin.ts'],['bip32','bip32.ts'],['ecpair','ecpair.ts']]);
const sourceAliases=new Map([
 ['blue_modules/BlueElectrum.ts','electrum.ts'],
 ['class/wallets/lightning-ark-wallet.ts','disabled-wallet.ts'],
 ['class/wallets/lightning-custodian-wallet.ts','disabled-wallet.ts'],
 ['blue_modules/arkade-background.ts','disabled-services.ts'],
 ['blue_modules/notifications.ts','disabled-services.ts'],
 ['helpers/prompt.ts','prompt.ts'], ['blue_modules/react-native-bw-file-access.ts','files.ts'],
]);
const nativeWeb=new Set(['react-native-svg','react-native-gesture-handler','react-native-safe-area-context','react-native-screens','react-native-draggable-flatlist','react-native-reanimated','react-native-worklets','react-native-drawer-layout']);
const builtins=new Map(['crypto','stream','events','path','process','buffer','assert','url','util'].map(name=>[name,
 {crypto:'crypto-browserify',stream:'stream-browserify',events:'events/',path:'path-browserify',process:'process/browser',buffer:'buffer/',assert:'assert/',url:'url/',util:'util/'}[name]]));
function patchSource(contents,path) {
 let output=contents;
 if(path.startsWith(upstream) && !path.includes('node_modules')) {
  // Only literals/regexes and explicit network constants change. Upstream's
  // wallet algorithms, component trees and navigation stay in their source.
  output=output.replace(/(['"])([xyzXYZ]pub)\1/g,(_,quote,key)=>quote+({xpub:'tpub',ypub:'upub',zpub:'vpub',Xpub:'tpub',Ypub:'Upub',Zpub:'Vpub'}[key])+quote);
  output=output.replace(/0488b21e/gi,'043587cf').replace(/049d7cb2/gi,'044a5262').replace(/04b24746/gi,'045f1cf6').replace(/02aa7ed3/gi,'02575483').replace(/0295b43f/gi,'024289ef').replace(/02aa7a99/gi,'02575048').replace(/0295b005/gi,'024285b5');
  output=output.replace(/(m\/(?:44|49|48|84|86)'\/)0'/g,(match, prefix)=>prefix+"1'").replace(/(m\/(?:44|49|48|84|86)h\/)0h/g,(match, prefix)=>prefix+'1h');
  output=output.replace(/(['"])([xyzXYZ]prv)\1/g,(_,quote,key)=>quote+({xprv:'tprv',yprv:'uprv',zprv:'vprv',Xprv:'tprv',Yprv:'Uprv',Zprv:'Vprv'}[key])+quote);
  output=output.replace(/wif\.encode\(0x80,/g,'wif.encode(0xef,');
  if (/class\/wallets\/(?:abstract-wallet|abstract-hd-wallet|multisig-hd-wallet)\.ts$/.test(path.replaceAll('\\','/'))) {
   output=`import {assertTestnetImport,assertTestnetPsbt} from '${resolve(adapters,'policy.ts').replaceAll('\\','/')}';\n`+output;
   output=output.replace(/(setSecret\((newSecret|secret): string\)(?:: this)? \{)/g, '$1\n assertTestnetImport($2);');
   output=output.replace('setDerivationPath(path: string) {', 'setDerivationPath(path: string) {\n assertTestnetImport(path);');
   output=output.replace("json.network === 'mainnet'", "json.network === 'testnet'");
  }
  if(path.replaceAll('\\','/').endsWith('class/wallets/abstract-hd-electrum-wallet.ts'))output=`import {assertTestnetPsbt} from '${resolve(adapters,'policy.ts').replaceAll('\\','/')}';\n`+output;
  if(/class\/wallets\/(?:abstract-hd-electrum-wallet|multisig-hd-wallet)\.ts$/.test(path.replaceAll('\\','/')))output=output.replace(/(cosignPsbt\(psbt: (?:bitcoin\.)?Psbt\)(?:: \{ tx: Transaction \| false \})? \{)/g,'$1\n assertTestnetPsbt(psbt);');
  if(path.replaceAll('\\','/').endsWith('screen/send/psbtWithHardwareWallet.tsx'))output=output.replace('<BlueCard>', "<BlueCard style={{width:'100%',minWidth:0}}>");
  if(path.replaceAll('\\','/').endsWith('screen/send/ScanQRCode.tsx')) {
   // RN's native screen fills its parent; the web flex child needs an explicit
   // flex allocation to keep the camera surface and its controls full-height.
   output=output.replace('  ) : (\n    <View>', '  ) : (\n    <View style={{flex:1}}>');
  }
  if(path.replaceAll('\\','/').endsWith('screen/wallets/ImportWallet.tsx')) {
   output=`import {assertTestnetImport} from '${resolve(adapters,'policy.ts').replaceAll('\\','/')}';\nimport presentAlert from '../../components/Alert';\n`+output;
   output=output.replace('async (text: string) => {', "async (text: string) => {\n try {assertTestnetImport(text);} catch(error) {presentAlert({message:(error as Error).message});return;}");
  }
  if(path.replaceAll('\\','/').endsWith('class/wallet-import.ts')) {
   output=`import {assertTestnetImport} from '${resolve(adapters,'policy.ts').replaceAll('\\','/')}';\n`+output;
   output=output.replace('async function* importGenerator() {','async function* importGenerator() {\n assertTestnetImport(importTextOrig);');
  }
  if(path.replaceAll('\\','/').endsWith('components/QRCode.tsx')) {
   output=output.replace("import React, {", "import React, { useEffect,");
   const anchor='  const svgRef = useRef<Svg>(null);';
   if(!output.includes(anchor))throw new Error('Pinned BlueWallet QR component anchor changed.');
   // One component token spans its entire animated sequence. Clear only when
   // the upstream QR component unmounts, not between individual fragments.
   output=output.replace(anchor,`${anchor}\n const transportToken=useRef(crypto.randomUUID());\n useEffect(()=>{parent.postMessage({type:'blue-qr-output-frame',frame:String(value),token:transportToken.current},location.origin);},[value]);\n useEffect(()=>()=>parent.postMessage({type:'blue-qr-output-clear',token:transportToken.current},location.origin),[]);`);
  }
 }
 if(output!==contents)patchedInputs[relative(root,path).replaceAll('\\','/')]= {sourceSha256:createHash('sha256').update(contents).digest('hex'),browserSha256:createHash('sha256').update(output).digest('hex')};
 return output;
}
const fontStyles=new Map();
const patchedInputs={};
const nativeImports=new Map();
const walk=async dir=>{for(const item of await (await import('node:fs/promises')).readdir(dir,{withFileTypes:true})){if(item.name==='node_modules'||item.name.startsWith('.'))continue;const path=resolve(dir,item.name);if(item.isDirectory())await walk(path);else if(/\.[jt]sx?$/.test(path)){const src=await readFile(path,'utf8');for(const match of src.matchAll(/import\s+([^;]*?)\s+from\s+['"](react-native-[^'"]+|@react-native[^'"]+)['"]/g)){const module=match[2];const names=match[1].match(/\{([\s\S]*?)\}/)?.[1]?.split(',').map(n=>n.trim().replace(/^type /,'').split(/\s+as\s+/)[0]).filter(n=>/^\w+$/.test(n))||[];const namespace=match[1].match(/\*\s+as\s+(\w+)/)?.[1];if(namespace)for(const use of src.matchAll(new RegExp(namespace+'\\.(\\w+)','g')))names.push(use[1]);nativeImports.set(module,new Set([...(nativeImports.get(module)||[]),...names]));}}}};
await walk(upstream);
const plugins=[{name:'bluewallet-browser-boundaries',setup(build){
 build.onResolve({filter:/.*/},async args=>{
  const name=args.path;
  if(name==='react-native-web'||name.startsWith('react-native-web/'))return {path:rootRequire.resolve(name)};
  if(name==='react'||name==='react-dom'||name==='react-dom/client'||name==='react/jsx-runtime')return {path:rootRequire.resolve(name)};
  if(name==='react-native') return {path:resolve(adapters,'react-native.tsx')};
  if(nativeAliases.has(name))return {path:resolve(adapters,nativeAliases.get(name))};
  if(coreAliases.has(name) && !args.importer.startsWith(adapters))return {path:resolve(adapters,coreAliases.get(name))};
  if(builtins.has(name))return {path:require.resolve(builtins.get(name))};
  if(name.endsWith('release-notes') || name.endsWith('current-branch.json'))return {path:name,namespace:'blue-build-meta'};
  if(name.startsWith('react-native-')&&!nativeWeb.has(name)) return {path:name,namespace:'blue-native'};
  if(name.startsWith('@react-native-vector-icons/'))return {path:name,namespace:'blue-icons'};
  // Resolve original relative imports first, then intercept only documented
  // platform/service boundaries, never application screen modules.
  if(name.startsWith('.')||name.startsWith('/')){
   let candidate=resolve(args.resolveDir,name);
   for(const extension of ['', '.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','/index.ts','/index.tsx','/index.js']){
    if(existsSync(candidate+extension)){candidate+=extension;break;}
   }
   const rel=relative(upstream,candidate).replaceAll('\\','/');
   if(sourceAliases.has(rel))return {path:resolve(adapters,sourceAliases.get(rel))};
   if(name.endsWith('.js')){
    const web=candidate.replace(/\.js$/,'.web.js');if(existsSync(web))return {path:web};
   }
  }
  return null;
 });
 build.onLoad({filter:/.*/,namespace:'blue-build-meta'}, args=>({contents:args.path.replaceAll('\\','/').endsWith('current-branch.json')?'export default "8.0.1 browser Testnet3"':'export default "BlueWallet 8.0.1 browser port. Testnet3 only; no broadcast."',loader:'js'}));
 build.onLoad({filter:/.*/,namespace:'blue-native'},async args=>{
  const exports=[...(nativeImports.get(args.path)||[]), ...(args.path==='react-native-is-edge-to-edge'?['controlEdgeToEdgeValues','isEdgeToEdge']:[])];
  return {contents:`import {nativeService, namedService} from '${resolve(adapters,'native-service.tsx').replaceAll('\\','/')}';\nexport default nativeService(${JSON.stringify(args.path)});\n${exports.map(name=>`export const ${name}=namedService(${JSON.stringify(args.path)},${JSON.stringify(name)});`).join('\n')}`,loader:'tsx',resolveDir:adapters};
 });
 build.onLoad({filter:/.*/,namespace:'blue-icons'},async args=>{
  const family=args.path.split('/').at(-1);const dir=resolve(upstream,'node_modules',args.path);
  const fonts=await (await import('node:fs/promises')).readdir(resolve(dir,'fonts')).catch(()=>[]);
  const font=fonts.find(name=>family==='fontawesome6'?name.endsWith('_Solid.ttf'):name.endsWith('.ttf'));
  const glyphDir=resolve(dir,'glyphmaps');const maps=await (await import('node:fs/promises')).readdir(glyphDir).catch(()=>[]);
  const glyphFile=maps.find(name=>family==='fontawesome6'?name.endsWith('_solid.json'):name.endsWith('.json'));
  if(!font||!glyphFile)throw new Error('BlueWallet icon font assets missing: '+family);
  await copyFile(resolve(dir,'fonts',font),resolve(root,'builds/bluewallet-web',font));
  fontStyles.set(family,`@font-face{font-family:'${family}';src:url('/builds/bluewallet-web/${font}') format('truetype');font-display:block;}`);
  const glyphs=JSON.parse(await readFile(resolve(glyphDir,glyphFile),'utf8'));
  return {contents:`import React from 'react';import {Text} from 'react-native-web';\nconst glyphs=${JSON.stringify(glyphs)};\nexport default function Icon({name,size=24,color,style,...props}){return <Text {...props} style={[{fontFamily:${JSON.stringify(family)},fontSize:size,color},style]}>{String.fromCodePoint(glyphs[name]||0x25a1)}</Text>}`,loader:'tsx',resolveDir:adapters};
 });
 build.onLoad({filter:/\.json$/},async args=>{if(args.path.startsWith(upstream)&&!args.path.includes('node_modules'))return {contents:patchSource(await readFile(args.path,'utf8'),args.path),loader:'json'};return null;});
 build.onLoad({filter:/\.[jt]sx?$/},async args=>{
  if(args.path.startsWith(upstream)&&!args.path.includes('node_modules'))return {contents:patchSource(await readFile(args.path,'utf8'),args.path),loader:/\.tsx$/.test(args.path)?'tsx':/\.ts$/.test(args.path)?'ts':'jsx',resolveDir:dirname(args.path)};
  if(args.path.includes('node_modules')&&/\.jsx?$/.test(args.path)) {
   const source=await readFile(args.path,'utf8');
   if(/@flow|^\s*(?:import typeof|export type)\b/m.test(source)) {
    const babel=require('@babel/core');
    const result=await babel.transformAsync(source,{filename:args.path,babelrc:false,configFile:false,presets:[require.resolve('@react-native/babel-preset')]});
    return {contents:result.code,loader:'jsx',resolveDir:dirname(args.path)};
   }
  }
  return null;
 });
}}];
const output=resolve(root,'builds/bluewallet-web');await mkdir(output,{recursive:true});
await unlink(resolve(output,'FontAwesome6_Brands.ttf')).catch(error=>{if(error.code!=='ENOENT')throw error;});
const result=await esbuild.build({entryPoints:[resolve(adapters,'entry.tsx')],outfile:resolve(output,'bluewallet-app.js'),bundle:true,platform:'browser',format:'iife',target:'es2022',define:{__DEV__:'false','process.env.NODE_ENV':'"production"','global.__DEV__':'false'},plugins,mainFields:['browser','module','main'],resolveExtensions:['.web.tsx','.web.ts','.web.js','.tsx','.ts','.jsx','.js','.json'],external:['/browser/companion-file-dialog.js'],loader:{'.png':'dataurl','.jpg':'dataurl','.svg':'dataurl','.ttf':'file','.html':'text','.txt':'text'},nodePaths:[resolve(upstream,'node_modules'),resolve(root,'node_modules')],metafile:true,minify:true,legalComments:'external',logLimit:50});
await writeFile(resolve(output,'fonts.css'),[...fontStyles.values()].join('\n'));
await copyFile(resolve(upstream,'LICENSE'),resolve(root,'blue-wallet/LICENSE.txt'));
await copyFile(resolve(upstream,'img/icon.png'),resolve(root,'assets/bluewallet-logo.png'));
const packages=new Map();
for(const input of Object.keys(result.metafile.inputs)){
 if(!input.includes('node_modules'))continue;
 let directory=dirname(resolve(root,input));
 while(directory!==dirname(directory)){
  const packageFile=resolve(directory,'package.json');
  if(existsSync(packageFile)){const info=JSON.parse(await readFile(packageFile,'utf8'));if(info.name){packages.set(info.name+'@'+info.version,{directory,info});break;}}
  directory=dirname(directory);
 }
}
for(const family of fontStyles.keys()){
 const directory=resolve(upstream,'node_modules/@react-native-vector-icons',family);const info=JSON.parse(await readFile(resolve(directory,'package.json'),'utf8'));packages.set(info.name+'@'+info.version,{directory,info});
}
const notices=[`BlueWallet 8.0.1 MIT — pinned source ${pin}\n\n${await readFile(resolve(upstream,'LICENSE'),'utf8')}`];
for(const [name,{directory,info}] of [...packages].sort(([a],[b])=>a.localeCompare(b))){
 const licenseFiles=(await readdir(directory)).filter(name=>/^(LICENSE|LICENCE|COPYING|NOTICE)(?:[. -]|$)/i.test(name));
 notices.push(`\n===== ${name} (${info.license||'see package notice'}) =====\n`);
 for(const file of licenseFiles)notices.push(await readFile(resolve(directory,file),'utf8'));
}
notices.push(`\nIcon artwork/font attribution: Entypo by Daniel Bruce (CC BY-SA 4.0, https://entypo.com/); Font Awesome by Dave Gandy / Fonticons (font SIL OFL 1.1, icons CC BY 3.0 for v4 and CC BY 4.0 for v6, code MIT, https://fontawesome.com/license/free); Ionicons by Ionic (MIT, https://github.com/ionic-team/ionicons); Material Design Icons by Pictogrammers (Apache-2.0, https://pictogrammers.com/docs/library/mdi/license/); Material Icons by Google (Apache-2.0, https://github.com/google/material-design-icons). Fonts are unmodified.\n`);
await writeFile(resolve(output,'licenses.txt'),notices.join('\n'));
const bytes=await readFile(resolve(output,'bluewallet-app.js'));
const files={};
for(const filename of (await readdir(output)).filter(name=>name!=='build-info.json').sort()){
 if(!/\.(js|txt|css|ttf)$/.test(filename))continue;
 files[filename]=createHash('sha256').update(await readFile(resolve(output,filename))).digest('hex');
}
const adapterHashes={};for(const file of (await readdir(adapters)).sort())adapterHashes[file]=createHash('sha256').update(await readFile(resolve(adapters,file))).digest('hex');
const version=createHash('sha256').update(JSON.stringify(files)).digest('hex').slice(0,16);
let html=await readFile(resolve(root,'blue-wallet/runtime.html'),'utf8');
html=html.replace(/(bluewallet-app\.js|fonts\.css)(?:\?v=[a-f0-9]+)?/g,`$1?v=${version}`);
await writeFile(resolve(root,'blue-wallet/runtime.html'),html);
await writeFile(resolve(output,'build-info.json'),JSON.stringify({repository:'BlueWallet/BlueWallet',commit:pin,version:'8.0.1',browserVersion:version,network:'testnet3',broadcast:false,sha256:files['bluewallet-app.js'],files,adapterHashes,patchedInputs,rootLockSha256:createHash('sha256').update(await readFile(resolve(root,'package-lock.json'))).digest('hex'),upstreamLockSha256:createHash('sha256').update(await readFile(resolve(upstream,'package-lock.json'))).digest('hex'),inputs:Object.keys(result.metafile.inputs).filter(path=>path.includes('upstream/bluewallet')&&!path.includes('node_modules'))},null,2));
console.log(`BlueWallet ${pin}: ${bytes.length} bytes, upstream inputs preserved, browser version ${version}`);
