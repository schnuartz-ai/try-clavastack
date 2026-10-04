//! Browser persistence adapter. The actual BDK ChangeSet remains authoritative.
use crate::error::{PersistenceError, PreV1MigrationError};
use crate::types::{ChangeSet, KeychainKind};
use bdk_wallet::{WalletPersister, chain::Merge};
use std::sync::{Arc, Mutex, LazyLock};
use std::collections::BTreeMap;

#[uniffi::export(with_foreign)]
pub trait Persistence: Send + Sync {
    /// Initialize the total aggregate `ChangeSet` for the underlying wallet.
    fn initialize(&self) -> Result<Arc<ChangeSet>, PersistenceError>;
    /// Persist a `ChangeSet` to the total aggregate changeset of the wallet.
    fn persist(&self, changeset: Arc<ChangeSet>) -> Result<(), PersistenceError>;
}
pub(crate) enum PersistenceType {
    Custom(Arc<dyn Persistence>),
    Browser(Arc<Mutex<bdk_wallet::ChangeSet>>),
}
static STORES: LazyLock<Mutex<BTreeMap<String, Arc<Mutex<bdk_wallet::ChangeSet>>>>> = LazyLock::new(|| Mutex::new(BTreeMap::new()));
#[derive(Debug, Clone, uniffi::Record)]
pub struct PreV1WalletKeychain {
    pub keychain: KeychainKind,
    pub last_derivation_index: u32,
    pub checksum: String,
}
#[derive(uniffi::Object)]
pub struct Persister { pub(crate) inner: Mutex<PersistenceType> }
#[uniffi::export]
impl Persister {
    /// Create a new Sqlite connection at the specified file path.
    #[uniffi::constructor]
    pub fn new_sqlite(path: String) -> Result<Self, PersistenceError> {
        let store = STORES.lock().unwrap().entry(path).or_default().clone();
        Ok(Self { inner: Mutex::new(PersistenceType::Browser(store)) })
    }
    /// Create a new connection in memory.
    #[uniffi::constructor]
    pub fn new_in_memory() -> Result<Self, PersistenceError> {
        Ok(Self { inner: Mutex::new(PersistenceType::Browser(Arc::default())) })
    }
    /// Use a native persistence layer.
    #[uniffi::constructor]
    pub fn custom(persistence: Arc<dyn Persistence>) -> Self {
        Self { inner: Mutex::new(PersistenceType::Custom(persistence)) }
    }
    /// Retrieve keychain metadata from a pre-v1 BDK SQLite wallet database.
    pub fn get_pre_v1_wallet_keychains(&self) -> Result<Vec<PreV1WalletKeychain>, PreV1MigrationError> {
        Err(PreV1MigrationError::SqliteOnly)
    }
}
impl WalletPersister for PersistenceType {
    type Error = PersistenceError;
    fn initialize(persister: &mut Self) -> Result<bdk_wallet::ChangeSet, Self::Error> {
        match persister {
            Self::Browser(store) => Ok(store.lock().unwrap().clone()),
            Self::Custom(other) => other.initialize().map(|s| s.as_ref().clone().into()),
        }
    }
    fn persist(persister: &mut Self, changeset: &bdk_wallet::ChangeSet) -> Result<(), Self::Error> {
        match persister {
            Self::Browser(store) => { store.lock().unwrap().merge(changeset.clone()); Ok(()) },
            Self::Custom(other) => other.persist(Arc::new(changeset.clone().into())),
        }
    }
}

// Serialize the real BDK changesets at the browser storage boundary. Neither
// descriptor derivation nor transaction state is reconstructed in JavaScript.
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn bdk_store_export() -> Result<String, wasm_bindgen::JsValue> {
    let stores: BTreeMap<String, bdk_wallet::ChangeSet> = STORES.lock().unwrap().iter()
        .map(|(path, value)| (path.clone(), value.lock().unwrap().clone())).collect();
    serde_json::to_string(&stores).map_err(|e| wasm_bindgen::JsValue::from_str(&e.to_string()))
}
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn bdk_store_import(encoded: &str) -> Result<(), wasm_bindgen::JsValue> {
    let stores: BTreeMap<String, bdk_wallet::ChangeSet> = serde_json::from_str(encoded)
        .map_err(|e| wasm_bindgen::JsValue::from_str(&e.to_string()))?;
    let mut current = STORES.lock().unwrap();
    if !current.is_empty() { return Err(wasm_bindgen::JsValue::from_str("BDK session has already opened wallets")); }
    *current = stores.into_iter().map(|(path, value)| (path, Arc::new(Mutex::new(value)))).collect();
    Ok(())
}
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn bdk_store_exists(path: &str) -> bool {
    STORES.lock().unwrap().get(path).map(|s| !s.lock().unwrap().is_empty()).unwrap_or(false)
}
#[wasm_bindgen::prelude::wasm_bindgen]
pub fn bdk_store_delete(path: &str) { STORES.lock().unwrap().remove(path); }
