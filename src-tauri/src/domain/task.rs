use rusqlite::{params, Connection, Row};

use crate::db::now_ms;
use crate::domain::{activity, model::Task};
use crate::error::{AppError, Result};

pub fn from_row(r: &Row) -> rusqlite::Result<Task> {
    Ok(Task {
        id: r.get("id")?,
        title: r.get("title")?,
        status: r.get("status")?,
        meta: r.get("meta")?,
        priority: r.get("priority")?,
        due_date: r.get("due_date")?,
        time_label: r.get("time_label")?,
        category: r.get("category")?,
        goal_id: r.get("goal_id")?,
        sort_key: r.get("sort_key")?,
        completed_at: r.get("completed_at")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

/// 列名一律用 `t.` 限定，表固定别名为 t ——
/// 和 link 表 JOIN 时两边都有 id / sort_key / created_at，不限定会 ambiguous。
const SELECT: &str = "SELECT t.id, t.title, t.status, t.meta, t.priority, t.due_date,
                             t.time_label, t.category, t.goal_id, t.sort_key,
                             t.completed_at, t.created_at, t.updated_at
                      FROM task t";

/// 取某个宿主（笔记 / 目标）挂着的行动项，按 link.sort_key 排。
///
/// 行动项不是 markdown 的 `- [ ]`，是独立的 task 实体，
/// 通过 link 表（kind='action'）挂到宿主文档上。
pub fn for_host(conn: &Connection, host_type: &str, host_id: &str) -> Result<Vec<Task>> {
    let sql = format!(
        "{SELECT}
         JOIN link l ON l.dst_id = t.id AND l.dst_type = 'task'
         WHERE l.src_type = ?1 AND l.src_id = ?2 AND l.kind = 'action'
           AND t.deleted_at IS NULL
         ORDER BY l.sort_key"
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![host_type, host_id], from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// 某一天的任务（日历用）
pub fn for_date(conn: &Connection, date: &str) -> Result<Vec<Task>> {
    let sql =
        format!("{SELECT} WHERE t.due_date = ?1 AND t.deleted_at IS NULL ORDER BY t.sort_key");
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![date], from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// 切换完成状态。
///
/// 无论完成还是重开都往 activity 里写一条 —— 复盘要靠它还原时间线。
pub fn toggle(conn: &Connection, id: &str) -> Result<Task> {
    let tx = conn.unchecked_transaction()?;
    let status: String = tx
        .query_row(
            "SELECT status FROM task WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
            |r| r.get(0),
        )
        .map_err(|_| AppError::NotFound(format!("task {id}")))?;

    let now = now_ms();
    let done = status == "done";
    let (next_status, completed_at) = if done {
        ("todo", None)
    } else {
        ("done", Some(now))
    };

    tx.execute(
        "UPDATE task SET status = ?1, completed_at = ?2, updated_at = ?3 WHERE id = ?4",
        params![next_status, completed_at, now, id],
    )?;

    activity::log(
        &tx,
        "task",
        id,
        if done { "reopened" } else { "completed" },
        None,
    )?;

    let sql = format!("{SELECT} WHERE t.id = ?1");
    let task = tx.query_row(&sql, params![id], from_row)?;
    tx.commit()?;
    Ok(task)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_support::{seed_task, test_conn};

    #[test]
    fn toggle_flips_status_and_stamps_completion() {
        let conn = test_conn();
        seed_task(&conn, "t1", "写单测", "todo");

        let t = toggle(&conn, "t1").unwrap();
        assert_eq!(t.status, "done");
        assert!(t.completed_at.is_some(), "完成时没记 completed_at");

        let t = toggle(&conn, "t1").unwrap();
        assert_eq!(t.status, "todo");
        assert!(t.completed_at.is_none(), "重开后 completed_at 应清空");
    }

    /// 反复完成/重开，activity 里必须留下每一次 —— 这是复盘能算准的前提
    #[test]
    fn toggle_writes_full_history_to_activity() {
        let conn = test_conn();
        seed_task(&conn, "t1", "写单测", "todo");

        toggle(&conn, "t1").unwrap();
        toggle(&conn, "t1").unwrap();
        toggle(&conn, "t1").unwrap();

        let actions: Vec<String> = conn
            .prepare("SELECT action FROM activity WHERE entity_id='t1' ORDER BY id")
            .unwrap()
            .query_map([], |r| r.get(0))
            .unwrap()
            .collect::<rusqlite::Result<Vec<_>>>()
            .unwrap();
        assert_eq!(actions, vec!["completed", "reopened", "completed"]);
    }

    #[test]
    fn toggle_unknown_id_is_not_found() {
        let conn = test_conn();
        assert!(matches!(toggle(&conn, "nope"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn for_host_returns_tasks_in_link_order() {
        let conn = test_conn();
        seed_task(&conn, "t1", "第一", "todo");
        seed_task(&conn, "t2", "第二", "todo");
        seed_task(&conn, "t3", "第三", "todo");

        // 故意乱序插入，验证是按 sort_key 而不是插入顺序返回
        for (tid, sk) in [("t3", "a2"), ("t1", "a0"), ("t2", "a1")] {
            conn.execute(
                "INSERT INTO link (id, src_type, src_id, dst_type, dst_id, kind, sort_key, created_at)
                 VALUES (?1, 'note', 'n1', 'task', ?2, 'action', ?3, 0)",
                params![format!("l-{tid}"), tid, sk],
            )
            .unwrap();
        }

        let tasks = for_host(&conn, "note", "n1").unwrap();
        let titles: Vec<&str> = tasks.iter().map(|t| t.title.as_str()).collect();
        assert_eq!(titles, vec!["第一", "第二", "第三"]);
    }

    #[test]
    fn for_host_excludes_soft_deleted() {
        let conn = test_conn();
        seed_task(&conn, "t1", "还在", "todo");
        seed_task(&conn, "t2", "已删", "todo");
        conn.execute("UPDATE task SET deleted_at = 1 WHERE id = 't2'", [])
            .unwrap();

        for (tid, sk) in [("t1", "a0"), ("t2", "a1")] {
            conn.execute(
                "INSERT INTO link (id, src_type, src_id, dst_type, dst_id, kind, sort_key, created_at)
                 VALUES (?1, 'note', 'n1', 'task', ?2, 'action', ?3, 0)",
                params![format!("l-{tid}"), tid, sk],
            )
            .unwrap();
        }

        let tasks = for_host(&conn, "note", "n1").unwrap();
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].title, "还在");
    }
}
