use chrono::{Datelike, NaiveDate, Weekday};
use rusqlite::{params, Connection, OptionalExtension};

use crate::db::{new_id, now_ms};
use crate::domain::model::{ActionGroup, DayDoc, Goal};
use crate::domain::task;
use crate::error::{AppError, Result};

/* ============================================================
目标：一个周期一篇。

「本周目标」不再是 period_start 最新的那条，而是**今天所在那一周**的那条 ——
日历里选到哪一天，就看那一天所在周期的目标。没写过的周期返回一篇空文档，
第一次保存时才落库；所以周期的键（horizon + period_start）由前端算好传进来，
这里只校验它确实是周期起点，免得同一周被两个不同的键各存一份。
============================================================ */

/// period_start 必须真的是周期起点：周一 / 1 号 / 1 月 1 日
fn validate_period_start(horizon: &str, period_start: &str) -> Result<()> {
    let date = NaiveDate::parse_from_str(period_start, "%Y-%m-%d")
        .map_err(|_| AppError::Invalid(format!("日期格式应为 YYYY-MM-DD，收到: {period_start}")))?;
    let ok = match horizon {
        "week" => date.weekday() == Weekday::Mon,
        "month" => date.day() == 1,
        "year" => date.day() == 1 && date.month() == 1,
        _ => return Err(AppError::Invalid(format!("未知的时间尺度: {horizon}"))),
    };
    if ok {
        Ok(())
    } else {
        Err(AppError::Invalid(format!(
            "{period_start} 不是 {horizon} 周期的起点"
        )))
    }
}

fn read_goal(conn: &Connection, horizon: &str, period_start: &str) -> Result<Option<Goal>> {
    let row = conn
        .query_row(
            "SELECT id, horizon, title, period_start, content_md,
                    action_title, created_at, updated_at
             FROM goal
             WHERE horizon = ?1 AND period_start = ?2 AND deleted_at IS NULL",
            params![horizon, period_start],
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
        .optional()?;

    let Some((mut goal, action_title)) = row else {
        return Ok(None);
    };
    if let Some(title) = action_title {
        let tasks = task::for_host(conn, "goal", &goal.id)?;
        if !tasks.is_empty() {
            goal.action_group = Some(ActionGroup { title, tasks });
        }
    }
    Ok(Some(goal))
}

/// 某个周期的目标。没写过就是一篇空文档，不落库。
pub fn get_for_period(conn: &Connection, horizon: &str, period_start: &str) -> Result<Goal> {
    validate_period_start(horizon, period_start)?;
    Ok(
        read_goal(conn, horizon, period_start)?.unwrap_or_else(|| Goal {
            id: String::new(),
            horizon: horizon.to_string(),
            title: String::new(),
            period_start: period_start.to_string(),
            content_md: String::new(),
            action_group: None,
            created_at: 0,
            updated_at: 0,
        }),
    )
}

/// 写某个周期的目标正文；第一次写的周期在这里建行。
/// 同一周期被软删过的话直接复活那一行 —— (horizon, period_start) 是唯一键。
pub fn save_for_period(
    conn: &Connection,
    horizon: &str,
    period_start: &str,
    content_md: &str,
) -> Result<Goal> {
    validate_period_start(horizon, period_start)?;
    let now = now_ms();
    conn.execute(
        "INSERT INTO goal (id, title, horizon, period_start, content_md, created_at, updated_at)
         VALUES (?1, '', ?2, ?3, ?4, ?5, ?5)
         ON CONFLICT(horizon, period_start) DO UPDATE SET
           content_md = excluded.content_md,
           updated_at = excluded.updated_at,
           deleted_at = NULL",
        params![new_id(), horizon, period_start, content_md, now],
    )?;
    read_goal(conn, horizon, period_start)?
        .ok_or_else(|| AppError::Internal(format!("goal {horizon}/{period_start} 写入后读不到")))
}

/* ============================================================
日历的一天：当天任务 + 一篇带标题的文档。

`carry_over`：请求的是「今天」而今天还没写过时，把之前最近写过的一天
（标题和正文）延续过来 —— 没改过的 TODO 自然滚到下一天。延续的内容不落库，
用户一编辑才以今天的身份保存；昨天那篇原样留在昨天。
只有今天延续。翻到昨天之前的空白日期，看到的就是空白。
============================================================ */

pub fn day_doc(conn: &Connection, date: &str, carry_over: bool) -> Result<DayDoc> {
    let tasks = task::for_date(conn, date)?;

    let own = conn
        .query_row(
            "SELECT title, note_md, updated_at FROM day_doc WHERE date = ?1",
            params![date],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, i64>(2)?,
                ))
            },
        )
        .optional()?;

    if let Some((title, note_md, updated_at)) = own {
        return Ok(DayDoc {
            date: date.to_string(),
            title,
            tasks,
            note_md,
            updated_at,
            carried_from: None,
        });
    }

    let previous = if carry_over {
        conn.query_row(
            "SELECT date, title, note_md, updated_at FROM day_doc
             WHERE date < ?1 AND (note_md != '' OR title != '')
             ORDER BY date DESC
             LIMIT 1",
            params![date],
            |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, String>(1)?,
                    r.get::<_, String>(2)?,
                    r.get::<_, i64>(3)?,
                ))
            },
        )
        .optional()?
    } else {
        None
    };

    Ok(match previous {
        Some((from, title, note_md, updated_at)) => DayDoc {
            date: date.to_string(),
            title,
            tasks,
            note_md,
            updated_at,
            carried_from: Some(from),
        },
        None => DayDoc {
            date: date.to_string(),
            title: String::new(),
            tasks,
            note_md: String::new(),
            updated_at: now_ms(),
            carried_from: None,
        },
    })
}

