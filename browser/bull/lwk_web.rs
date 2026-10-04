//! Transport only: invoke the original pinned LWK API methods in WASM.
mod api;
use std::{collections::BTreeMap, sync::{Arc, Mutex, LazyLock}, ops::Deref};
use serde_json::{Value, json};
use wasm_bindgen::prelude::*;
use api::{descriptor::Descriptor, types::{LiquidNetwork, Address, WalletBalance, OutPoint, TxOutputSpec}, wallet::Wallet, error::LwkError};
use std::str::FromStr;

pub struct RustOpaque<T>(T);
impl<T> RustOpaque<T> { pub fn new(value: T) -> Self { Self(value) } }
impl<T> Deref for RustOpaque<T> { type Target = T; fn deref(&self) -> &T { &self.0 } }
static WALLETS: LazyLock<Mutex<BTreeMap<String, Arc<Wallet>>>> = LazyLock::new(|| Mutex::new(BTreeMap::new()));
fn network(value: &Value) -> Result<LiquidNetwork, JsValue> { match value.as_str() {
    Some("mainnet") => Ok(LiquidNetwork::Mainnet), Some("testnet") => Ok(LiquidNetwork::Testnet),
    _ => Err(JsValue::from_str("Invalid LWK network"))
} }
fn string(value: &Value, key: &str) -> String { value[key].as_str().unwrap_or_default().to_owned() }
fn integer(value: &Value, key: &str) -> u64 { value[key].as_str().and_then(|v| v.parse().ok()).or_else(|| value[key].as_u64()).unwrap_or_default() }
fn fail(error: LwkError) -> JsValue { JsValue::from_str(&error.msg) }
fn js_error(error: impl std::fmt::Display) -> JsValue { JsValue::from_str(&error.to_string()) }
fn exact_numbers(value: &mut Value) {
    match value {
        Value::Array(items) => items.iter_mut().for_each(exact_numbers),
        Value::Object(items) => items.values_mut().for_each(exact_numbers),
        Value::Number(n) => {
            if n.as_u64().map(|n| n > 9_007_199_254_740_991).unwrap_or(false) || n.as_i64().map(|n| n < -9_007_199_254_740_991).unwrap_or(false) { *value = Value::String(n.to_string()); }
        }, _ => {}
    }
}
fn encode<T: serde::Serialize>(value: T) -> Result<String, JsValue> {
    let mut value = serde_json::to_value(value).map_err(js_error)?;
    exact_numbers(&mut value);
    serde_json::to_string(&value).map_err(js_error)
}
fn required(value: &Value, key: &str) -> Result<String, JsValue> { value[key].as_str().map(str::to_owned).ok_or_else(|| JsValue::from_str(&format!("Missing LWK field: {key}"))) }
fn required_integer(value: &Value, key: &str) -> Result<u64, JsValue> {
    match &value[key] {
        Value::String(number) => number.parse().map_err(js_error),
        Value::Number(number) => number.as_u64().ok_or_else(|| JsValue::from_str("Invalid unsigned LWK integer")),
        _ => Err(JsValue::from_str(&format!("Missing LWK integer: {key}"))),
    }
}
fn required_bytes(value: &Value, key: &str) -> Result<Vec<u8>, JsValue> {
    value[key].as_array().ok_or_else(|| JsValue::from_str("Missing transaction bytes"))?.iter().map(|byte| {
        byte.as_u64().and_then(|b| u8::try_from(b).ok()).ok_or_else(|| JsValue::from_str("Invalid transaction byte"))
    }).collect()
}
fn opt_string(value: &Value, key: &str) -> Option<String> { value[key].as_str().map(str::to_owned) }
fn optional_u32(value: &Value, key: &str) -> Result<Option<u32>, JsValue> {
    if value[key].is_null() { Ok(None) } else { u32::try_from(integer(value,key)).map(Some).map_err(js_error) }
}

