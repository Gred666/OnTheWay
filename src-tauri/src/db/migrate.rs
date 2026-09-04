use std::path::Path;

use rusqlite::Connection;

use crate::error::{AppError, Result};

/// 迁移列表。
///
/// **一旦发布就不能修改已有条目，只能往后追加。**
/// 版本号 = 数组下标 + 1，存在 `PRAGMA user_version`。
const MIGRATIONS: &[&str] = &[
    include_str!("../../migrations/0001_init.sql"),
    include_str!("../../migrations/0002_unify_markdown_documents.sql"),
    include_str!("../../migrations/0003_remove_legacy_action_groups.sql"),
];

pub fn run(conn: &mut Connection, db_path: &Path) -> Result<()> {
    let current: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    let target = MIGRATIONS.len() as i64;

    if current == target {
        return Ok(());
    }

    // 用户装了新版又退回旧版：必须明确报错，不能静默按旧 schema 操作新数据
    if current > target {
        return Err(AppError::DbTooNew {
            found: current,
            supported: target,
        });
    }

    // 迁移前留一份备份。老库出问题时至少能捞回来。
    if current > 0 {
        backup_before_migration(conn, db_path, current)?;
    }

    for (i, sql) in MIGRATIONS.iter().enumerate().skip(current as usize) {
        let version = (i + 1) as i64;
        let tx = conn.transaction()?;
        tx.execute_batch(sql)
            .map_err(|e| AppError::Db(format!("迁移 {version} 失败: {e}")))?;
        tx.pragma_update(None, "user_version", version)?;
        tx.commit()?;
    }

    Ok(())
}

fn backup_before_migration(conn: &Connection, db_path: &Path, from: i64) -> Result<()> {
    let Some(dir) = db_path.parent() else {
        return Ok(());
    };
    let backup_dir = dir.join("backups");
    std::fs::create_dir_all(&backup_dir)?;

    let dest_path = backup_dir.join(format!("pre-migration-v{from}.db"));
    let mut dest = Connection::open(&dest_path)?;
    let backup = rusqlite::backup::Backup::new(conn, &mut dest)?;
    backup.run_to_completion(64, std::time::Duration::from_millis(0), None)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// 空库应能一路迁到最新，且能重复调用不出错（幂等）
    #[test]
    fn migrates_from_empty_and_is_idempotent() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::pragma::configure(&mut conn).unwrap();

        run(&mut conn, Path::new(":memory:")).unwrap();
        let v: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, MIGRATIONS.len() as i64);

        // 再跑一次不应有任何变化
        run(&mut conn, Path::new(":memory:")).unwrap();
        let v2: i64 = conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))
            .unwrap();
        assert_eq!(v, v2);
    }

    /// 库版本比程序新时必须明确报错，而不是继续用旧 schema 操作
    #[test]
    fn rejects_newer_database() {
        let mut conn = Connection::open_in_memory().unwrap();
        conn.pragma_update(None, "user_version", 999i64).unwrap();

        let err = run(&mut conn, Path::new(":memory:")).unwrap_err();
        assert!(matches!(err, AppError::DbTooNew { found: 999, .. }));
    }

    /// FTS5 必须可用 —— rusqlite 的 bundled 特性应该已经把它编进来了
    #[test]
    fn fts5_is_available() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::pragma::configure(&mut conn).unwrap();
        run(&mut conn, Path::new(":memory:")).unwrap();

        conn.execute(
            "INSERT INTO note (id, title, content_md, content_tokens, created_at, updated_at)
             VALUES ('n1', '测试', '正文', '测试 正文', 0, 0)",
            [],
        )
        .unwrap();

        let hits: i64 = conn
            .query_row(
                "SELECT count(*) FROM note_fts WHERE note_fts MATCH '正文'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(hits, 1, "FTS5 触发器没把行同步进索引");
    }

    /// 外键约束必须真的生效（它是连接级的，容易漏设）
    #[test]
    fn foreign_keys_enforced() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::pragma::configure(&mut conn).unwrap();
        run(&mut conn, Path::new(":memory:")).unwrap();

        let r = conn.execute(
            "INSERT INTO key_result (id, goal_id, title, target_value, created_at, updated_at)
             VALUES ('k1', 'nonexistent-goal', 't', 1.0, 0, 0)",
            [],
        );
        assert!(r.is_err(), "指向不存在的 goal 竟然插入成功了");
    }

    #[test]
    fn migrates_legacy_action_group_into_markdown() {
        let mut conn = Connection::open_in_memory().unwrap();
        crate::db::pragma::configure(&mut conn).unwrap();
        conn.execute_batch(MIGRATIONS[0]).unwrap();
        conn.execute_batch(MIGRATIONS[1]).unwrap();
        conn.pragma_update(None, "user_version", 2).unwrap();
        conn.execute(
            "INSERT INTO note (id,title,content_md,content_tokens,action_title,created_at,updated_at)
             VALUES ('n1','旧笔记','正文','正文','下阶段行动',0,0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO task (id,title,status,sort_key,created_at,updated_at)
             VALUES ('t1','可编辑任务','done','a0',0,0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO link (id,src_type,src_id,dst_type,dst_id,kind,sort_key,created_at)
             VALUES ('l1','note','n1','task','t1','action','a0',0)",
            [],
        )
        .unwrap();

        conn.execute_batch(MIGRATIONS[2]).unwrap();

        let (markdown, action_title): (String, Option<String>) = conn
            .query_row(
                "SELECT content_md, action_title FROM note WHERE id='n1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert!(markdown.contains("## 下阶段行动"));
        assert!(markdown.contains("- [x] 可编辑任务"));
        assert!(action_title.is_none());
        assert_eq!(
            conn.query_row("SELECT count(*) FROM task", [], |row| row.get::<_, i64>(0))
                .unwrap(),
            0
        );
    }
}
