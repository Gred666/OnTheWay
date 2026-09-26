use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use crate::vault::watch::VaultWatcher;
use crate::vault::Vault;

pub struct AppState {
    /// 当前仓库。换仓库时整个换掉里面的 Vault（文件监听线程发现根目录变了会自己退出）
    pub vault: Arc<Mutex<Vault>>,
    /// 持有它，监听才在
    pub watcher: Mutex<Option<VaultWatcher>>,
    /// 应用数据目录：配置、索引、旧库
    pub data_dir: PathBuf,
}