pub fn save_day_doc(conn: &Connection, date: &str, title: &str, note_md: &str) -> Result<DayDoc> {
    let now = now_ms();
    conn.execute(
        "INSERT INTO day_doc (date, title, note_md, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)
         ON CONFLICT(date) DO UPDATE SET
           title = excluded.title,
           note_md = excluded.note_md,
           updated_at = excluded.updated_at",
        params![date, title, note_md, now],
    )?;
    day_doc(conn, date, false)
}

/// 日历上需要标小圆点的日期：有任务或写过东西的那些天。
pub fn marked_dates(conn: &Connection, from: &str, to: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT d FROM (
           SELECT due_date AS d FROM task
             WHERE due_date IS NOT NULL AND deleted_at IS NULL
           UNION
           SELECT date AS d FROM day_doc WHERE note_md != '' OR title != ''
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
    fn goal_is_looked_up_by_its_own_period() {
        let conn = test_conn();
        seed_goal(&conn, "g-old", "week", "2026-08-17", "上周目标");
        seed_goal(&conn, "g-new", "week", "2026-08-24", "本周目标");
        seed_goal(&conn, "g-month", "month", "2026-08-01", "八月目标");

        assert_eq!(
            get_for_period(&conn, "week", "2026-08-17").unwrap().id,
            "g-old"
        );
        assert_eq!(
            get_for_period(&conn, "week", "2026-08-24").unwrap().id,
            "g-new"
        );
        assert_eq!(
            get_for_period(&conn, "month", "2026-08-01").unwrap().id,
            "g-month"
        );
    }

    /// 没写过的周期不是 NotFound，是一篇空文档 —— 界面上直接就是空白编辑器
    #[test]
    fn unwritten_period_is_an_empty_document() {
        let conn = test_conn();
        let g = get_for_period(&conn, "year", "2027-01-01").unwrap();
        assert_eq!(g.id, "");
        assert_eq!(g.content_md, "");
        assert_eq!(g.period_start, "2027-01-01");
        assert_eq!(g.updated_at, 0);
    }

    #[test]
    fn period_start_must_be_a_real_period_start() {
        let conn = test_conn();
        // 2026-08-25 是周二
        assert!(matches!(
            get_for_period(&conn, "week", "2026-08-25"),
            Err(AppError::Invalid(_))
        ));
        assert!(matches!(
            get_for_period(&conn, "month", "2026-08-02"),
            Err(AppError::Invalid(_))
        ));
        assert!(matches!(
            get_for_period(&conn, "year", "2026-02-01"),
            Err(AppError::Invalid(_))
        ));
        assert!(matches!(
            get_for_period(&conn, "decade", "2026-01-01"),
            Err(AppError::Invalid(_))
        ));
    }

    #[test]
    fn first_save_creates_the_period_and_later_saves_update_it() {
        let conn = test_conn();

        let first = save_for_period(&conn, "week", "2026-08-24", "# 本周").unwrap();
        assert!(!first.id.is_empty());
        assert_eq!(first.content_md, "# 本周");

        let second = save_for_period(&conn, "week", "2026-08-24", "# 本周\n\n改了").unwrap();
        assert_eq!(second.id, first.id, "同一周期不该建第二行");
        assert_eq!(second.content_md, "# 本周\n\n改了");
        assert!(second.updated_at >= first.updated_at);

        let n: i64 = conn
            .query_row("SELECT count(*) FROM goal", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1);
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

        let g = get_for_period(&conn, "week", "2026-08-24").unwrap();
        let ag = g.action_group.expect("行动项分组丢了");
        assert_eq!(ag.title, "本周重点");
        assert_eq!(ag.tasks.len(), 1);
    }

    /// 没有备注、没有任务的日期也要能打开，返回空文档而不是报错
    #[test]
    fn day_doc_for_empty_day_is_ok() {
        let conn = test_conn();
        let d = day_doc(&conn, "2026-08-30", false).unwrap();
        assert_eq!(d.date, "2026-08-30");
        assert!(d.tasks.is_empty());
        assert_eq!(d.note_md, "");
        assert_eq!(d.title, "");
        assert!(d.carried_from.is_none());
    }

    /// 今天还没写：延续之前最近写过的一天，但不落库
    #[test]
    fn today_carries_over_from_the_latest_written_day() {
        let conn = test_conn();
        save_day_doc(&conn, "2026-08-27", "周四的 TODO", "- [ ] 跑步").unwrap();
        save_day_doc(&conn, "2026-08-25", "更早的", "旧").unwrap();

        let today = day_doc(&conn, "2026-08-29", true).unwrap();
        assert_eq!(today.date, "2026-08-29");
        assert_eq!(today.title, "周四的 TODO");
        assert_eq!(today.note_md, "- [ ] 跑步");
        assert_eq!(today.carried_from.as_deref(), Some("2026-08-27"));

        // 延续不等于写入：翻回去看 8/28 还是空的，8/29 也没有自己的行
        assert!(day_doc(&conn, "2026-08-28", false)
            .unwrap()
            .carried_from
            .is_none());
        let rows: i64 = conn
            .query_row("SELECT count(*) FROM day_doc", [], |r| r.get(0))
            .unwrap();
        assert_eq!(rows, 2);
    }

    /// 一旦今天自己写过了，就以今天为准，不再延续
    #[test]
    fn own_content_wins_over_carry_over() {
        let conn = test_conn();
        save_day_doc(&conn, "2026-08-27", "旧标题", "旧正文").unwrap();
        save_day_doc(&conn, "2026-08-29", "今天", "新正文").unwrap();

        let today = day_doc(&conn, "2026-08-29", true).unwrap();
        assert_eq!(today.title, "今天");
        assert_eq!(today.note_md, "新正文");
        assert!(today.carried_from.is_none());
        // 昨天原样还在
        assert_eq!(day_doc(&conn, "2026-08-27", false).unwrap().title, "旧标题");
    }

    /// 只有「今天」延续；不带 carry_over 的普通日期永远只看自己
    #[test]
    fn past_dates_never_carry_over() {
        let conn = test_conn();
        save_day_doc(&conn, "2026-08-27", "周四", "内容").unwrap();
        let d = day_doc(&conn, "2026-08-28", false).unwrap();
        assert_eq!(d.note_md, "");
        assert!(d.carried_from.is_none());
    }

    #[test]
    fn marked_dates_union_tasks_and_notes() {
        let conn = test_conn();
        seed_task(&conn, "t1", "有截止日的任务", "todo");
        conn.execute("UPDATE task SET due_date='2026-08-12' WHERE id='t1'", [])
            .unwrap();
        conn.execute(
            "INSERT INTO day_doc (date, title, note_md, created_at, updated_at)
             VALUES ('2026-08-20','','写了点东西',0,0),
                    ('2026-08-22','只有标题','',0,0),
                    ('2026-08-25','','',0,0)",
            [],
        )
        .unwrap();

        let d = marked_dates(&conn, "2026-08-01", "2026-08-31").unwrap();
        assert_eq!(
            d,
            vec!["2026-08-12", "2026-08-20", "2026-08-22"],
            "空文档的日期不该被标记"
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
    fn saves_and_clears_day_markdown() {
        let conn = test_conn();

        let saved = save_day_doc(&conn, "2026-08-30", "", "## 备注\n\n第一次写入").unwrap();
        assert_eq!(saved.note_md, "## 备注\n\n第一次写入");
        assert_eq!(
            marked_dates(&conn, "2026-08-01", "2026-08-31").unwrap(),
            vec!["2026-08-30"]
        );

        save_day_doc(&conn, "2026-08-30", "", "").unwrap();
        assert!(marked_dates(&conn, "2026-08-01", "2026-08-31")
            .unwrap()
            .is_empty());
    }

    #[test]
    fn day_title_round_trips() {
        let conn = test_conn();
        let saved = save_day_doc(&conn, "2026-08-30", "周日的安排", "正文").unwrap();
        assert_eq!(saved.title, "周日的安排");
        assert_eq!(
            day_doc(&conn, "2026-08-30", false).unwrap().title,
            "周日的安排"
        );
    }
}
