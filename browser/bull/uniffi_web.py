"""Generate a web transport for the pinned BDK UniFFI bindings.

Keep the generated Dart models, byte codecs, API and error lifters intact. Only
the FFI call boundary changes: the same Rust functions run inside WebAssembly.
Native TCP clients and foreign callbacks are deliberately unavailable here.
"""
from pathlib import Path
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
NATIVE = ROOT / ".browser-work/bdk-ffi/bdk-ffi"
DART = ROOT / ".browser-work/bdk-dart/lib/bdk.dart"
OUT = ROOT / ".browser-work/bdk-web-rust"
STAGE = ROOT / ".browser-work/bull-deps/bdk_dart"


def split_types(text):
    result, start, depth = [], 0, 0
    for i, char in enumerate(text):
        if char in "<([": depth += 1
        if char in ">)]": depth -= 1
        if char == "," and depth == 0:
            result.append(text[start:i].strip())
            start = i + 1
    if text[start:].strip(): result.append(text[start:].strip())
    return result


def rust_type(typ):
    typ = typ.strip()
    if typ.startswith("Pointer<"):
        return "*mut RustCallStatus" if "RustCallStatus" in typ else "Handle" if typ == "Pointer<Void>" else None
    return {"Void": "()", "Int8": "i8", "Uint8": "u8", "Int16": "i16",
            "Uint16": "u16", "Int32": "i32", "Uint32": "u32", "Int64": "i64",
            "Uint64": "u64", "IntPtr": "isize", "UintPtr": "usize", "Double": "f64",
            "Float": "f32", "RustBuffer": "RustBuffer", "ForeignBytes": "ForeignBytes"}.get(typ)


def unsupported(name):
    return bool(re.search(r"electrum|esplora|cbf|ipaddress|rust_future|callback|vtable", name))


