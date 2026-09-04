use jieba_rs::Jieba;
use once_cell::sync::Lazy;

/* ============================================================
中文全文搜索的分词层。

为什么不直接用 FTS5 的内置分词器（技术方案 §6）：
- unicode61 不切中文，整句会变成一个 token，搜「季度」完全搜不到
- trigram 按 3 字符切，而中文双字词（「笔记」「目标」「复盘」）极常见，
  2 字查询直接无结果

方案：写入时用 jieba 预切分成空格分隔串存进 note.content_tokens，
FTS5 用 unicode61 索引这一列；查询时同样切词。
============================================================ */

/// 首次初始化约 50ms，进程内只做一次。
/// 在 Tauri setup 里预热，别等到用户第一次搜索才付这个代价。
static JIEBA: Lazy<Jieba> = Lazy::new(Jieba::new);

pub fn warm_up() {
    Lazy::force(&JIEBA);
}

/// token 里至少要有一个字母、数字或汉字。
///
/// jieba 会把标点单独切出来（`say "hi"` → `say` `"` `hi` `"`）。
/// 这类 token 进了 FTS5 查询就是 `""""*` 这种项 —— unicode61 分词器
/// 会把它规约成空，匹配不到任何东西，还可能触发语法错误。
fn is_meaningful(t: &str) -> bool {
    t.chars().any(|c| c.is_alphanumeric())
}

/// 写入索引用。
///
/// `cut_for_search` 产生**重叠的细粒度切分**：
/// 「季度目标」既产生 `季度目标`，也产生 `季度`、`目标`。
/// 这样用户搜整词还是搜子词都能命中。
pub fn tokenize_for_index(text: &str) -> String {
    JIEBA
        .cut_for_search(text, true)
        .into_iter()
        .map(str::trim)
        .filter(|t| is_meaningful(t))
        .collect::<Vec<_>>()
        .join(" ")
}

/// 查询用：切词 + 每个 token 加前缀通配 + 隐式 AND。
///
/// 前缀通配解决单字查询：搜「笔」变成 `"笔"*`，能命中 `笔记`、`笔试`。
/// 双引号包裹 + 内部双引号转义，防止用户输入破坏 FTS5 查询语法。
pub fn build_match_query(q: &str) -> Option<String> {
    let toks: Vec<String> = JIEBA
        .cut_for_search(q, true)
        .into_iter()
        .map(str::trim)
        .filter(|t| is_meaningful(t))
        // 双引号包裹 + 内部双引号转义，防止用户输入破坏 FTS5 语法
        .map(|t| format!("\"{}\"*", t.replace('"', "\"\"")))
        .collect();

    if toks.is_empty() {
        None
    } else {
        Some(toks.join(" "))
    }
}

/// 前端高亮用的 token 列表。
///
/// 不能用 SQLite 的 `snippet()` / `highlight()` —— 它们作用在
/// content_tokens 上，返回的是分词后的空格分隔文本，
/// 中文看起来会像「今天 开会 讨论 季度 目标」，很丑。
/// 所以只把 token 传回前端，让前端在原始 content_md 上做高亮。
pub fn query_tokens(q: &str) -> Vec<String> {
    let mut toks: Vec<String> = JIEBA
        .cut_for_search(q, true)
        .into_iter()
        .map(str::trim)
        .filter(|t| is_meaningful(t))
        .map(str::to_string)
        .collect();
    toks.sort_by_key(|t| std::cmp::Reverse(t.chars().count())); // 长词优先高亮
    toks.dedup();
    toks
}

/// 正文摘要：取纯文本前 n 个字符。
pub fn make_excerpt(md: &str, n: usize) -> String {
    let plain = strip_markdown(md);
    let mut out: String = plain.chars().take(n).collect();
    if plain.chars().count() > n {
        out.push('…');
    }
    out
}

/// 字数：中文按字算，英文按词算。
pub fn count_words(md: &str) -> i64 {
    let plain = strip_markdown(md);
    let cjk = plain.chars().filter(|c| is_cjk(*c)).count();
    let words = plain
        .split(|c: char| !c.is_ascii_alphanumeric())
        .filter(|s| !s.is_empty())
        .count();
    (cjk + words) as i64
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32, 0x4E00..=0x9FFF | 0x3400..=0x4DBF)
}

