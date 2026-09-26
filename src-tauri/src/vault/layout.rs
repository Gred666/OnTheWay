/* ============================================================
仓库文件夹的约定：什么路径是什么文档、文档该放在哪。

    笔记/秋季项目复盘.md          笔记（笔记/ 下任意深度，以及仓库里其它不认识的位置）
    归档/第一版信息架构草稿.md      归档的笔记
    日记/2026/2026-09-26.md       某一天（今日TODO 就是今天这一篇）
    目标/2026/2026-W39.md          周目标；2026-09.md 月目标；2026.md 年目标
    附件/                          图片等，正文里用相对路径引用
    .ontheway/                     应用自己的东西（回收站、行为日志、仓库标记）

路径在程序里一律是正斜杠分隔的相对路径字符串，落到磁盘时再按组件拼。
============================================================ */

use chrono::{Datelike, NaiveDate, Weekday};

use crate::error::{AppError, Result};

pub const NOTES_DIR: &str = "笔记";
pub const ARCHIVE_DIR: &str = "归档";
pub const DAYS_DIR: &str = "日记";
pub const GOALS_DIR: &str = "目标";
pub const TRASH_DIR: &str = ".ontheway/trash";
pub const ACTIVITY_DIR: &str = ".ontheway/activity";
pub const VAULT_MARKER: &str = ".ontheway/vault.json";

/// 新笔记 / 空标题的占位，和前端 NEW_NOTE_TITLE 一致
pub const UNTITLED: &str = "无标题笔记";