#[wasm_bindgen]
pub fn lwk_call(operation: &str, input: &str) -> Result<String, JsValue> {
    let args: Value = serde_json::from_str(input).map_err(|e| JsValue::from_str(&e.to_string()))?;
    match operation {
        "descriptor" => encode(Descriptor::new_confidential(network(&args["network"])?, required(&args,"mnemonic")?).map_err(fail)?),
        "lbtcAssetId" => encode(api::types::get_lbtc_asset_id()),
        "ltestAssetId" => encode(api::types::get_ltest_asset_id()),
        "balanceByAssetId" => {
            let balances: Vec<WalletBalance> = args["balances"].as_array().ok_or_else(|| JsValue::from_str("Missing LWK balances"))?.iter().map(|b| WalletBalance { asset_id:string(b,"assetId"),value:integer(b,"value") }).collect();
            encode(api::types::get_balance_by_asset_id(balances, required(&args,"assetId")?))
        },
        "addressFromScript" => encode(Address::address_from_script(network(&args["network"])?, required(&args,"script")?, opt_string(&args,"blindingKey")).map_err(fail)?),
        "addressValidate" => encode(Address::validate(required(&args,"address")?).map_err(fail)?),
        "walletInit" => {
            let path = required(&args,"path")?;
            if path.is_empty() { return Err(JsValue::from_str("Empty LWK wallet path")); }
            let descriptor = required(&args,"descriptor")?;
            let net = network(&args["network"])?;
            let mut wallets = WALLETS.lock().unwrap();
            if !wallets.contains_key(&path) {
                let wallet = Wallet::init(net, path.clone(), Descriptor { ct_descriptor: descriptor.clone() }).map_err(fail)?;
                if let Some(updates) = args["updates"].as_array() {
                    for update in updates {
                        let bytes = hex::decode(update.as_str().ok_or_else(|| JsValue::from_str("Invalid LWK update encoding"))?).map_err(js_error)?;
                        wallet.get_wallet().map_err(fail)?.apply_update(lwk_wollet::Update::deserialize(&bytes).map_err(js_error)?).map_err(js_error)?;
                    }
                }
                wallets.insert(path.clone(), Arc::new(wallet));
            } else {
                let wallet = wallets[&path].get_wallet().map_err(fail)?;
                let canonical = lwk_wollet::WolletDescriptor::from_str(&descriptor).map_err(js_error)?.to_string();
                if wallet.network() != net.into() || wallet.wollet_descriptor().to_string() != canonical { return Err(JsValue::from_str("LWK wallet path already belongs to a different descriptor or network")); }
            }
            encode(path)
        },
        "walletDelete" => { WALLETS.lock().unwrap().remove(&string(&args,"path")); encode(()) },
        "walletExists" => encode(WALLETS.lock().unwrap().contains_key(&string(&args,"path"))),
        "walletExport" => {
            let mut saved = BTreeMap::new();
            for (path, wallet) in WALLETS.lock().unwrap().iter() {
                let wallet = wallet.get_wallet().map_err(fail)?;
                let updates: Result<Vec<String>, _> = wallet.updates().map_err(js_error)?.iter().map(|u| u.serialize().map(hex::encode)).collect();
                saved.insert(path.clone(), json!({"descriptor":wallet.wollet_descriptor().to_string(), "network": if wallet.network() == lwk_wollet::Network::Liquid {"mainnet"} else {"testnet"}, "updates":updates.map_err(js_error)?}));
            }
            encode(saved)
        },
        "walletCall" => {
            let wallet = WALLETS.lock().unwrap().get(&string(&args,"path")).cloned().ok_or_else(|| JsValue::from_str("LWK wallet not open"))?;
            let method = args["method"].as_str().unwrap_or_default();
            let params = &args["args"];
            match method {
                "address" => encode(wallet.address(integer(params,"index") as u32).map_err(fail)?),
                "addressLastUnused" => encode(wallet.address_last_unused().map_err(fail)?),
                "balances" => encode(wallet.balances().map_err(fail)?),
                "descriptor" => encode(wallet.descriptor().map_err(fail)?),
                "blindingKey" => encode(wallet.blinding_key().map_err(fail)?),
                "txs" => encode(wallet.txs().map_err(fail)?),
                "utxos" => encode(wallet.utxos().map_err(fail)?),
                "signTx" => encode(wallet.sign_tx(network(&params["network"])?, string(params,"pset"), string(params,"mnemonic")).map_err(fail)?),
                "signedPsetWithExtraDetails" => encode(wallet.signed_pset_with_extra_details(network(&params["network"])?, string(params,"pset"), string(params,"mnemonic")).map_err(fail)?),
                "decodeTx" => encode(wallet.decode_tx(string(params,"pset")).map_err(fail)?),
                "buildLbtcTx" => encode(wallet.build_lbtc_tx(integer(params,"sats"), string(params,"outAddress"), params["feeRate"].as_f64().unwrap_or_default() as f32, params["drain"].as_bool().unwrap_or_default()).map_err(fail)?),
                "buildAssetTx" => encode(wallet.build_asset_tx(integer(params,"sats"), string(params,"outAddress"), params["feeRate"].as_f64().unwrap_or_default() as f32, string(params,"asset")).map_err(fail)?),
                "consolidate" => encode(wallet.consolidate(params["feeRate"].as_f64().ok_or_else(|| JsValue::from_str("Missing fee rate"))? as f32, optional_u32(params,"highUtxoThreshold")?, optional_u32(params,"maximumInputs")?).map_err(fail)?),
                "buildCustomTx" => {
                    let utxos: Vec<OutPoint> = params["utxos"].as_array().ok_or_else(|| JsValue::from_str("Missing UTXOs"))?.iter().map(|o| OutPoint {txid:string(o,"txid"),vout:integer(o,"vout") as u32}).collect();
                    let outputs: Vec<TxOutputSpec> = params["outputs"].as_array().ok_or_else(|| JsValue::from_str("Missing outputs"))?.iter().map(|o| TxOutputSpec {address:string(o,"address"),satoshi:integer(o,"satoshi"),asset_id:opt_string(o,"assetId")}).collect();
                    encode(wallet.build_custom_tx(utxos,outputs,opt_string(params,"drainTo"),params["feeRate"].as_f64().ok_or_else(|| JsValue::from_str("Missing fee rate"))? as f32).map_err(fail)?)
                },
                _ => Err(JsValue::from_str("Native LWK capability unavailable in browser")),
            }
        },
        /* OPAQUE TRANSACTIONS */
        "extractTxBytes" => encode(api::transaction::extract_tx_bytes(string(&args,"pset")).map_err(fail)?),
        "getSizeAndAbsoluteFees" => encode(api::transaction::get_size_and_absolute_fees(string(&args,"pset")).map_err(fail)?),
        _ => Err(JsValue::from_str("Unknown LWK web transport operation")),
    }
}