/// 极简 Markdown 去标记。够用于摘要和字数统计，不追求完备。
fn strip_markdown(md: &str) -> String {
    let mut out = String::with_capacity(md.len());
    for raw in md.lines() {
        let line = raw.trim();
        // 跳过 callout 的标签行 `> [!核心判断]`
        if line.starts_with("> [!") {
            continue;
        }
        let line = line
            .trim_start_matches('>')
            .trim_start_matches(|c| c == '#' || c == '-' || c == '*')
            .trim();
        if line.is_empty() {
            continue;
        }
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(&line.replace(['`', '[', ']', '(', ')', '*'], ""));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn indexes_chinese_with_overlapping_tokens() {
        let t = tokenize_for_index("完成季度目标");
        // cut_for_search 应该同时给出细粒度和粗粒度的切分
        assert!(t.contains("季度"), "缺少子词切分: {t}");
        assert!(t.contains("目标"), "缺少子词切分: {t}");
    }

    /// 这是整个方案存在的理由：双字中文词必须能被搜到
    #[test]
    fn two_char_chinese_word_is_searchable() {
        let indexed = tokenize_for_index("这一周把季度目标推进到可交付状态");
        let q = build_match_query("季度").unwrap();

        // FTS5 的 "季度"* 要能匹配到索引串里的 季度 这个 token
        assert!(q.contains("季度"));
        assert!(
            indexed.split_whitespace().any(|t| t == "季度"),
            "索引串里没有独立的「季度」token: {indexed}"
        );
    }

    /// 用户输入的标点不能变成查询项 —— 否则会生成 `""""*` 这种匹配不到
    /// 任何东西、还可能触发 FTS5 语法错误的项
    #[test]
    fn drops_punctuation_only_tokens() {
        let q = build_match_query("say \"hi\"").unwrap();
        assert_eq!(q, "\"say\"* \"hi\"*", "标点没被过滤掉: {q}");
    }

    #[test]
    fn punctuation_only_input_yields_none() {
        assert!(build_match_query("!!!???").is_none());
        assert!(build_match_query("，。、").is_none());
    }

    /// 引号仍要转义 —— 万一 jieba 把它和字母粘在一起切出来
    #[test]
    fn escapes_embedded_quotes() {
        let q = build_match_query("a\"b").unwrap();
        assert!(!q.contains("a\"b"), "内嵌引号没转义: {q}");
    }

    #[test]
    fn empty_query_yields_none() {
        assert!(build_match_query("   ").is_none());
        assert!(build_match_query("").is_none());
    }

    #[test]
    fn counts_mixed_cn_en() {
        // 「今天写了」4 字 + code / review 2 词
        assert_eq!(count_words("今天写了 code review"), 6);
    }

    #[test]
    fn excerpt_skips_callout_labels_and_markers() {
        let md = "## 标题\n\n> [!核心判断]\n> 结论在这里\n\n正文第一句。";
        let e = make_excerpt(md, 100);
        assert!(!e.contains("[!"), "callout 标签漏进摘要: {e}");
        assert!(!e.contains('#'), "标题标记漏进摘要: {e}");
        assert!(e.contains("正文第一句"), "正文丢了: {e}");
    }

    #[test]
    fn excerpt_truncates_with_ellipsis() {
        let e = make_excerpt("一二三四五六七八九十", 5);
        assert_eq!(e, "一二三四五…");
    }

    #[test]
    fn query_tokens_are_longest_first() {
        let toks = query_tokens("季度目标");
        assert!(!toks.is_empty());
        // 长词优先，前端高亮时先匹配长的才不会被短的切碎
        let lens: Vec<usize> = toks.iter().map(|t| t.chars().count()).collect();
        assert!(
            lens.windows(2).all(|w| w[0] >= w[1]),
            "没有按长度降序: {toks:?}"
        );
    }
}
