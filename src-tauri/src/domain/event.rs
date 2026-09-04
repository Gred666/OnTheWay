use chrono::{DateTime, LocalResult, NaiveDate, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz as ChronoTz;
use rrule::RRuleSet;

use crate::error::{AppError, Result};

/// 展开后的单次事件。`occurrence_at` 永远指向原始实例，供 override 定位；
/// `start_at` / `end_at` 是应用 override 后真正展示的时间。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Occurrence {
    pub occurrence_at: i64,
    pub start_at: i64,
    pub end_at: i64,
    pub title: String,
    pub is_overridden: bool,
}

#[derive(Debug, Clone)]
pub struct OccurrenceOverride {
    pub occurrence_at: i64,
    pub is_cancelled: bool,
    pub title: Option<String>,
    pub start_at: Option<i64>,
    pub end_at: Option<i64>,
}

/// 把一个本地墙上时间转换成 UTC 毫秒。
///
/// DST 回拨时同一个本地时间会对应两个瞬间，统一取较早的那个；DST 前跳造成
/// 的不存在时间则明确报错，避免静默把提醒放到错误的一小时。
pub fn local_to_utc_ms(local: &str, tz_name: &str) -> Result<i64> {
    let tz: ChronoTz = tz_name
        .parse()
        .map_err(|_| AppError::Invalid(format!("未知时区: {tz_name}")))?;
    let naive = NaiveDateTime::parse_from_str(local, "%Y-%m-%dT%H:%M:%S")
        .map_err(|e| AppError::Invalid(format!("本地时间格式错误: {e}")))?;

    match tz.from_local_datetime(&naive) {
        LocalResult::Single(dt) => Ok(dt.timestamp_millis()),
        LocalResult::Ambiguous(earlier, _) => Ok(earlier.timestamp_millis()),
        LocalResult::None => Err(AppError::Invalid(format!(
            "本地时间 {local} 在时区 {tz_name} 中不存在（DST 跳时）"
        ))),
    }
}

pub fn utc_ms_to_local(ms: i64, tz_name: &str) -> Result<DateTime<ChronoTz>> {
    let tz: ChronoTz = tz_name
        .parse()
        .map_err(|_| AppError::Invalid(format!("未知时区: {tz_name}")))?;
    let utc = DateTime::<Utc>::from_timestamp_millis(ms)
        .ok_or_else(|| AppError::Invalid(format!("时间戳超出范围: {ms}")))?;
    Ok(utc.with_timezone(&tz))
}

/// 全天事件只携带日历日期，不经过 UTC；切换显示时区也不能改变日期。
pub fn all_day_date(date: &str) -> Result<NaiveDate> {
    NaiveDate::parse_from_str(date, "%Y-%m-%d")
        .map_err(|e| AppError::Invalid(format!("全天事件日期格式错误: {e}")))
}

/// 在 Rust 侧展开 RFC 5545 RRULE，并在返回前应用 EXDATE 与单次 override。
///
/// `dtstart_line` 既可以是 UTC，也可以带 TZID，例如：
/// `DTSTART;TZID=America/New_York:20260301T090000`。
pub fn expand_rrule(
    dtstart_line: &str,
    rule: &str,
    duration_ms: i64,
    range_start: i64,
    range_end: i64,
    exdates: &[i64],
    overrides: &[OccurrenceOverride],
    title: &str,
    limit: u16,
) -> Result<Vec<Occurrence>> {
    if duration_ms < 0 || range_end < range_start {
        return Err(AppError::Invalid("事件时长或查询范围无效".into()));
    }

    let source = format!("{dtstart_line}\nRRULE:{rule}");
    let set = source
        .parse::<RRuleSet>()
        .map_err(|e| AppError::BadRrule(e.to_string()))?;
    let timezone = set.get_dt_start().timezone();
    let range_start_dt = DateTime::<Utc>::from_timestamp_millis(range_start)
        .ok_or_else(|| AppError::Invalid(format!("时间戳超出范围: {range_start}")))?
        .with_timezone(&timezone);
    let range_end_dt = DateTime::<Utc>::from_timestamp_millis(range_end)
        .ok_or_else(|| AppError::Invalid(format!("时间戳超出范围: {range_end}")))?
        .with_timezone(&timezone);

    let mut occurrences = Vec::new();
    // 先把迭代器约束到查询窗口，再应用数量上限。否则 DTSTART 很早时，
    // `all(limit)` 会在到达当前查询范围前就耗尽配额。
    for date in set
        .after(range_start_dt)
        .before(range_end_dt)
        .all(limit.max(1))
        .dates
    {
        let original = date.timestamp_millis();
        if original < range_start || original >= range_end || exdates.contains(&original) {
            continue;
        }

        if let Some(patch) = overrides.iter().find(|x| x.occurrence_at == original) {
            if patch.is_cancelled {
                continue;
            }
            let start = patch.start_at.unwrap_or(original);
            occurrences.push(Occurrence {
                occurrence_at: original,
                start_at: start,
                end_at: patch.end_at.unwrap_or(start + duration_ms),
                title: patch.title.clone().unwrap_or_else(|| title.to_string()),
                is_overridden: true,
            });
        } else {
            occurrences.push(Occurrence {
                occurrence_at: original,
                start_at: original,
                end_at: original + duration_ms,
                title: title.to_string(),
                is_overridden: false,
            });
        }
    }

    occurrences.sort_by_key(|x| x.start_at);
    Ok(occurrences)
}

