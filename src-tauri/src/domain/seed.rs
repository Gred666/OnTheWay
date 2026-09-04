use rusqlite::{params, Connection};

use crate::domain::search;
use crate::error::Result;

/* ============================================================
首次启动的示例内容。
文案与 Prototype/ 原型图一致。

只在 note 表为空时执行一次；用户删光了也不会再塞回来
（靠 setting 里的 seeded 标记）。
============================================================ */

const SEEDED_KEY: &str = "seeded_v1";

pub fn ensure(conn: &mut Connection) -> Result<()> {
    let already: bool = conn
        .query_row(
            "SELECT count(*) FROM setting WHERE key = ?1",
            params![SEEDED_KEY],
            |r| r.get::<_, i64>(0),
        )
        .map(|n| n > 0)?;
    if already {
        return Ok(());
    }

    let tx = conn.transaction()?;
    insert_all(&tx)?;
    tx.execute(
        "INSERT INTO setting (key, value) VALUES (?1, 'true')",
        params![SEEDED_KEY],
    )?;
    tx.commit()?;
    Ok(())
}

/// 用固定的「现在」让示例数据的相对时间稳定：2026-08-29 09:12
fn base_ms() -> i64 {
    use chrono::TimeZone;
    chrono::Local
        .with_ymd_and_hms(2026, 8, 29, 9, 12, 0)
        .single()
        .map(|dt| dt.timestamp_millis())
        .unwrap_or_else(crate::db::now_ms)
}

/// 基准日偏移 days 天的本地 hh:mm
fn at(days: i64, hh: u32, mm: u32) -> i64 {
    use chrono::{Datelike, TimeZone};
    let date = chrono::DateTime::from_timestamp_millis(base_ms() + days * 86_400_000)
        .unwrap_or_default()
        .with_timezone(&chrono::Local)
        .date_naive();
    chrono::Local
        .with_ymd_and_hms(date.year(), date.month(), date.day(), hh, mm, 0)
        .single()
        .map(|dt| dt.timestamp_millis())
        // 夏令时空洞里这个本地时刻不存在，退回基准时刻即可（只是示例数据）
        .unwrap_or_else(base_ms)
}

fn note(
    tx: &Connection,
    id: &str,
    title: &str,
    icon: &str,
    body: &str,
    pinned: bool,
    action_title: Option<&str>,
    created: i64,
    updated: i64,
) -> Result<()> {
    let tokens = search::tokenize_for_index(&format!("{title} {body}"));
    tx.execute(
        "INSERT INTO note (id, title, content_md, content_tokens, excerpt, icon,
                           word_count, is_pinned, action_title, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11)",
        params![
            id,
            title,
            body,
            tokens,
            search::make_excerpt(body, 60),
            icon,
            search::count_words(body),
            pinned as i64,
            action_title,
            created,
            updated
        ],
    )?;
    Ok(())
}

fn archived(
    tx: &Connection,
    id: &str,
    title: &str,
    icon: &str,
    body: &str,
    category: &str,
    archived_at: i64,
    created: i64,
) -> Result<()> {
    let tokens = search::tokenize_for_index(&format!("{title} {body}"));
    tx.execute(
        "INSERT INTO note (id, title, content_md, content_tokens, excerpt, icon, word_count,
                           is_archived, archive_category, archived_at, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,1,?8,?9,?10,?9)",
        params![
            id,
            title,
            body,
            tokens,
            search::make_excerpt(body, 60),
            icon,
            search::count_words(body),
            category,
            archived_at,
            created
        ],
    )?;
    Ok(())
}

#[allow(clippy::too_many_arguments)]
fn task(
    tx: &Connection,
    id: &str,
    title: &str,
    status: &str,
    meta: Option<&str>,
    due_date: Option<&str>,
    time_label: Option<&str>,
    category: Option<&str>,
    completed_at: Option<i64>,
    created: i64,
) -> Result<()> {
    tx.execute(
        "INSERT INTO task (id, title, status, meta, due_date, time_label, category,
                           completed_at, sort_key, created_at, updated_at)
         VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'a0',?9,?9)",
        params![
            id,
            title,
            status,
            meta,
            due_date,
            time_label,
            category,
            completed_at,
            created
        ],
    )?;
    Ok(())
}

