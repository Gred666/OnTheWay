/* ============================================================
新仓库的示例内容（文案与 Prototype/ 原型图一致）。

只在第一次建仓库、而且文件夹里一篇 .md 都没有时写一次；用户删光了也不会再塞回来
（仓库标记 .ontheway/vault.json 在）。

和以前 SQL 版的种子相比多了一处：日历「当日安排」现在来自正文里带日期的任务，
所以本周目标里有一段「日程」，秋季项目复盘的最后一项带着截止日。
============================================================ */

use std::path::Path;

use chrono::{Datelike, Local, TimeZone};

use super::frontmatter::{self, FrontMatter};
use super::{fsio, layout};
use crate::error::Result;

/// 固定的「现在」让示例数据的相对时间稳定：2026-08-29 09:12
fn base_ms() -> i64 {
    Local
        .with_ymd_and_hms(2026, 8, 29, 9, 12, 0)
        .single()
        .map(|dt| dt.timestamp_millis())
        .unwrap_or_else(crate::db::now_ms)
}

/// 基准日偏移 days 天的本地 hh:mm
fn at(days: i64, hh: u32, mm: u32) -> i64 {
    let date = chrono::DateTime::from_timestamp_millis(base_ms() + days * 86_400_000)
        .unwrap_or_default()
        .with_timezone(&Local)
        .date_naive();
    Local
        .with_ymd_and_hms(date.year(), date.month(), date.day(), hh, mm, 0)
        .single()
        .map(|dt| dt.timestamp_millis())
        .unwrap_or_else(base_ms)
}

fn file(root: &Path, rel: &str, meta: &FrontMatter, body: &str, updated: i64) -> Result<()> {
    let path = fsio::abs(root, rel);
    fsio::write_atomic(&path, &frontmatter::render(meta, body))?;
    fsio::set_mtime(&path, updated)
}

fn note(root: &Path, title: &str, body: &str, pinned: bool, created: i64, updated: i64) -> Result<()> {
    let meta = FrontMatter {
        id: Some(crate::db::new_id()),
        created: Some(created),
        pinned,
        ..FrontMatter::default()
    };
    file(root, &format!("{}/{title}.md", layout::NOTES_DIR), &meta, body, updated)
}

fn archived(
    root: &Path,
    title: &str,
    body: &str,
    category: &str,
    archived_at: i64,
    created: i64,
) -> Result<()> {
    let meta = FrontMatter {
        id: Some(crate::db::new_id()),
        created: Some(created),
        archived: Some(archived_at),
        category: Some(category.into()),
        ..FrontMatter::default()
    };
    file(
        root,
        &format!("{}/{title}.md", layout::ARCHIVE_DIR),
        &meta,
        body,
        archived_at,
    )
}

