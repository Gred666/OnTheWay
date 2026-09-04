use rusqlite::{params, Connection, OptionalExtension};

use crate::db::now_ms;
use crate::domain::model::{ActionGroup, DayDoc, Goal};
use crate::domain::task;
use crate::error::{AppError, Result};

/// 取某个时间尺度下最新的一个目标。
///
/// 按 period_start 倒序 —— 「本周目标」就是 period_start 最新的那条 week 目标，
/// 不需要前端算「今天属于哪一周」。
pub fn latest(conn: &Connection, horizon: &str) -> Result<Goal> {
    let row = conn
        .query_row(
            "SELECT id, horizon, title, period_start, content_md,
                    action_title, created_at, updated_at
             FROM goal
             WHERE horizon = ?1 AND deleted_at IS NULL
             ORDER BY period_start DESC
             LIMIT 1",
            params![horizon],
            |r| {
                Ok((
                    Goal {
                        id: r.get("id")?,
                        horizon: r.get("horizon")?,
                        title: r.get("title")?,
                        period_start: r.get("period_start")?,
                        content_md: r.get("content_md")?,
                        action_group: None,
                        created_at: r.get("created_at")?,
                        updated_at: r.get("updated_at")?,
                    },
                    r.get::<_, Option<String>>("action_title")?,
                ))
            },
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("goal horizon={horizon}")))?;

    let (mut goal, action_title) = row;
    if let Some(title) = action_title {
        let tasks = task::for_host(conn, "goal", &goal.id)?;
        if !tasks.is_empty() {
            goal.action_group = Some(ActionGroup { title, tasks });
        }
    }
    Ok(goal)
}

/// 更新目标正文并返回完整聚合，保证前端拿到一致的时间戳与任务分组。
pub fn save(conn: &Connection, id: &str, content_md: &str) -> Result<Goal> {
    let changed = conn.execute(
        "UPDATE goal SET content_md=?1, updated_at=?2 WHERE id=?3 AND deleted_at IS NULL",
        params![content_md, now_ms(), id],
    )?;
    if changed == 0 {
        return Err(AppError::NotFound(format!("goal id={id}")));
    }
    let horizon: String =
        conn.query_row("SELECT horizon FROM goal WHERE id=?1", params![id], |row| {
            row.get(0)
        })?;
    latest(conn, &horizon)
}

/// 日历某一天：当天任务 + 备注
pub fn day_doc(conn: &Connection, date: &str) -> Result<DayDoc> {
    let (note_md, updated_at) = conn
        .query_row(
            "SELECT note_md, updated_at FROM day_doc WHERE date = ?1",
            params![date],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, i64>(1)?)),
        )
        .optional()?
        .unwrap_or_else(|| (String::new(), now_ms()));

    Ok(DayDoc {
        date: date.to_string(),
        tasks: task::for_date(conn, date)?,
        note_md,
        updated_at,
    })
}

pub fn save_day_doc(conn: &Connection, date: &str, note_md: &str) -> Result<DayDoc> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO day_doc (date, note_md, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?3)
         ON CONFLICT(date) DO UPDATE SET note_md=excluded.note_md, updated_at=excluded.updated_at",
        params![date, note_md, now],
    )?;
    day_doc(conn, date)
}

