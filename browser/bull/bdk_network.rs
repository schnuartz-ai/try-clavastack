//! Browser HTTPS transport for the original BDK wallet scan API.
use std::sync::Arc;
use wasm_bindgen::prelude::*;
use uniffi::{Lift, Lower, ffi::Handle};
use bdk_esplora::EsploraAsyncExt;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_name = setTimeout)]
    fn set_timeout(callback: &JsValue, milliseconds: i32);
}
#[derive(Clone)]
struct BrowserSleeper;
impl bdk_esplora::esplora_client::Sleeper for BrowserSleeper {
    type Sleep = std::pin::Pin<Box<dyn std::future::Future<Output=()> + Send>>;
    fn sleep(duration: std::time::Duration) -> Self::Sleep {
        let (send, receive) = futures_channel::oneshot::channel();
        let callback = Closure::once_into_js(move || { let _ = send.send(()); });
        set_timeout(&callback, duration.as_millis().min(i32::MAX as u128) as i32);
        Box::pin(async move { let _ = receive.await; })
    }
}

fn js_error(error: impl std::fmt::Display) -> JsValue { JsValue::from_str(&error.to_string()) }
#[wasm_bindgen]
pub async fn bdk_scan(wallet_handle: &str, stop_gap: u32) -> Result<String, JsValue> {
    let raw: u64 = wallet_handle.parse().map_err(js_error)?;
    // The Dart binding passes an owned clone exactly as its native UniFFI
    // methods do. Lift consumes that clone and preserves the original handle.
    let wallet = <Arc<crate::wallet::Wallet> as Lift<crate::UniFfiTag>>::try_lift(
        unsafe { Handle::from_raw_unchecked(raw) }).map_err(js_error)?;
    let endpoint = match wallet.network() {
        bdk_wallet::bitcoin::Network::Bitcoin => "https://blockstream.info/api",
        bdk_wallet::bitcoin::Network::Testnet => "https://blockstream.info/testnet/api",
        _ => return Err(JsValue::from_str("No browser Esplora backend for this BDK network")),
    };
    let client = bdk_esplora::esplora_client::Builder::new(endpoint).build_async_with_sleeper::<BrowserSleeper>().map_err(js_error)?;
    let request = wallet.get_wallet().start_full_scan_at((js_sys::Date::now() / 1000.0) as u64).build();
    let response = client.full_scan(request, stop_gap as usize, 4).await.map_err(js_error)?;
    let update = Arc::new(crate::types::Update(response.into()));
    Ok(<Arc<crate::types::Update> as Lower<crate::UniFfiTag>>::lower(update).as_raw().to_string())
}