def generate():
    for directory, pin in [(NATIVE.parent, '17c48b8b52ba81cdc58531e75ad1165be0cc25d9'), (DART.parent.parent, 'fbf8952ed7056c9663e4bd47dddc8b4994580532')]:
        actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=directory, text=True).strip()
        if actual != pin: raise RuntimeError(f'BDK source pin differs: {actual}')
    OUT.mkdir(parents=True, exist_ok=True)
    shutil.copytree(NATIVE / "src", OUT / "src", dirs_exist_ok=True)
    source = DART.read_text(encoding="utf-8")
    native_pattern = re.compile(
        r"@Native<(.*?)>\(\s*assetId:\s*_uniffiAssetId,?\s*\)\s*external\s+([^;]+);", re.S)
    declarations, arms = [], []

    def replace(match):
        native_sig, dart_sig = match.groups()
        sig = re.fullmatch(r"(.*?)\s+Function\((.*)\)", native_sig.strip(), re.S)
        dsig = re.fullmatch(r"(.+?)\s+(\w+)\s*\((.*)\)", dart_sig.strip(), re.S)
        if not sig or not dsig:
            raise ValueError(f"Cannot parse {dart_sig[:120]}")
        native_ret, native_args = sig.groups()
        dart_ret, name, dart_args = dsig.groups()
        dart_params = split_types(dart_args)
        names = [p.split()[-1] for p in dart_params]
        native_types = split_types(native_args)
        if len(names) != len(native_types): raise ValueError(name)
        rust_ret = rust_type(native_ret)
        rust_args = [rust_type(t) for t in native_types]
        available = not unsupported(name) and rust_ret is not None and all(rust_args)
        if available:
            arguments = []
            for i, (typ, rt) in enumerate(zip(native_types, rust_args)):
                if rt == "*mut RustCallStatus":
                    arguments.append("&mut status")
                elif typ == "RustBuffer":
                    arguments.append(f"RustBuffer::from_vec(bytes(&args[{i}]))")
                elif typ == "ForeignBytes":
                    arguments.append(f"ForeignBytes::from_raw_parts(foreign_bytes_{i}.as_ptr(), foreign_bytes_{i}.len() as i32)")
                elif typ.startswith("Pointer<"):
                    arguments.append(f"Handle::from_raw_unchecked(number(&args[{i}]) as u64)")
                elif rt in ("f64", "f32"):
                    arguments.append(f"args[{i}].as_f64().unwrap() as {rt}")
                else:
                    arguments.append(f"number(&args[{i}]) as {rt}")
            declarations.append(f"fn {name}({', '.join(f'a{i}: {t}' for i,t in enumerate(rust_args))}) -> {rust_ret};")
            prepare = "\n".join(f"let foreign_bytes_{i} = bytes(&args[{i}]);" for i,t in enumerate(native_types) if t == "ForeignBytes")
            encode = ("json!({\"buffer\": buffer(result)})" if native_ret == "RustBuffer" else
                      "json!({\"pointer\": result.as_raw()})" if native_ret.startswith("Pointer<") else
                      "Value::Null" if rust_ret == "()" else "json!(result.to_string())")
            binding = "let result = " if rust_ret != "()" else ""
            arms.append(f'"{name}" => {{ {prepare} {binding}unsafe {{ {name}({", ".join(arguments)}) }}; {encode} }},')
        args = ", ".join(names)
        body = f"throw UnsupportedError('Native BDK capability unavailable in browser: {name}');"
        if available:
            expression = f"wireCall('{name}', [{args}])"
            if dart_ret.strip() == "void":
                body = f"{expression};"
            elif dart_ret.strip().startswith("Pointer<"):
                body = f"return wirePointer({expression});"
            elif dart_ret.strip() == "RustBuffer":
                body = f"return wireBuffer({expression});"
            else:
                conversion = 'wireDouble' if dart_ret.strip() == 'double' else 'wireHash' if 'hash' in name and 'checksum' not in name else 'wireNumber'
                body = f"return {conversion}({expression});"
        return f"{dart_sig.strip()} {{ {body} }}"

    source, count = native_pattern.subn(replace, source)
    if count < 600: raise RuntimeError(f"Unexpected binding surface: {count}")
    source = source.replace('import "dart:ffi";', 'import "browser_ffi.dart";\nimport "dart:js_interop";')
    source = source.replace('import "package:ffi/ffi.dart";', '')
    source = source.replace('import "dart:io" show Platform, File, Directory;', '')
    # Dart's JS ByteData intentionally does not implement the 64-bit methods.
    # Keep the UniFFI wire format, with exact split-word codecs at that boundary.
    for method in ['getInt64', 'getUint64', 'setInt64', 'setUint64']:
        source = source.replace(f'.{method}(', f'.{method.replace("Int64", "BrowserInt64").replace("Uint64", "BrowserUint64")}(')
    # Browser-incompatible clients retain their API but cannot be silently
    # treated as online. Their checksums cannot be queried in a core-only build.
    source = re.sub(r"  if \((uniffi_bdkffi_checksum_\w+).*?\n  }",
                    lambda m: "" if unsupported(m.group(1)) else m.group(), source, flags=re.S)
    source = re.sub(r"final class (\w+) extends Struct \{", r"final class \1 extends Struct {", source)
    source = re.sub(r"@(Int8|Int32|Uint64)\(\)\s*", "", source)
    source = re.sub(r"external (int|Pointer<Uint8>|RustBuffer) (\w+);",
                    lambda m: f"{m.group(1)} {m.group(2)} = " + ("0;" if m.group(1)=="int" else "RustBuffer.empty();" if m.group(1)=="RustBuffer" else "Pointer<Uint8>.fromBytes(Uint8List(0));"), source)
    # Foreign callback vtables are not used by the browser transport. Remove
    # their native struct fields; their explicit unsupported factories remain.
    source = re.sub(r"external (Pointer<NativeFunction<[^;]+) (\w+);", r"late \1 \2;", source)
    source = re.sub(r"external\s+([^;]+);", r"late \1;", source)
    # The range check itself must not contain a rounded JavaScript literal.
    source = source.replace('value < -9223372036854775808 || value > 9223372036854775807',
                            "BigInt.from(value) < BigInt.parse('-9223372036854775808') || BigInt.from(value) > BigInt.parse('9223372036854775807')")
    source = source.replace("class RustBuffer extends Struct {", "class RustBuffer extends Struct {\n  RustBuffer.empty();")
    STAGE.mkdir(parents=True, exist_ok=True)
    (STAGE / "lib").mkdir(exist_ok=True)
    source += '\n' + (ROOT / 'browser/bull/bdk_network.dart').read_text(encoding='utf-8')
    (STAGE / "lib/bdk.dart").write_text(source, encoding="utf-8")
    (STAGE / "lib/browser_ffi.dart").write_text((ROOT / "browser/bull/browser_ffi.dart").read_text(encoding="utf-8"), encoding="utf-8")
    (STAGE / "pubspec.yaml").write_text('name: bdk_dart\nversion: 1.0.0-rc.3\nenvironment:\n  sdk: ">=3.12.2 <4.0.0"\n', encoding="utf-8")
    (OUT / "src/web.rs").write_text(RUST_PREAMBLE + '\nunsafe extern "C" {\n' + '\n'.join(declarations) + '\n}\n' +
                                  RUST_DISPATCH.replace("/* ARMS */", '\n'.join(arms)), encoding="utf-8")
    lib = (OUT / "src/lib.rs").read_text(encoding="utf-8")
    for name in ["electrum", "esplora", "kyoto"]:
        lib = lib.replace(f"mod {name};", "")
    (OUT / "src/lib.rs").write_text(lib + "\nmod web;\nmod browser_network;\n", encoding="utf-8")
    (OUT / 'src/browser_network.rs').write_text((ROOT / 'browser/bull/bdk_network.rs').read_text(encoding='utf-8'), encoding='utf-8')
    error = (OUT / "src/error.rs").read_text(encoding="utf-8")
    error = re.sub(r"use bdk_(electrum|esplora)::[^;]+;\n", "", error)
    error = re.sub(r"impl From<Bdk(Electrum|Esplora|Sqlite|PreV1Migration)Error> for \w+ \{", lambda m: "#[cfg(any())]\n" + m.group(), error)
    error = re.sub(r"^impl From<[^\n]*(?:rusqlite|BdkEsploraError|bdk_kyoto)[^\n]+\{", lambda m: "#[cfg(any())]\n" + m.group(), error, flags=re.M)
    error = re.sub(r"use bdk_wallet::(?:chain::rusqlite::Error as BdkSqliteError|migration::PreV1MigrationError as BdkPreV1MigrationError);\n", "", error)
    (OUT / "src/error.rs").write_text(error, encoding="utf-8")
    (OUT / "src/store.rs").write_text((ROOT / "browser/bull/store.rs").read_text(encoding="utf-8"), encoding="utf-8")
    (OUT / "Cargo.toml").write_text(CARGO, encoding="utf-8")
    lock = ROOT / 'browser/bull/bdk.Cargo.lock'
    shutil.copy2(lock if lock.exists() else DART.parent.parent / 'native/Cargo.lock', OUT / 'Cargo.lock')
    print(f"Generated {count} Dart call boundaries / {len(arms)} genuine Rust exports")


