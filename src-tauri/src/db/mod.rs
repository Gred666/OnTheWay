pub mod migrate;
pub mod pragma;

use std::path::Path;

use r2d2::Pool;
use r2d2_sqlite::SqliteConnectionManager;

use crate::error::Result;

pub type DbPool = Pool<SqliteConnectionManager>;
pub type DbConn = r2d2::PooledConnection<SqliteConnectionManager>;

/// 建连接池并把 schema 迁到最新。
///
/// 池大小 6：UI 最多同时跑 3–4 个查询，WAL 下多读单写，再多没意义。
pub fn open(path: &Path) -> Result<DbPool> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }

    // with_init 保证**每个**连接都执行一遍 PRAGMA ——
    // foreign_keys 是连接级的，忘了设就会静默失去外键约束
    let manager = SqliteConnectionManager::file(path).with_init(pragma::configure);
    let pool = Pool::builder()
        .max_size(6)
        .build(manager)
        .map_err(|e| crate::error::AppError::Db(format!("建池失败: {e}")))?;

    let mut conn = pool.get()?;
    migrate::run(&mut conn, path)?;

    Ok(pool)
}

/// 当前 UTC 毫秒
pub fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

/// UUIDv7：时间有序，索引局部性好，且为将来的多设备同步预留了无冲突主键
pub fn new_id() -> String {
    uuid::Uuid::now_v7().to_string()
}

/// 当前本地日期 'YYYY-MM-DD'
pub fn today_local() -> String {
    chrono::Local::now().format("%Y-%m-%d").to_string()
}

/// UTC 毫秒 → 本地日期 'YYYY-MM-DD'
pub fn local_date_of(ms: i64) -> String {
    chrono::DateTime::from_timestamp_millis(ms)
        .map(|dt| dt.with_timezone(&chrono::Local).format("%Y-%m-%d").to_string())
        .unwrap_or_else(today_local)
}

/* ============================================================
   测试辅助
   domain/ 不依赖 tauri，所以可以直接用内存库跑单测，不用起 app。
   ============================================================ */
#[cfg(test)]
pub mod test_support {
    use rusqlite::{params, Connection};

    /// 迁移到最新的内存库
    pub fn test_conn() -> Connection {
        let mut conn = Connection::open_in_memory().unwrap();
        super::pragma::configure(&mut conn).unwrap();
        super::migrate::run(&mut conn, std::path::Path::new(":memory:")).unwrap();
        conn
    }

    pub fn seed_task(conn: &Connection, id: &str, title: &str, status: &str) {
        conn.execute(
            "INSERT INTO task (id, title, status, sort_key, created_at, updated_at)
             VALUES (?1, ?2, ?3, 'a0', 0, 0)",
            params![id, title, status],
        )
        .unwrap();
    }

    pub fn seed_goal(conn: &Connection, id: &str, horizon: &str, period: &str, title: &str) {
        conn.execute(
            "INSERT INTO goal (id, title, horizon, period_start, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, 0, 0)",
            params![id, title, horizon, period],
        )
        .unwrap();
    }
}
