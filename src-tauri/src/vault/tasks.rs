/* ============================================================
正文里带日期的任务 —— 日历「当日安排」的唯一来源。

任务只有一个来源：Markdown 的 `- [ ]`。写上日期，它就会出现在那一天的日历里：

    - [ ] 完成编辑器专注模式原型 @2026-09-04
    - [ ] 力量训练 @2026-08-29 18:30 #健康
    - [x] 回顾第 35 周目标 📅 2026-08-29 下午 #GOAL

- 日期：`@YYYY-MM-DD`，或 Obsidian Tasks 的写法 `📅 YYYY-MM-DD`
- 时间（可选，紧跟在日期后面）：`HH:MM`，或 上午 / 中午 / 下午 / 晚上 / 全天
- 分类（可选）：第一个 `#标签`（纯数字的 `#1` 不算）
- 围栏代码块里的不算

在日历里勾选，改的是原文件里的那一行。
============================================================ */

use chrono::NaiveDate;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScheduledTask {
    /// 正文里的第几行（从 0 开始，不含属性块）
    pub line: usize,
    /// 那一行的原文，勾选前用它核对行号还对不对
    pub raw: String,
    pub title: String,
    pub done: bool,
    pub due_date: String,
    pub time_label: Option<String>,
    pub category: Option<String>,
}

const TIME_WORDS: [&str; 5] = ["上午", "中午", "下午", "晚上", "全天"];

pub fn scan(body: &str) -> Vec<ScheduledTask> {
    let mut out = Vec::new();
    let mut fence: Option<char> = None;
    for (line, raw) in body.split('\n').enumerate() {
        let trimmed = raw.trim_start();
        let indent = raw.len() - trimmed.len();
        if indent <= 3 {
            let marker = trimmed.chars().next().filter(|c| *c == '`' || *c == '~');
            if let Some(c) = marker {
                if trimmed.starts_with(&c.to_string().repeat(3)) {
                    match fence {
                        None => fence = Some(c),
                        Some(open) if open == c => fence = None,
                        _ => {}
                    }
                    continue;
                }
            }
        }
        if fence.is_some() {
            continue;
        }
        if let Some(task) = parse_line(line, raw) {
            out.push(task);
        }
    }
    out
}

/// `- [ ] `、`* [x] `、`1. [ ] ` 之后的位置，以及勾选框里那个字符的字节位置
fn checkbox(raw: &str) -> Option<(usize, usize)> {
    let trimmed = raw.trim_start();
    let start = raw.len() - trimmed.len();
    let bytes = trimmed.as_bytes();
    let mut i = 0;
    if matches!(bytes.first(), Some(b'-' | b'*' | b'+')) {
        i = 1;
    } else {
        while i < bytes.len() && bytes[i].is_ascii_digit() {
            i += 1;
        }
        if i == 0 || i > 9 || !matches!(bytes.get(i), Some(b'.' | b')')) {
            return None;
        }
        i += 1;
    }
    if !matches!(bytes.get(i), Some(b' ' | b'\t')) {
        return None;
    }
    while matches!(bytes.get(i), Some(b' ' | b'\t')) {
        i += 1;
    }
    if bytes.get(i) != Some(&b'[')
        || !matches!(bytes.get(i + 1), Some(b' ' | b'x' | b'X'))
        || bytes.get(i + 2) != Some(&b']')
    {
        return None;
    }
    let after = i + 3;
    if !matches!(bytes.get(after), None | Some(b' ' | b'\t')) {
        return None;
    }
    Some((start + after, start + i + 1))
}

fn parse_line(line: usize, raw: &str) -> Option<ScheduledTask> {
    let (text_start, mark) = checkbox(raw)?;
    let done = raw.as_bytes()[mark] != b' ';
    let text = &raw[text_start..];

    let mut due_date = None;
    let mut time_label = None;
    let mut category = None;
    let mut words: Vec<&str> = Vec::new();

    let tokens: Vec<&str> = text.split_whitespace().collect();
    let mut index = 0;
    while index < tokens.len() {
        let token = tokens[index];
        index += 1;

        // 📅 和日期之间可以有空格
        let date = if let Some(rest) = token.strip_prefix('@') {
            Some(rest)
        } else if let Some(rest) = token.strip_prefix('📅') {
            if rest.is_empty() {
                let next = tokens.get(index).copied();
                if next.is_some() {
                    index += 1;
                }
                next
            } else {
                Some(rest)
            }
        } else {
            None
        };
        if let Some(date) = date.filter(|date| is_date(date)) {
            if due_date.is_none() {
                due_date = Some(date.to_string());
                if let Some(next) = tokens.get(index).filter(|next| is_time(next)) {
                    time_label = Some((*next).to_string());
                    index += 1;
                }
                continue;
            }
        }

        if let Some(tag) = token.strip_prefix('#') {
            // 和 Obsidian 一样，纯数字不算标签（`#1` 多半是编号）
            if !tag.contains('#') && tag.chars().any(|c| !c.is_ascii_digit()) {
                if category.is_none() {
                    category = Some(tag.to_string());
                }
                continue;
            }
        }
        words.push(token);
    }

    Some(ScheduledTask {
        line,
        raw: raw.to_string(),
        title: words.join(" "),
        done,
        due_date: due_date?,
        time_label,
        category,
    })
}