#[cfg(test)]
mod tests {
    use chrono::{Datelike, Timelike};

    use super::*;

    fn utc_ms(s: &str) -> i64 {
        DateTime::parse_from_rfc3339(s).unwrap().timestamp_millis()
    }

    #[test]
    fn expands_across_year_boundary() {
        let out = expand_rrule(
            "DTSTART:20261231T090000Z",
            "FREQ=DAILY;COUNT=3",
            3_600_000,
            utc_ms("2026-12-01T00:00:00Z"),
            utc_ms("2027-02-01T00:00:00Z"),
            &[],
            &[],
            "跨年",
            20,
        )
        .unwrap();
        assert_eq!(out.len(), 3);
        assert_eq!(out[2].start_at, utc_ms("2027-01-02T09:00:00Z"));
    }

    #[test]
    fn distant_query_window_does_not_consume_result_limit() {
        let out = expand_rrule(
            "DTSTART:20200101T090000Z",
            "FREQ=DAILY",
            3_600_000,
            utc_ms("2026-08-29T00:00:00Z"),
            utc_ms("2026-09-02T00:00:00Z"),
            &[],
            &[],
            "长期重复",
            10,
        )
        .unwrap();
        assert_eq!(out.len(), 4);
        assert_eq!(out[0].start_at, utc_ms("2026-08-29T09:00:00Z"));
    }

    #[test]
    fn supports_monthly_bysetpos() {
        let out = expand_rrule(
            "DTSTART:20260130T090000Z",
            "FREQ=MONTHLY;COUNT=3;BYDAY=MO,TU,WE,TH,FR;BYSETPOS=-1",
            3_600_000,
            utc_ms("2026-01-01T00:00:00Z"),
            utc_ms("2026-05-01T00:00:00Z"),
            &[],
            &[],
            "月末工作日",
            20,
        )
        .unwrap();
        let days: Vec<u32> = out
            .iter()
            .map(|x| {
                DateTime::<Utc>::from_timestamp_millis(x.start_at)
                    .unwrap()
                    .day()
            })
            .collect();
        assert_eq!(days, vec![30, 27, 31]);
    }

    #[test]
    fn exdate_and_override_are_applied_together() {
        let second = utc_ms("2026-08-30T09:00:00Z");
        let third = utc_ms("2026-08-31T09:00:00Z");
        let moved = utc_ms("2026-08-31T11:00:00Z");
        let out = expand_rrule(
            "DTSTART:20260829T090000Z",
            "FREQ=DAILY;COUNT=3",
            3_600_000,
            utc_ms("2026-08-01T00:00:00Z"),
            utc_ms("2026-09-02T00:00:00Z"),
            &[second],
            &[OccurrenceOverride {
                occurrence_at: third,
                is_cancelled: false,
                title: Some("改期实例".into()),
                start_at: Some(moved),
                end_at: None,
            }],
            "每日事件",
            20,
        )
        .unwrap();
        assert_eq!(out.len(), 2);
        assert_eq!(out[1].occurrence_at, third);
        assert_eq!(out[1].start_at, moved);
        assert_eq!(out[1].title, "改期实例");
        assert!(out[1].is_overridden);
    }

    #[test]
    fn weekly_local_time_stays_fixed_across_dst() {
        let out = expand_rrule(
            "DTSTART;TZID=America/New_York:20260301T090000",
            "FREQ=WEEKLY;COUNT=3",
            3_600_000,
            utc_ms("2026-02-01T00:00:00Z"),
            utc_ms("2026-04-01T00:00:00Z"),
            &[],
            &[],
            "晨会",
            20,
        )
        .unwrap();
        let local: Vec<_> = out
            .iter()
            .map(|x| utc_ms_to_local(x.start_at, "America/New_York").unwrap())
            .collect();
        assert!(local.iter().all(|x| x.hour() == 9));
        assert_eq!(
            DateTime::<Utc>::from_timestamp_millis(out[0].start_at)
                .unwrap()
                .hour(),
            14
        );
        assert_eq!(
            DateTime::<Utc>::from_timestamp_millis(out[2].start_at)
                .unwrap()
                .hour(),
            13
        );
    }

    #[test]
    fn timezone_conversion_handles_fold_and_gap_explicitly() {
        // 2026-11-01 01:30 出现两次，约定取较早的 EDT 实例（05:30Z）。
        assert_eq!(
            local_to_utc_ms("2026-11-01T01:30:00", "America/New_York").unwrap(),
            utc_ms("2026-11-01T05:30:00Z")
        );
        // 2026-03-08 02:30 不存在，不能静默挪到别的时间。
        assert!(local_to_utc_ms("2026-03-08T02:30:00", "America/New_York").is_err());
        assert_eq!(
            all_day_date("2026-03-08").unwrap().to_string(),
            "2026-03-08"
        );
    }
}
