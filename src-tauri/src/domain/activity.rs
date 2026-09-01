use rusqlite::{params, Connection};

use crate::db::{local_date_of, now_ms};
use crate::error::Result;

/* ============================================================
   append-only 行为日志。

   复盘统计的唯一可信来源。不能从 task 表现状去统计 ——
   任务被重开、改期、删除之后历史就没了，
   「本周完成了几件、分别什么时候完成的」将永远算不准。

   写入后永不修改。
   ============================================================ */

pub fn log(
    conn: &Connection,
    entity_type: &str,
    entity_id: &str,
    action: &str,
    payload: Option<&str>,
) -> Result<()> {
    let at = now_ms();
    conn.execute(
        "INSERT INTO activity (at, local_date, entity_type, entity_id, action, payload)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![at, local_date_of(at), entity_type, entity_id, action, payload],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_support::test_conn;

    #[test]
    fn records_are_append_only_and_dated_locally() {
        let conn = test_conn();

        log(&conn, "task", "t1", "completed", None).unwrap();
        log(&conn, "task", "t1", "reopened", None).unwrap();
        log(&conn, "task", "t1", "completed", None).unwrap();

        // 三条都在，后写的不覆盖先写的
        let n: i64 = conn
            .query_row("SELECT count(*) FROM activity WHERE entity_id='t1'", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 3);

        // local_date 用本地时区，复盘按天聚合直接用它
        let d: String = conn
            .query_row("SELECT local_date FROM activity LIMIT 1", [], |r| r.get(0))
            .unwrap();
        assert_eq!(d, crate::db::today_local());
    }
}
