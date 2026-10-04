"""Port the pinned native LWK API's platform boundary to WebAssembly.

Wallet methods and validation are copied from lwk-dart. This overlay replaces
the RustOpaque wrapper, filesystem constructor and native Electrum transport.
"""
from pathlib import Path
import re
import subprocess
import shutil
from prepare import ROOT

PIN = 'f554c7842f1f4b8e59c72d10a6f0747cb03fa315'
SOURCE = ROOT / '.browser-work/lwk-dart'
OUT = ROOT / '.browser-work/lwk-web-rust'


def generate():
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=SOURCE, text=True).strip()
    if actual != PIN: raise RuntimeError(f'LWK source pin differs: {actual}')
    (OUT / 'src/api').mkdir(parents=True, exist_ok=True)
    for name in ['descriptor', 'error', 'types', 'wallet', 'transaction']:
        text = (SOURCE / f'rust/src/api/{name}.rs').read_text(encoding='utf-8')
        text = text.replace('use flutter_rust_bridge::frb;', '')
        text = re.sub(r'#\[frb(?:\([^\n]*\))?\]\s*', '', text)
        text = text.replace('use flutter_rust_bridge::RustOpaqueNom as RustOpaque;', 'use crate::RustOpaque;')
        # Preserve the original public methods and their validations.
        if name == 'wallet':
            text = text.replace('use lwk_wollet::{full_scan_to_index_with_electrum_client, ElectrumOptions};',
                                '#[cfg(not(target_arch="wasm32"))]\nuse lwk_wollet::{full_scan_to_index_with_electrum_client, ElectrumOptions};')
            text = text.replace('use lwk_wollet::ElectrumClient;', '#[cfg(not(target_arch="wasm32"))]\nuse lwk_wollet::ElectrumClient;')
            text = text.replace('    pub fn sync(', '    #[cfg(not(target_arch="wasm32"))]\n    pub fn sync(')
            text = text.replace('    pub fn build_payjoin_tx(', '    #[cfg(not(target_arch="wasm32"))]\n    pub fn build_payjoin_tx(')
            anchor = '.with_legacy_fs_store(dbpath.clone())?'
            if text.count(anchor) != 1: raise RuntimeError('LWK persistence anchor differs')
            text = text.replace(anchor, '.with_stores(std::sync::Arc::new(lwk_common::MemoryStore::new()))?')
            text = text.replace('    fn get_wallet(&self)', '    pub(crate) fn get_wallet(&self)')
        # Serialization is the web call boundary, with the existing FRB field
        # names. Opaque wallets are never serialized or exported.
        text = re.sub(r'(^pub (?:struct|enum) (\w+))',
                      lambda m: m.group() if m.group(2) == 'Wallet' else
                      '#[derive(serde::Serialize)]\n#[serde(rename_all="camelCase")]\n' + m.group(), text, flags=re.M)
        (OUT / f'src/api/{name}.rs').write_text(text, encoding='utf-8')
    (OUT / 'src/api/mod.rs').write_text('pub mod descriptor;\npub mod error;\npub mod types;\npub mod wallet;\npub mod transaction;\n', encoding='utf-8')
    (OUT / 'src/lib.rs').write_text((ROOT / 'browser/bull/lwk_web.rs').read_text(encoding='utf-8'), encoding='utf-8')
    dart = (ROOT / '.browser-work/bull-sdk/packages/bull_sdk/lib/src/rust/third_party/lwk/api/transaction.dart').read_text()
    arms = []
    for name, operation in [('LiquidTransaction','liquidTransaction'), ('PartiallySignedElementsTransaction','elementsPset')]:
        start = dart.index('abstract class '+name)
        end = dart.index('\n}',start)
        methods = []
        for match in re.finditer(r'  ([\w<>?]+) (\w+)\((.*?)\);', dart[start:end], re.S):
            ret, method, params = match.groups()
            native = re.sub(r'([A-Z])', lambda m: '_'+m.group().lower(), method)
            argument = 'usize::try_from(required_integer(&args["args"],"index")?).map_err(js_error)?' if 'index' in params else ''
            expression = f'value.{native}({argument})'
            if method == 'extractTx': expression += '.map_err(fail)?.to_bytes()'
            methods.append(f'"{method}" => encode({expression}),')
        constructor = 'api::transaction::LiquidTransaction::from_bytes(required_bytes(&args,"txBytes")?).map_err(fail)?' if operation == 'liquidTransaction' else 'api::transaction::PartiallySignedElementsTransaction::from_string(required(&args,"pset")?).map_err(fail)?'
        arms.append(f'''"{operation}" => {{
            let value = {constructor};
            match required(&args,"method")?.as_str() {{
                {chr(10).join(methods)}
                _ => Err(JsValue::from_str("Unknown native LWK transaction method")),
            }}
        }},''')
    generated = (OUT / 'src/lib.rs').read_text()
    (OUT / 'src/lib.rs').write_text(generated.replace('/* OPAQUE TRANSACTIONS */', '\n'.join(arms)))
    (OUT / 'Cargo.toml').write_text(CARGO, encoding='utf-8')
    lock = ROOT / 'browser/bull/lwk.Cargo.lock'
    # Bull SDK's aggregate lock is the actual mobile application's resolution.
    shutil.copy2(lock if lock.exists() else ROOT / '.browser-work/bull-sdk/Cargo.lock', OUT / 'Cargo.lock')
    print(f'Prepared genuine LWK API {PIN} for WASM')


CARGO = '''[package]
name = "bull-lwk-web"
version = "0.1.0"
edition = "2021"
[lib]
crate-type = ["cdylib"]
name = "bull_lwk"
[dependencies]
lwk_wollet = { version = "=0.18.0", default-features = false, features = ["esplora"] }
lwk_signer = { version = "=0.18.0", default-features = false }
lwk_common = "=0.18.0"
anyhow = "1.0"
zeroize = "1.8"
serde = { version = "1.0", features = ["derive"] }
serde_json = "1.0"
wasm-bindgen = "=0.2.105"
wasm-bindgen-futures = "0.4"
getrandom = { version = "0.2", features = ["js"] }
hex = "0.4"
[profile.release]
opt-level = "s"
lto = true
codegen-units = 1
'''

if __name__ == '__main__': generate()
