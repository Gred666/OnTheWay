use std::path::PathBuf;

use crate::db::DbPool;

pub struct AppState {
    pub pool: DbPool,
    pub db_path: PathBuf,
}