/// 把 task 挂到宿主文档上。sort_key 决定显示顺序。
fn link_action(
    tx: &Connection,
    host_type: &str,
    host_id: &str,
    task_id: &str,
    i: usize,
) -> Result<()> {
    tx.execute(
        "INSERT INTO link (id, src_type, src_id, dst_type, dst_id, kind, sort_key, created_at)
         VALUES (?1,?2,?3,'task',?4,'action',?5,?6)",
        params![
            format!("lk-{host_id}-{task_id}"),
            host_type,
            host_id,
            task_id,
            format!("a{i}"),
            base_ms()
        ],
    )?;
    Ok(())
}

fn insert_all(tx: &Connection) -> Result<()> {
    /* ---------------- 笔记 ---------------- */
    note(
        tx,
        "n-autumn",
        "秋季项目复盘",
        "file",
        "这一次，我们没有把“做得更多”当作衡量标准。真正重要的是：团队是否更清楚为什么而做，用户是否更自然地抵达价值。\n\n\
         > [!核心判断]\n\
         > 最有价值的进展，并不是交付数量，而是产品语言终于开始统一。\n\n\
         从访谈记录回看，用户对入口的理解成本明显下降；与此同时，跨职能协作的决策链路也从平均三天缩短到一天以内。这说明我们需要继续保护清晰度，而不是急于增加新的功能层。\n\n\
         ## 下阶段行动\n\n\
         - [x] 整理访谈中的高频语言\n\
         - [x] 建立每周一次的决策回看\n\
         - [ ] 完成编辑器专注模式原型",
        false,
        None,
        at(-1, 11, 59),
        at(0, 9, 12),
    )?;

    note(
        tx,
        "n-kyoto",
        "京都书店清单",
        "pin-place",
        "那些安静、可以坐一下午的地方。不追求书目齐全，只在意光线、座位和店主选书的性格。\n\n\
         ## 一乗寺\n\n\
         惠文社一乗寺店。选书带有明确偏好，杂货区值得慢慢看。下午三点后阳光会斜进来。\n\n\
         ## 河原町\n\n\
         誠光社。店面很小，但每一本都是店主挑的。适合待四十分钟，不适合久坐。\n\n\
         > [!记一笔]\n\
         > 好的书店不提供选择，它提供一种看待选择的方式。\n\n\
         ## 待去\n\n\
         - 三月書房（寺町通）\n\
         - ホホホ座（浄土寺）\n\
         - レティシア書房（御幸町）",
        true,
        None,
        at(-21, 20, 10),
        at(-5, 21, 30),
    )?;

    note(
        tx,
        "n-grocery",
        "周末采购",
        "circle-check",
        "周六上午一次解决，别分两趟。\n\n\
         - 燕麦奶 ×2\n\
         - 灯泡（书房那盏，暖光 4000K）\n\
         - 咖啡豆（浅烘，200g）\n\
         - 洗衣液\n\n\
         顺路取快递。",
        false,
        None,
        at(-2, 19, 0),
        at(-1, 10, 15),
    )?;

    note(
        tx,
        "n-spark",
        "产品灵感碎片",
        "sparkle",
        "> [!一句话]\n\
         > 好的工具，应该把思绪还给人。\n\n\
         工具做得越勤快，人就越懒得想。真正好的工具应该在你需要它的时候出现，剩下的时间安静地待着。\n\n\
         ## 几个碎片\n\n\
         - 空状态不是「什么都没有」，是「可以从这里开始」。\n\
         - 动画的意义是解释变化，不是展示能力。变化解释完了，动画就该结束。\n\
         - 一个功能如果需要说明书，多半是入口放错了地方。\n\
         - 搜索框应该记住你上次没搜完的那个词。",
        false,
        None,
        at(-9, 23, 40),
        at(-3, 8, 5),
    )?;

    note(
        tx,
        "n-reading",
        "8月阅读摘录",
        "bookmark",
        "关于注意力、日常秩序与长期主义。这个月读得杂，但有几条串起来了。\n\n\
         ## 注意力\n\n\
         注意力不是资源，是地形。你没法「省着用」，只能决定让它流向哪里。所以问题不是「今天专注了几小时」，而是「今天的环境让我自然地看向了什么」。\n\n\
         ## 秩序\n\n\
         日常秩序的价值不在效率，在于减少决策。每天早上不用想「先做什么」，本身就是一种休息。\n\n\
         > [!这个月最有用的一句]\n\
         > 长期主义不是把时间拉长，而是把反馈缩短。\n\n\
         ## 待读\n\n\
         - 关于城市步行尺度的那本，一直没开始\n\
         - 找一本讲档案整理的书",
        false,
        None,
        at(-25, 22, 0),
        at(-4, 22, 45),
    )?;

    // 今日 TODO 也是一篇笔记 —— 「一切皆文档」在数据层同样成立
    note(
        tx,
        "n-today",
        "完成专注模式原型",
        "target",
        "为编辑器补充一个真正安静的专注模式：隐藏非必要入口，只保留正文、字数和退出方式。\n\n\
         ## 检查项\n\n\
         - [x] 梳理进入与退出路径\n\
         - [ ] 实现快捷键与状态保持\n\
         - [ ] 完成真实内容下的可用性走查",
        false,
        None,
        at(-3, 14, 0),
        at(0, 20, 14),
    )?;

    /* ---------------- 归档 ---------------- */
    archived(
        tx,
        "a-ia",
        "第一版信息架构草稿",
        "file",
        "最初的结构围绕“记录、整理、回顾”三个阶段展开，希望让笔记、备忘和目标自然地出现在同一条时间线上。\n\n\
         后续测试发现，用户更需要明确的入口和更少的层级。因此这套方案被新的工作区结构替代，但其中关于快速记录和长期回顾的思路仍然值得保留。\n\n\
         > [!当时的结论]\n\
         > 好的结构不是展示所有能力，而是让下一步足够明确。",
        "工作笔记",
        at(-11, 16, 20),
        at(-1, 11, 59),
    )?;

    archived(
        tx,
        "a-moving",
        "搬家准备清单",
        "circle-check",
        "已经搬完了，留着当下次的模板。\n\n\
         ## 提前两周\n\n\
         - 宽带预约移机（要提前，师傅排期慢）\n\
         - 联系搬家公司，确认是否走电梯\n\
         - 纸箱 20 个 + 气泡膜\n\n\
         ## 提前三天\n\n\
         - 地址变更：银行、快递、订阅\n\
         - 冰箱清空\n\n\
         > [!教训]\n\
         > 书最重，最后打包，最先搬。别问为什么。",
        "TODO",
        at(-17, 9, 0),
        at(-40, 20, 0),
    )?;

    archived(
        tx,
        "a-spring",
        "春季阅读摘录",
        "bookmark",
        "关于注意力与日常秩序的摘录。和 8 月那份有重叠，但角度不同。\n\n\
         ## 三月\n\n\
         把「想做的事」和「该做的事」分成两张清单，是一种自欺。它们本来就在抢同一段时间。\n\n\
         ## 五月\n\n\
         > [!当时抄下来的]\n\
         > 秩序感来自可预期，不来自整齐。",
        "读书笔记",
        at(-30, 21, 15),
        at(-170, 21, 0),
    )?;

    archived(
        tx,
        "a-roadmap",
        "旧版产品路线图",
        "file",
        "已由新的季度计划替代。保留是因为里面对优先级的排序方式仍然成立。\n\n\
         ## 原计划\n\n\
         四个季度各压一个大特性，结果第二季度就发现节奏排不下——每个特性都比估计的长 40%。\n\n\
         ## 新计划\n\n\
         改成「一个主线 + 若干可随时中断的支线」。主线保证推进，支线用来填空隙。\n\n\
         > [!留下来的判断]\n\
         > 路线图的作用不是预测，是让人知道什么时候该说不。",
        "工作笔记",
        at(-44, 11, 30),
        at(-140, 10, 0),
    )?;

    /* ---------------- 目标 ---------------- */
    tx.execute(
        "INSERT INTO goal (id, title, horizon, period_start, content_md,
                           action_title, created_at, updated_at)
         VALUES ('g-week', '本周目标', 'week', '2026-08-24', ?1, NULL, ?2, ?3)",
        params![
            "这一周，把序笺推进到可以真正交给用户测试的状态；同时保护精力，不让忙碌挤掉思考和运动。\n\n## 记录\n\n本周暂时不增加新的功能范围。所有决定先回到用户是否能更快开始记录，以及编辑过程是否足够安静。\n\n## 本周重点\n\n- [ ] 完成编辑器稳定性验证\n- [ ] 整理首次启动体验\n- [ ] 完成日历交互说明\n- [ ] 安排两次力量训练",
            at(-5, 9, 0),
            at(0, 9, 12)
        ],
    )?;

    tx.execute(
        "INSERT INTO goal (id, title, horizon, period_start, content_md, created_at, updated_at)
         VALUES ('g-month', '八月目标', 'month', '2026-08-01', ?1, ?2, ?3)",
        params![
            "八月只做一件事：让序笺从「能用」走到「愿意每天打开」。其余需求一律推迟到九月再评估。\n\n\
             ## 判断标准\n\n\
             不是功能数量，是连续使用天数。如果我自己都做不到连续用满两周，就说明还不够。\n\n\
             > [!这个月的取舍]\n\
             > 宁可少一个模块，也不要多一层入口。",
            at(-28, 9, 0),
            at(-6, 10, 0)
        ],
    )?;

    tx.execute(
        "INSERT INTO goal (id, title, horizon, period_start, content_md, created_at, updated_at)
         VALUES ('g-year', '2026 年目标', 'year', '2026-01-01', ?1, ?2, ?3)",
        params![
            "今年想把注意力收回到三件事上：做完一个自己会长期用的工具、恢复稳定的运动节奏、重新开始认真读书。\n\n\
             ## 做完一个工具\n\n\
             不是做出来，是做完 —— 发布、有人用、根据反馈迭代过至少三轮。\n\n\
             ## 身体\n\n\
             全年力量训练不少于 100 次。不追求强度，追求不断。\n\n\
             ## 读书\n\n\
             每月至少一本读完并写摘录。写不出摘录说明没读进去。\n\n\
             > [!年初写下的]\n\
             > 少做几件事，然后把它们做到有反馈为止。",
            at(-240, 10, 0),
            at(-20, 15, 0)
        ],
    )?;

    /* ---------------- 任务 ---------------- */
    // 秋季项目复盘 → 下阶段行动
    task(
        tx,
        "t-autumn-1",
        "整理访谈中的高频语言",
        "done",
        Some("负责人 · 以安"),
        None,
        None,
        None,
        Some(at(-1, 15, 20)),
        at(-6, 10, 0),
    )?;
    task(
        tx,
        "t-autumn-2",
        "建立每周一次的决策回看",
        "done",
        Some("周一 10:00"),
        None,
        None,
        None,
        Some(at(-1, 17, 5)),
        at(-6, 10, 0),
    )?;
    task(
        tx,
        "t-autumn-3",
        "完成编辑器专注模式原型",
        "todo",
        Some("截止 9月4日"),
        Some("2026-09-04"),
        None,
        None,
        None,
        at(-6, 10, 0),
    )?;
    for (i, t) in ["t-autumn-1", "t-autumn-2", "t-autumn-3"]
        .iter()
        .enumerate()
    {
        link_action(tx, "note", "n-autumn", t, i)?;
    }

    // 今日 TODO → 检查项
    task(
        tx,
        "t-focus-1",
        "梳理进入与退出路径",
        "done",
        None,
        None,
        None,
        None,
        Some(at(0, 11, 40)),
        at(-3, 14, 0),
    )?;
    task(
        tx,
        "t-focus-2",
        "完成空状态和动效说明",
        "todo",
        None,
        None,
        None,
        None,
        None,
        at(-3, 14, 0),
    )?;
    task(
        tx,
        "t-focus-3",
        "邀请 3 位用户试用",
        "todo",
        None,
        None,
        None,
        None,
        None,
        at(-3, 14, 0),
    )?;
    for (i, t) in ["t-focus-1", "t-focus-2", "t-focus-3"].iter().enumerate() {
        link_action(tx, "note", "n-today", t, i)?;
    }

    // 本周目标 → 本周重点
    task(
        tx,
        "t-week-1",
        "完成序笺 1.0 核心原型",
        "todo",
        None,
        None,
        None,
        None,
        None,
        at(-4, 9, 0),
    )?;
    task(
        tx,
        "t-week-2",
        "完成 4 次深度工作",
        "done",
        None,
        None,
        None,
        None,
        Some(at(-1, 18, 0)),
        at(-4, 9, 0),
    )?;
    task(
        tx,
        "t-week-3",
        "完成两次力量训练",
        "todo",
        None,
        None,
        None,
        None,
        None,
        at(-4, 9, 0),
    )?;
    task(
        tx,
        "t-week-4",
        "周日完成一次周复盘",
        "todo",
        None,
        None,
        None,
        None,
        None,
        at(-4, 9, 0),
    )?;
    for (i, t) in ["t-week-1", "t-week-2", "t-week-3", "t-week-4"]
        .iter()
        .enumerate()
    {
        link_action(tx, "goal", "g-week", t, i)?;
    }

    // 这些任务已成为可编辑的 Markdown 清单，种子库不保留旧版双轨数据。
    tx.execute(
        "DELETE FROM link WHERE kind='action' AND src_type IN ('note','goal')",
        [],
    )?;
    tx.execute(
        "DELETE FROM task WHERE id LIKE 't-autumn-%' OR id LIKE 't-focus-%' OR id LIKE 't-week-%'",
        [],
    )?;

    // 日历 8月29日
    task(
        tx,
        "t-cal-1",
        "完成日历交互说明与空状态",
        "todo",
        Some("产品 · 上午"),
        Some("2026-08-29"),
        Some("上午"),
        Some("产品"),
        None,
        at(-2, 9, 0),
    )?;
    task(
        tx,
        "t-cal-2",
        "回顾第 35 周目标",
        "done",
        Some("/GOAL · 16:00"),
        Some("2026-08-29"),
        Some("16:00"),
        Some("/GOAL"),
        Some(at(0, 8, 40)),
        at(-2, 9, 0),
    )?;
    task(
        tx,
        "t-cal-3",
        "力量训练",
        "todo",
        Some("健康 · 18:30"),
        Some("2026-08-29"),
        Some("18:30"),
        Some("健康"),
        None,
        at(-2, 9, 0),
    )?;

    /* ---------------- 日历备注 ---------------- */
    tx.execute(
        "INSERT INTO day_doc (date, note_md, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
        params![
            "2026-08-29",
            "今天只安排最重要的三件事。给深度工作留下完整时间，不把未完成的事项带入下一天。",
            at(0, 9, 12)
        ],
    )?;

    // 日历上带小圆点的其余日期
    for d in ["2026-08-06", "2026-08-12", "2026-08-18", "2026-08-21"] {
        tx.execute(
            "INSERT INTO day_doc (date, note_md, created_at, updated_at) VALUES (?1, ?2, ?3, ?3)",
            params![d, "（这一天有记录）", at(-20, 12, 0)],
        )?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_support::test_conn;
    use crate::domain::{goal, note};

    fn seeded() -> Connection {
        let mut conn = test_conn();
        ensure(&mut conn).unwrap();
        conn
    }

    #[test]
    fn seeds_expected_content() {
        let conn = seeded();
        assert_eq!(note::list(&conn, false).unwrap().len(), 6, "笔记数量不对");
        assert_eq!(note::list(&conn, true).unwrap().len(), 4, "归档数量不对");
    }

    /// 反复调用不能重复插入 —— 每次启动都会调它
    #[test]
    fn is_idempotent() {
        let mut conn = seeded();
        ensure(&mut conn).unwrap();
        ensure(&mut conn).unwrap();
        assert_eq!(note::list(&conn, false).unwrap().len(), 6);
    }

    #[test]
    fn legacy_action_groups_are_plain_markdown() {
        let conn = seeded();

        let autumn = note::get(&conn, "n-autumn").unwrap();
        assert!(autumn.action_group.is_none());
        assert!(autumn.content_md.contains("## 下阶段行动"));
        assert!(autumn.content_md.contains("- [x] 整理访谈中的高频语言"));

        let week = goal::latest(&conn, "week").unwrap();
        assert!(week.action_group.is_none());
        assert!(week.content_md.contains("## 本周重点"));

        let legacy: i64 = conn
            .query_row(
                "SELECT count(*) FROM link WHERE kind='action' AND src_type IN ('note','goal')",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(legacy, 0, "种子库仍有旧行动项关联");
    }

    #[test]
    fn goal_has_single_markdown_body() {
        let conn = seeded();
        let g = goal::latest(&conn, "week").unwrap();
        assert!(g.content_md.contains("## 记录"), "GOAL 的「记录」段丢了");
    }

    #[test]
    fn calendar_day_is_populated() {
        let conn = seeded();
        let d = goal::day_doc(&conn, "2026-08-29").unwrap();
        assert_eq!(d.tasks.len(), 3);
        assert!(d.note_md.contains("三件事"));

        let marked = goal::marked_dates(&conn, "2026-08-01", "2026-08-31").unwrap();
        assert!(marked.contains(&"2026-08-29".to_string()));
        assert!(marked.contains(&"2026-08-12".to_string()));
    }

    /// 示例内容必须是能被搜到的 —— 顺带验证真实数据下的中文分词
    #[test]
    fn seeded_content_is_searchable() {
        let conn = seeded();
        for (q, expect) in [
            ("京都", "京都书店清单"),
            ("复盘", "秋季项目复盘"),
            ("咖啡", "周末采购"),
        ] {
            let r = note::search_notes(&conn, q, 10).unwrap();
            assert!(
                r.hits.iter().any(|h| h.title == expect),
                "搜「{q}」没找到「{expect}」，命中: {:?}",
                r.hits.iter().map(|h| &h.title).collect::<Vec<_>>()
            );
        }
    }
}