RUST_PREAMBLE = '''use uniffi::{RustBuffer, RustCallStatus, ForeignBytes, ffi::Handle};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;
use base64::{Engine, engine::general_purpose::STANDARD};
fn bytes(value: &Value) -> Vec<u8> { STANDARD.decode(value["buffer"].as_str().unwrap()).unwrap() }
fn number(value: &Value) -> i128 { value.as_str().map(|s| s.parse().unwrap()).unwrap_or_else(|| value.as_i64().unwrap() as i128) }
fn buffer(value: RustBuffer) -> String { STANDARD.encode(unsafe { value.destroy_into_vec() }) }
'''
RUST_DISPATCH = '''
#[wasm_bindgen]
pub fn bdk_call(name: &str, encoded: &str) -> Result<String, JsValue> {
    let args: Vec<Value> = serde_json::from_str(encoded).map_err(|e| JsValue::from_str(&e.to_string()))?;
    let mut status = RustCallStatus::default();
    let result = match name {
        /* ARMS */
        _ => return Err(JsValue::from_str("Unsupported native BDK transport")),
    };
    let code = status.code as i8;
    let error = buffer(unsafe { std::mem::ManuallyDrop::take(&mut status.error_buf) });
    Ok(json!({"result":result,"status":code,"error":error}).to_string())
}
'''
CARGO = '''[package]
name = "bull-bdk-web"
version = "0.1.0"
edition = "2021"
[lib]
crate-type = ["cdylib"]
name = "bdkffi"
[dependencies]
bdk_wallet = { version = "=3.0.0", features = ["all-keys", "keys-bip39"] }
bdk_esplora = { version = "=0.22.2", default-features = false, features = ["std", "async", "async-https"] }
uniffi = { version = "=0.31.2", default-features = false, features = ["wasm-unstable-single-threaded"] }
thiserror = "=2.0.17"
wasm-bindgen = "=0.2.105"
wasm-bindgen-futures = "=0.4.55"
futures-channel = "0.3"
js-sys = "=0.3.82"
serde_json = "1.0"
base64 = "0.22"
getrandom = { version = "0.2", features = ["js"] }
[profile.release]
opt-level = "s"
lto = true
codegen-units = 1
'''

if __name__ == "__main__":
    generate()