#[wasm_bindgen]
pub async fn lwk_async_call(operation: &str, input: &str) -> Result<String, JsValue> {
    let args: Value = serde_json::from_str(input).map_err(js_error)?;
    match operation {
        "walletSync" => {
            let wallet = WALLETS.lock().unwrap().get(&required(&args,"path")?).cloned().ok_or_else(|| JsValue::from_str("LWK wallet not open"))?;
            // Make a native Wollet snapshot so the async HTTP request never
            // holds a synchronous mutex while the UI is querying balances.
            let scan_wallet = {
                let original = wallet.get_wallet().map_err(fail)?;
                let mut scan = lwk_wollet::WolletBuilder::new(original.network(),original.wollet_descriptor()).with_stores(Arc::new(lwk_common::MemoryStore::new())).map_err(js_error)?.build().map_err(js_error)?;
                for update in original.updates().map_err(js_error)? { scan.apply_update(update).map_err(js_error)?; }
                scan
            };
            let endpoint = match scan_wallet.network() {
                lwk_wollet::Network::Liquid => "https://blockstream.info/liquid/api",
                lwk_wollet::Network::TestnetLiquid => "https://blockstream.info/liquidtestnet/api",
                _ => return Err(JsValue::from_str("Unsupported LWK browser network")),
            };
            let mut client = lwk_wollet::asyncr::EsploraClient::new(scan_wallet.network(),endpoint);
            let update = client.full_scan_to_index(&scan_wallet, optional_u32(&args,"stopAtIndex")?.unwrap_or(0)).await.map_err(js_error)?;
            if let Some(update) = update { wallet.get_wallet().map_err(fail)?.apply_update(update).map_err(js_error)?; }
            encode(())
        },
        _ => Err(JsValue::from_str("This LWK browser network capability is not available")),
    }
}