pub fn write(root: &Path) -> Result<()> {
    /* ---------------- 笔记 ---------------- */
    note(
        root,
        "秋季项目复盘",
        "这一次，我们没有把“做得更多”当作衡量标准。真正重要的是：团队是否更清楚为什么而做，用户是否更自然地抵达价值。\n\n\
         > [!核心判断]\n\
         > 最有价值的进展，并不是交付数量，而是产品语言终于开始统一。\n\n\
         从访谈记录回看，用户对入口的理解成本明显下降；与此同时，跨职能协作的决策链路也从平均三天缩短到一天以内。这说明我们需要继续保护清晰度，而不是急于增加新的功能层。\n\n\
         ## 下阶段行动\n\n\
         - [x] 整理访谈中的高频语言\n\
         - [x] 建立每周一次的决策回看\n\
         - [ ] 完成编辑器专注模式原型 @2026-09-04",
        false,
        at(-1, 11, 59),
        at(0, 9, 12),
    )?;

    note(
        root,
        "京都书店清单",
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
        at(-21, 20, 10),
        at(-5, 21, 30),
    )?;

    note(
        root,
        "周末采购",
        "周六上午一次解决，别分两趟。\n\n\
         - 燕麦奶 ×2\n\
         - 灯泡（书房那盏，暖光 4000K）\n\
         - 咖啡豆（浅烘，200g）\n\
         - 洗衣液\n\n\
         顺路取快递。",
        false,
        at(-2, 19, 0),
        at(-1, 10, 15),
    )?;

    note(
        root,
        "产品灵感碎片",
        "> [!一句话]\n\
         > 好的工具，应该把思绪还给人。\n\n\
         工具做得越勤快，人就越懒得想。真正好的工具应该在你需要它的时候出现，剩下的时间安静地待着。\n\n\
         ## 几个碎片\n\n\
         - 空状态不是「什么都没有」，是「可以从这里开始」。\n\
         - 动画的意义是解释变化，不是展示能力。变化解释完了，动画就该结束。\n\
         - 一个功能如果需要说明书，多半是入口放错了地方。\n\
         - 搜索框应该记住你上次没搜完的那个词。",
        false,
        at(-9, 23, 40),
        at(-3, 8, 5),
    )?;

    note(
        root,
        "8月阅读摘录",
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
        at(-25, 22, 0),
        at(-4, 22, 45),
    )?;

    /* ---------------- 归档 ---------------- */
    archived(
        root,
        "第一版信息架构草稿",
        "最初的结构围绕“记录、整理、回顾”三个阶段展开，希望让笔记、备忘和目标自然地出现在同一条时间线上。\n\n\
         后续测试发现，用户更需要明确的入口和更少的层级。因此这套方案被新的工作区结构替代，但其中关于快速记录和长期回顾的思路仍然值得保留。\n\n\
         > [!当时的结论]\n\
         > 好的结构不是展示所有能力，而是让下一步足够明确。",
        "工作笔记",
        at(-11, 16, 20),
        at(-1, 11, 59),
    )?;

    archived(
        root,
        "搬家准备清单",
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
        root,
        "春季阅读摘录",
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
        root,
        "旧版产品路线图",
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
    let none = FrontMatter::default();
    file(
        root,
        &layout::goal_path("week", "2026-08-24")?,
        &none,
        "这一周，把序笺推进到可以真正交给用户测试的状态；同时保护精力，不让忙碌挤掉思考和运动。\n\n\
         ## 记录\n\n\
         本周暂时不增加新的功能范围。所有决定先回到用户是否能更快开始记录，以及编辑过程是否足够安静。\n\n\
         ## 本周重点\n\n\
         - [ ] 完成编辑器稳定性验证\n\
         - [ ] 整理首次启动体验\n\
         - [ ] 完成日历交互说明\n\
         - [ ] 安排两次力量训练\n\n\
         ## 日程\n\n\
         带日期的任务会出现在那一天的日历里。\n\n\
         - [ ] 完成日历交互说明与空状态 @2026-08-29 上午 #产品\n\
         - [x] 回顾第 35 周目标 @2026-08-29 16:00 #GOAL\n\
         - [ ] 力量训练 @2026-08-29 18:30 #健康",
        at(0, 9, 12),
    )?;
    file(
        root,
        &layout::goal_path("month", "2026-08-01")?,
        &none,
        "八月只做一件事：让序笺从「能用」走到「愿意每天打开」。其余需求一律推迟到九月再评估。\n\n\
         ## 判断标准\n\n\
         不是功能数量，是连续使用天数。如果我自己都做不到连续用满两周，就说明还不够。\n\n\
         > [!这个月的取舍]\n\
         > 宁可少一个模块，也不要多一层入口。",
        at(-6, 10, 0),
    )?;
    file(
        root,
        &layout::goal_path("year", "2026-01-01")?,
        &none,
        "今年想把注意力收回到三件事上：做完一个自己会长期用的工具、恢复稳定的运动节奏、重新开始认真读书。\n\n\
         ## 做完一个工具\n\n\
         不是做出来，是做完 —— 发布、有人用、根据反馈迭代过至少三轮。\n\n\
         ## 身体\n\n\
         全年力量训练不少于 100 次。不追求强度，追求不断。\n\n\
         ## 读书\n\n\
         每月至少一本读完并写摘录。写不出摘录说明没读进去。\n\n\
         > [!年初写下的]\n\
         > 少做几件事，然后把它们做到有反馈为止。",
        at(-20, 15, 0),
    )?;

    /* ---------------- 日历 / 今日TODO ---------------- */
    let titled = FrontMatter {
        title: Some("完成专注模式原型".into()),
        ..FrontMatter::default()
    };
    file(
        root,
        &layout::day_path("2026-08-29")?,
        &titled,
        "为编辑器补充一个真正安静的专注模式：隐藏非必要入口，只保留正文、字数和退出方式。\n\n\
         ## 检查项\n\n\
         - [x] 梳理进入与退出路径\n\
         - [ ] 实现快捷键与状态保持\n\
         - [ ] 完成真实内容下的可用性走查\n\n\
         今天只安排最重要的三件事。给深度工作留下完整时间，不把未完成的事项带入下一天。",
        at(0, 20, 14),
    )?;
    for date in ["2026-08-06", "2026-08-12", "2026-08-18", "2026-08-21"] {
        file(
            root,
            &layout::day_path(date)?,
            &none,
            "（这一天有记录）",
            at(-20, 12, 0),
        )?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::vault::Vault;

    #[test]
    fn seeds_a_browsable_vault() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path()).unwrap();
        let vault = Vault::open_in_memory(dir.path());

        let notes = vault.note_list_full(false).unwrap();
        assert_eq!(notes.len(), 5);
        assert_eq!(notes[0].title, "京都书店清单", "置顶的排在最前");
        assert_eq!(vault.note_list_full(true).unwrap().len(), 4);

        let day = vault.day("2026-08-29", false).unwrap();
        assert_eq!(day.title, "完成专注模式原型");
        // 当日安排来自本周目标里带日期的任务，按一天里的先后
        let tasks: Vec<_> = day.tasks.iter().map(|task| task.title.as_str()).collect();
        assert_eq!(tasks, vec!["完成日历交互说明与空状态", "回顾第 35 周目标", "力量训练"]);
        assert_eq!(day.tasks[1].meta.as_deref(), Some("GOAL · 16:00 · 第 35 周目标"));
        assert_eq!(day.tasks[1].status, "done");

        // 笔记里的截止日也进日历
        let later = vault.day("2026-09-04", false).unwrap();
        assert_eq!(later.tasks[0].title, "完成编辑器专注模式原型");
        assert_eq!(later.tasks[0].meta.as_deref(), Some("秋季项目复盘"));

        assert!(vault.goal("year", "2026-01-01").unwrap().content_md.contains("三件事"));
        assert_eq!(
            vault.marked_dates("2026-08-01", "2026-09-30").unwrap(),
            vec![
                "2026-08-06",
                "2026-08-12",
                "2026-08-18",
                "2026-08-21",
                "2026-08-29",
                "2026-09-04"
            ]
        );
        assert!(!vault.search("京都", 10).unwrap().hits.is_empty());
    }
}