fn is_date(s: &str) -> bool {
    s.len() == 10 && NaiveDate::parse_from_str(s, "%Y-%m-%d").is_ok()
}

pub fn is_time(s: &str) -> bool {
    if TIME_WORDS.contains(&s) {
        return true;
    }
    let Some((hour, minute)) = s.split_once(':') else {
        return false;
    };
    let hour_ok = (1..=2).contains(&hour.len())
        && hour.parse::<u32>().is_ok_and(|hour| hour < 24);
    let minute_ok = minute.len() == 2 && minute.parse::<u32>().is_ok_and(|minute| minute < 60);
    hour_ok && minute_ok
}

/// 勾上 / 取消勾选这一行。不是任务行返回 None。
pub fn toggle_line(raw: &str) -> Option<String> {
    let (_, mark) = checkbox(raw)?;
    let next = if raw.as_bytes()[mark] == b' ' { "x" } else { " " };
    let mut out = String::with_capacity(raw.len());
    out.push_str(&raw[..mark]);
    out.push_str(next);
    out.push_str(&raw[mark + 1..]);
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn one(line: &str) -> Option<ScheduledTask> {
        scan(line).into_iter().next()
    }

    #[test]
    fn parses_date_time_and_tag() {
        let task = one("- [ ] 力量训练 @2026-08-29 18:30 #健康").unwrap();
        assert_eq!(task.title, "力量训练");
        assert!(!task.done);
        assert_eq!(task.due_date, "2026-08-29");
        assert_eq!(task.time_label.as_deref(), Some("18:30"));
        assert_eq!(task.category.as_deref(), Some("健康"));
    }

    #[test]
    fn accepts_obsidian_tasks_dates_and_word_times() {
        let task = one("  * [X] 回顾第 35 周目标 📅 2026-08-29 下午 #GOAL").unwrap();
        assert!(task.done);
        assert_eq!(task.title, "回顾第 35 周目标");
        assert_eq!(task.time_label.as_deref(), Some("下午"));
        assert_eq!(task.category.as_deref(), Some("GOAL"));

        let numbered = one("3. [ ] 交稿 📅2026-09-04").unwrap();
        assert_eq!(numbered.due_date, "2026-09-04");
        assert_eq!(numbered.title, "交稿");
    }

    #[test]
    fn tasks_without_a_real_date_are_not_scheduled() {
        assert!(one("- [ ] 没有日期的任务").is_none());
        assert!(one("- [ ] 邮件发到 a@2026-13-01").is_none());
        assert!(one("- 不是任务 @2026-09-01").is_none());
        assert!(one("- [ ]紧挨着 @2026-09-01").is_none());
        assert!(one("[ ] 没有列表符号 @2026-09-01").is_none());
    }

    #[test]
    fn keeps_words_that_only_look_like_tokens() {
        let task = one("- [ ] 讨论 C# 和 #1 问题 @2026-09-01 9:00").unwrap();
        assert_eq!(task.title, "讨论 C# 和 #1 问题");
        assert_eq!(task.category, None);
        assert_eq!(task.time_label.as_deref(), Some("9:00"));
    }

    #[test]
    fn skips_fenced_code_and_counts_lines() {
        let body = "开头\n\n```md\n- [ ] 示例 @2026-09-01\n```\n\n- [ ] 真的 @2026-09-02\n";
        let tasks = scan(body);
        assert_eq!(tasks.len(), 1);
        assert_eq!(tasks[0].title, "真的");
        assert_eq!(tasks[0].line, 6);
    }

    #[test]
    fn toggles_only_the_checkbox() {
        assert_eq!(
            toggle_line("  - [ ] 事情 [x] @2026-09-01").as_deref(),
            Some("  - [x] 事情 [x] @2026-09-01")
        );
        assert_eq!(toggle_line("1) [X] 完成").as_deref(), Some("1) [ ] 完成"));
        assert!(toggle_line("- 普通列表").is_none());
    }
}
