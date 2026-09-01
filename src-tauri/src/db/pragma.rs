use rusqlite::Connection;

/// 每个连接都要跑一遍。
///
/// 注意 `foreign_keys` 是**连接级**开关，默认关闭 ——
/// 只在建库时设一次是没用的，新连接又会退回关闭状态。
/// 签名用 `&mut` 是为了匹配 r2d2 的 `with_init`；内部只需要 `&self`。
pub fn configure(conn: &mut Connection) -> rusqlite::Result<()> {
    // WAL：多读单写并发。持久化在库文件里，但重复设置无害。
    conn.pragma_update(None, "journal_mode", "WAL")?;
    // WAL 下 NORMAL 足够安全（掉电最多丢最后一个事务），比 FULL 快一个数量级
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "foreign_keys", true)?;
    conn.pragma_update(None, "busy_timeout", 5000i64)?;
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    conn.pragma_update(None, "mmap_size", 268_435_456i64)?; // 256MB
    Ok(())
}