/// 日历上需要标小圆点的日期：有任务或有备注的那些天。
pub fn marked_dates(conn: &Connection, from: &str, to: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT d FROM (
           SELECT due_date AS d FROM task
             WHERE due_date IS NOT NULL AND deleted_at IS NULL
           UNION
           SELECT date AS d FROM day_doc WHERE note_md != ''
         )
         WHERE d BETWEEN ?1 AND ?2
         ORDER BY d",
    )?;
    let rows = stmt.query_map(params![from, to], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_support::{seed_goal, seed_task, test_conn};

    #[test]
    fn latest_picks_most_recent_period() {
        let conn = test_conn();
        seed_goal(&conn, "g-old", "week", "2026-08-17", "上周目标");
        seed_goal(&conn, "g-new", "week", "2026-08-24", "本周目标");
        seed_goal(&conn, "g-month", "month", "2026-08-01", "八月目标");

        assert_eq!(latest(&conn, "week").unwrap().title, "本周目标");
        assert_eq!(latest(&conn, "month").unwrap().title, "八月目标");
    }

    #[test]
    fn latest_missing_horizon_is_not_found() {
        let conn = test_conn();
        assert!(matches!(latest(&conn, "year"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn goal_carries_its_action_group() {
        let conn = test_conn();
        seed_goal(&conn, "g1", "week", "2026-08-24", "本周目标");
        conn.execute("UPDATE goal SET action_title='本周重点' WHERE id='g1'", [])
            .unwrap();
        seed_task(&conn, "t1", "完成原型", "todo");
        conn.execute(
            "INSERT INTO link (id, src_type, src_id, dst_type, dst_id, kind, sort_key, created_at)
             VALUES ('l1','goal','g1','task','t1','action','a0',0)",
            [],
        )
        .unwrap();

        let g = latest(&conn, "week").unwrap();
        let ag = g.action_group.expect("行动项分组丢了");
        assert_eq!(ag.title, "本周重点");
        assert_eq!(ag.tasks.len(), 1);
    }

    /// 没有备注、没有任务的日期也要能打开，返回空文档而不是报错
    #[test]
    fn day_doc_for_empty_day_is_ok() {
        let conn = test_conn();
        let d = day_doc(&conn, "2026-08-30").unwrap();
        assert_eq!(d.date, "2026-08-30");
        assert!(d.tasks.is_empty());
        assert_eq!(d.note_md, "");
    }

    #[test]
    fn marked_dates_union_tasks_and_notes() {
        let conn = test_conn();
        seed_task(&conn, "t1", "有截止日的任务", "todo");
        conn.execute("UPDATE task SET due_date='2026-08-12' WHERE id='t1'", [])
            .unwrap();
        conn.execute(
            "INSERT INTO day_doc (date, note_md, created_at, updated_at)
             VALUES ('2026-08-20','写了点东西',0,0), ('2026-08-25','',0,0)",
            [],
        )
        .unwrap();

        let d = marked_dates(&conn, "2026-08-01", "2026-08-31").unwrap();
        assert_eq!(
            d,
            vec!["2026-08-12", "2026-08-20"],
            "空备注的日期不该被标记"
        );
    }

    #[test]
    fn marked_dates_respects_range() {
        let conn = test_conn();
        conn.execute(
            "INSERT INTO day_doc (date, note_md, created_at, updated_at)
             VALUES ('2026-07-15','a',0,0), ('2026-08-15','b',0,0), ('2026-09-15','c',0,0)",
            [],
        )
        .unwrap();

        let d = marked_dates(&conn, "2026-08-01", "2026-08-31").unwrap();
        assert_eq!(d, vec!["2026-08-15"]);
    }

    #[test]
    fn saves_goal_as_one_markdown_document() {
        let conn = test_conn();
        seed_goal(&conn, "g1", "week", "2026-08-24", "旧正文");

        let saved = save(&conn, "g1", "# 新正文\n\n包含记录").unwrap();

        assert_eq!(saved.content_md, "# 新正文\n\n包含记录");
        assert!(saved.updated_at > 0);
    }

    #[test]
    fn saves_and_clears_day_markdown() {
        let conn = test_conn();

        let saved = save_day_doc(&conn, "2026-08-30", "## 备注\n\n第一次写入").unwrap();
        assert_eq!(saved.note_md, "## 备注\n\n第一次写入");
        assert_eq!(
            marked_dates(&conn, "2026-08-01", "2026-08-31").unwrap(),
            vec!["2026-08-30"]
        );

        save_day_doc(&conn, "2026-08-30", "").unwrap();
        assert!(marked_dates(&conn, "2026-08-01", "2026-08-31")
            .unwrap()
            .is_empty());
    }
}