/// 一个 .md 文件按它的位置是哪种文档
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Slot {
    Note { archived: bool },
    Day(String),
    Goal { horizon: &'static str, period_start: String },
}

pub fn classify(rel: &str) -> Slot {
    let top = rel.split('/').next().unwrap_or("");
    let stem = stem_of(rel);
    match top {
        ARCHIVE_DIR => Slot::Note { archived: true },
        DAYS_DIR if rel.contains('/') => match parse_date(stem) {
            Some(_) => Slot::Day(stem.to_string()),
            None => Slot::Note { archived: false },
        },
        GOALS_DIR if rel.contains('/') => match goal_from_stem(stem) {
            Some((horizon, period_start)) => Slot::Goal {
                horizon,
                period_start,
            },
            None => Slot::Note { archived: false },
        },
        _ => Slot::Note { archived: false },
    }
}

/// 文件名去掉目录和 .md
pub fn stem_of(rel: &str) -> &str {
    let name = rel.rsplit('/').next().unwrap_or(rel);
    match name.len().checked_sub(3) {
        Some(cut) if name.is_char_boundary(cut) && name[cut..].eq_ignore_ascii_case(".md") => {
            &name[..cut]
        }
        _ => name,
    }
}

/// 相对路径的目录部分（没有目录时是空串）
pub fn dir_of(rel: &str) -> &str {
    rel.rsplit_once('/').map_or("", |(dir, _)| dir)
}

pub fn join(dir: &str, name: &str) -> String {
    if dir.is_empty() {
        name.to_string()
    } else {
        format!("{dir}/{name}")
    }
}

fn parse_date(s: &str) -> Option<NaiveDate> {
    (s.len() == 10)
        .then(|| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .flatten()
}

pub fn day_path(date: &str) -> Result<String> {
    let parsed = parse_date(date)
        .ok_or_else(|| AppError::Invalid(format!("日期应为 YYYY-MM-DD，收到: {date}")))?;
    Ok(format!("{DAYS_DIR}/{}/{date}.md", parsed.year()))
}

/// period_start 必须真的是周期起点：周一 / 1 号 / 1 月 1 日
pub fn validate_period_start(horizon: &str, period_start: &str) -> Result<NaiveDate> {
    let date = parse_date(period_start).ok_or_else(|| {
        AppError::Invalid(format!("日期格式应为 YYYY-MM-DD，收到: {period_start}"))
    })?;
    let ok = match horizon {
        "week" => date.weekday() == Weekday::Mon,
        "month" => date.day() == 1,
        "year" => date.day() == 1 && date.month() == 1,
        _ => return Err(AppError::Invalid(format!("未知的时间尺度: {horizon}"))),
    };
    if ok {
        Ok(date)
    } else {
        Err(AppError::Invalid(format!(
            "{period_start} 不是 {horizon} 周期的起点"
        )))
    }
}

/// 周目标按 ISO 周命名（2026-W39），放在 ISO 周所属年份的文件夹里
pub fn goal_path(horizon: &str, period_start: &str) -> Result<String> {
    let date = validate_period_start(horizon, period_start)?;
    Ok(match horizon {
        "week" => {
            let week = date.iso_week();
            format!(
                "{GOALS_DIR}/{}/{}-W{:02}.md",
                week.year(),
                week.year(),
                week.week()
            )
        }
        "month" => format!(
            "{GOALS_DIR}/{}/{}-{:02}.md",
            date.year(),
            date.year(),
            date.month()
        ),
        _ => format!("{GOALS_DIR}/{}/{}.md", date.year(), date.year()),
    })
}

/// `2026-W39` / `2026-09` / `2026` → (尺度, 周期起点)
pub fn goal_from_stem(stem: &str) -> Option<(&'static str, String)> {
    let digits = |s: &str| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit());
    if stem.len() == 4 && digits(stem) {
        let year: i32 = stem.parse().ok()?;
        let date = NaiveDate::from_ymd_opt(year, 1, 1)?;
        return Some(("year", date.format("%Y-%m-%d").to_string()));
    }
    let (year, rest) = stem.split_once('-')?;
    if year.len() != 4 || !digits(year) {
        return None;
    }
    let year: i32 = year.parse().ok()?;
    if let Some(week) = rest.strip_prefix('W') {
        if week.len() != 2 || !digits(week) {
            return None;
        }
        let date = NaiveDate::from_isoywd_opt(year, week.parse().ok()?, Weekday::Mon)?;
        return Some(("week", date.format("%Y-%m-%d").to_string()));
    }
    if rest.len() == 2 && digits(rest) {
        let date = NaiveDate::from_ymd_opt(year, rest.parse().ok()?, 1)?;
        return Some(("month", date.format("%Y-%m-%d").to_string()));
    }
    None
}

const CN_MONTH: [&str; 12] = [
    "一月", "二月", "三月", "四月", "五月", "六月", "七月", "八月", "九月", "十月", "十一月",
    "十二月",
];

/// 和前端 lib/date.ts 的 goalTitle 一样：「第 39 周目标」「九月目标」「2026 年目标」
pub fn goal_title(horizon: &str, period_start: &str) -> String {
    let Some(date) = parse_date(period_start) else {
        return String::new();
    };
    match horizon {
        "week" => format!("第 {} 周目标", date.iso_week().week()),
        "month" => format!("{}目标", CN_MONTH[date.month0() as usize]),
        _ => format!("{} 年目标", date.year()),
    }
}

/// 文件名最多这么多个字符。中文一个字 3 字节，80 个字 240 字节，
/// 在 macOS / Linux 255 字节的文件名上限以内；Windows 的整条路径也不容易超 260。
const MAX_STEM_CHARS: usize = 80;

/// 标题 → 文件名（不含 .md）。
///
/// 文件系统不允许的字符换成外观相近的全角字符（`:` → `：`），标题本身的样子
/// 还在；截断、去掉结尾的点和空格（Windows 会悄悄吃掉它们）、避开设备名。
/// 文件名和标题不一样时，完整标题记在属性块的 title 里。
pub fn file_stem_for_title(title: &str) -> String {
    let mut stem: String = title
        .trim()
        .chars()
        .map(|c| match c {
            '/' => '／',
            '\\' => '＼',
            ':' => '：',
            '*' => '＊',
            '?' => '？',
            '"' => '＂',
            '<' => '＜',
            '>' => '＞',
            '|' => '｜',
            c if c.is_control() => ' ',
            c => c,
        })
        .take(MAX_STEM_CHARS)
        .collect();
    // 开头的点会让文件变成「隐藏文件」，扫描时被跳过
    stem = stem.trim_start_matches('.').to_string();
    stem = stem.trim_end_matches(['.', ' ']).to_string();
    if stem.is_empty() {
        return UNTITLED.to_string();
    }
    let base = stem.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(base.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((base.starts_with("COM") || base.starts_with("LPT"))
            && base.len() == 4
            && base.as_bytes()[3].is_ascii_digit());
    if reserved {
        stem.push('_');
    }
    stem
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_by_location() {
        assert_eq!(classify("笔记/秋季项目复盘.md"), Slot::Note { archived: false });
        assert_eq!(classify("笔记/工作/周报.md"), Slot::Note { archived: false });
        assert_eq!(classify("随手记.md"), Slot::Note { archived: false });
        assert_eq!(classify("归档/旧版路线图.md"), Slot::Note { archived: true });
        assert_eq!(
            classify("日记/2026/2026-09-26.md"),
            Slot::Day("2026-09-26".into())
        );
        // 日记文件夹里不是日期的文件就是普通笔记，不会消失
        assert_eq!(classify("日记/2026/杂记.md"), Slot::Note { archived: false });
        assert_eq!(
            classify("目标/2026/2026-W39.md"),
            Slot::Goal {
                horizon: "week",
                period_start: "2026-09-21".into()
            }
        );
        assert_eq!(
            classify("目标/2026/2026-09.md"),
            Slot::Goal {
                horizon: "month",
                period_start: "2026-09-01".into()
            }
        );
        assert_eq!(
            classify("目标/2026.md"),
            Slot::Goal {
                horizon: "year",
                period_start: "2026-01-01".into()
            }
        );
        assert_eq!(classify("目标/2026/2026-W60.md"), Slot::Note { archived: false });
    }

    #[test]
    fn goal_paths_round_trip_including_iso_week_years() {
        for (horizon, start) in [
            ("week", "2026-09-21"),
            ("week", "2026-12-28"),
            ("week", "2027-01-04"),
            ("week", "2024-12-30"),
            ("month", "2026-09-01"),
            ("year", "2026-01-01"),
        ] {
            let path = goal_path(horizon, start).unwrap();
            assert_eq!(
                classify(&path),
                Slot::Goal {
                    horizon,
                    period_start: start.into()
                },
                "{path}"
            );
        }
        // 2024-12-30 是 2025 年第 1 周的周一
        assert_eq!(goal_path("week", "2024-12-30").unwrap(), "目标/2025/2025-W01.md");
        assert!(goal_path("week", "2026-09-22").is_err());
    }

    #[test]
    fn goal_titles_match_the_frontend() {
        assert_eq!(goal_title("week", "2026-09-21"), "第 39 周目标");
        assert_eq!(goal_title("month", "2026-09-01"), "九月目标");
        assert_eq!(goal_title("year", "2026-01-01"), "2026 年目标");
    }

    #[test]
    fn file_names_are_safe_on_every_platform() {
        assert_eq!(file_stem_for_title("周报: 第 3 期?"), "周报： 第 3 期？");
        assert_eq!(file_stem_for_title("a/b\\c"), "a／b＼c");
        assert_eq!(file_stem_for_title("  ...隐藏. "), "隐藏");
        assert_eq!(file_stem_for_title("   "), UNTITLED);
        assert_eq!(file_stem_for_title("con"), "con_");
        assert_eq!(file_stem_for_title("LPT1.txt"), "LPT1.txt_");
        assert_eq!(file_stem_for_title("COMMENT"), "COMMENT");
        let long = "秋".repeat(200);
        assert_eq!(file_stem_for_title(&long).chars().count(), MAX_STEM_CHARS);
    }

    #[test]
    fn stems_and_dirs() {
        assert_eq!(stem_of("笔记/a.b.MD"), "a.b");
        assert_eq!(dir_of("笔记/工作/周报.md"), "笔记/工作");
        assert_eq!(dir_of("周报.md"), "");
        assert_eq!(join("", "a.md"), "a.md");
    }
}
