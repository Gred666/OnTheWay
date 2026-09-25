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
    // 长词优先高亮；同长度再按字面排，重复的词才会相邻，dedup 才去得掉
    toks.sort_by(|a, b| {
        b.chars()
            .count()
            .cmp(&a.chars().count())
            .then_with(|| a.cmp(b))
    });
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

/// 字数：中文按字算，英文按词算；裸网址算一个词。
pub fn count_words(md: &str) -> i64 {
    let plain = strip_markdown(md);
    let cjk = plain.chars().filter(|c| is_cjk(*c)).count();
    let words: usize = plain
        .split_whitespace()
        .map(|token| {
            if token.contains("://") {
                1
            } else {
                token
                    .split(|c: char| !c.is_ascii_alphanumeric())
                    .filter(|s| !s.is_empty())
                    .count()
            }
        })
        .sum();
    (cjk + words) as i64
}

fn is_cjk(c: char) -> bool {
    matches!(c as u32, 0x4E00..=0x9FFF | 0x3400..=0x4DBF)
}

/* ============================================================
摘要和字数用的纯文本。
只认最常见的写法，不追求完备 —— 但标记本身不能漏进去：以前 `- [x] 任务`
的摘要是「x 任务」，`[官网](https://…)` 是「官网https://…」，网址的每一段
还都各算一个字。前端 mock（src/lib/plainText.ts）按同一套规则实现。

整行跳过：front matter、围栏行、分隔线 / Setext 下划线、表格分隔行、
链接和缩写定义、`[TOC]`、callout 标签行、HTML 注释。
行首剥掉：引用、标题、列表符号、任务勾选框、脚注定义的 `[^id]:`。
行内：见 strip_inline。
============================================================ */

fn strip_markdown(md: &str) -> String {
    let lines: Vec<&str> = md.lines().collect();
    let mut out = String::with_capacity(md.len());
    let mut in_comment = false;

    for raw in &lines[front_matter_len(&lines)..] {
        let mut line = raw.trim();
        if in_comment {
            let Some(end) = line.find("-->") else {
                continue;
            };
            in_comment = false;
            line = line[end + 3..].trim();
        }
        if let Some(start) = line.find("<!--") {
            if !line[start..].contains("-->") {
                in_comment = true;
                line = line[..start].trim();
            }
        }
        if is_markup_only_line(line) {
            continue;
        }

        let mut text = strip_inline(strip_line_prefix(line));
        if line.starts_with('|') {
            text = text.replace('|', " ");
        }
        for word in text.split_whitespace() {
            if !out.is_empty() {
                out.push(' ');
            }
            out.push_str(word);
        }
    }
    out
}

/// 文档开头的 YAML front matter 占几行。规则和编辑器（editor/frontMatter.ts）一致：
/// 第一行 `---`，60 行以内以 `---` 收尾，中间至少有一行 `key: value`。
fn front_matter_len(lines: &[&str]) -> usize {
    let is_fence = |line: &str| line.trim_end() == "---";
    if lines.len() < 3 || !is_fence(lines[0]) {
        return 0;
    }
    let mut saw_key = false;
    for (index, line) in lines.iter().enumerate().take(60).skip(1) {
        if is_fence(line) {
            return if saw_key { index + 1 } else { 0 };
        }
        saw_key |= is_yaml_key(line);
    }
    0
}

fn is_yaml_key(line: &str) -> bool {
    let mut chars = line.chars();
    if !chars
        .next()
        .is_some_and(|c| c.is_ascii_alphabetic() || c == '_')
    {
        return false;
    }
    chars
        .as_str()
        .trim_start_matches(|c: char| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        .trim_start()
        .starts_with(':')
}

/// 整行都是标记、没有可读文字的行。
fn is_markup_only_line(line: &str) -> bool {
    let only = |allowed: &[char]| !line.is_empty() && line.chars().all(|c| allowed.contains(&c));
    line.starts_with("```")
        || line.starts_with("~~~")
        // 分隔线、Setext 下划线
        || only(&['-', '*', '_', '=', ' ', '\t'])
        // 表格分隔行 `|---|:---:|`
        || (line.starts_with('|') && only(&['|', '-', ':', ' ', '\t']))
        // callout 标签行 `> [!核心判断]`
        || (line.starts_with('>')
            && line
                .trim_start_matches(['>', ' ', '\t'])
                .starts_with("[!"))
        || line.eq_ignore_ascii_case("[toc]")
        || line.eq_ignore_ascii_case("[[toc]]")
        || is_definition(line)
}

/// 链接定义 `[标签]: 地址` 和缩写定义 `*[HTML]: …`。脚注定义 `[^1]: …` 的正文要留着。
fn is_definition(line: &str) -> bool {
    let rest = line.strip_prefix('*').unwrap_or(line);
    let Some(rest) = rest.strip_prefix('[') else {
        return false;
    };
    !rest.starts_with('^')
        && rest
            .find("]:")
            .is_some_and(|end| !rest[..end].contains(['[', ']']))
}

/// 行首的块级标记：引用（可嵌套）、标题、列表符号、任务勾选框、脚注定义。
fn strip_line_prefix(line: &str) -> &str {
    let mut line = line.trim_start();
    while let Some(rest) = line.strip_prefix('>') {
        line = rest.trim_start();
    }

    let hashes = line.len() - line.trim_start_matches('#').len();
    if (1..=6).contains(&hashes)
        && line[hashes..]
            .chars()
            .next()
            .map_or(true, char::is_whitespace)
    {
        let text = line[hashes..].trim();
        // `## 标题 ##` 的收尾井号；`## C#` 里的不算（前面没有空格）
        let unclosed = text.trim_end_matches('#');
        return if unclosed.is_empty() || unclosed.ends_with(char::is_whitespace) {
            unclosed.trim_end()
        } else {
            text
        };
    }

    line = strip_list_marker(line);
    for task in ["[ ]", "[x]", "[X]"] {
        if let Some(rest) = line.strip_prefix(task) {
            if rest.is_empty() || rest.starts_with(char::is_whitespace) {
                line = rest.trim_start();
                break;
            }
        }
    }
    if line.starts_with("[^") {
        if let Some(end) = line.find("]:") {
            line = line[end + 2..].trim_start();
        }
    }
    line
}

/// `- ` / `* ` / `+ ` / `1. ` / `1) `
fn strip_list_marker(line: &str) -> &str {
    let digits = line.len() - line.trim_start_matches(|c: char| c.is_ascii_digit()).len();
    let marker = match line[digits..].chars().next() {
        Some('-' | '*' | '+') if digits == 0 => 1,
        Some('.' | ')') if (1..=9).contains(&digits) => digits + 1,
        _ => return line,
    };
    let rest = &line[marker..];
    if rest.is_empty() || rest.starts_with(char::is_whitespace) {
        rest.trim_start()
    } else {
        line
    }
}

/// 行内标记：图片留 alt，链接留文字，双链留别名（没有别名就是目标），行内代码
/// 留原文，脚注引用、HTML 标签和注释去掉，强调 / 删除线 / 高亮的符号去掉。
fn strip_inline(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(c) = rest.chars().next() {
        let step = match c {
            '\\' => escaped(rest),
            '`' => Some(code_span(rest)),
            '!' if rest[1..].starts_with('[') => {
                link_like(&rest[1..]).map(|(label, after)| (image_alt(label).to_string(), after))
            }
            '[' => wiki_link(rest)
                .or_else(|| footnote_ref(rest))
                .or_else(|| link_like(rest).map(|(label, after)| (strip_inline(label), after))),
            '<' => html(rest),
            '*' => Some((String::new(), &rest[1..])),
            '~' | '=' | '_' if rest[1..].starts_with(c) => Some((String::new(), &rest[2..])),
            _ => None,
        };
        match step {
            Some((kept, after)) => {
                out.push_str(&kept);
                rest = after;
            }
            None => {
                out.push(c);
                rest = &rest[c.len_utf8()..];
            }
        }
    }
    out
}

/// `\*` → `*`
fn escaped(rest: &str) -> Option<(String, &str)> {
    let next = rest[1..]
        .chars()
        .next()
        .filter(char::is_ascii_punctuation)?;
    Some((next.to_string(), &rest[1 + next.len_utf8()..]))
}

/// 行内代码原样留下（里面的 `*`、`==` 不是标记）；没闭合就只去掉反引号。
fn code_span(rest: &str) -> (String, &str) {
    let ticks = rest.len() - rest.trim_start_matches('`').len();
    let body = &rest[ticks..];
    match body.find(&rest[..ticks]) {
        Some(end) => (body[..end].trim().to_string(), &body[end + ticks..]),
        None => (String::new(), body),
    }
}

/// `[文字](地址)` / `[文字][标签]`：返回文字和之后的剩余部分。
/// 后面既不是 `(` 也不是 `[` 的方括号只是普通文字，返回 None。
fn link_like(rest: &str) -> Option<(&str, &str)> {
    let close = matching(rest, '[', ']')?;
    let label = &rest[1..close];
    let after = &rest[close + 1..];
    if after.starts_with('(') {
        let end = matching(after, '(', ')')?;
        Some((label, &after[end + 1..]))
    } else if after.starts_with('[') {
        let end = after.find(']')?;
        Some((label, &after[end + 1..]))
    } else {
        None
    }
}

/// `s` 以 open 开头，返回和它配对的 close 的位置（允许嵌套）。
fn matching(s: &str, open: char, close: char) -> Option<usize> {
    let mut depth = 0usize;
    for (index, c) in s.char_indices() {
        if c == open {
            depth += 1;
        } else if c == close {
            depth -= 1;
            if depth == 0 {
                return Some(index);
            }
        }
    }
    None
}

/// Obsidian 式尺寸 `![alt|300]` / `![alt|300x200]` 不算 alt。
fn image_alt(label: &str) -> &str {
    match label.rsplit_once('|') {
        Some((alt, size))
            if !size.is_empty() && size.chars().all(|c| c.is_ascii_digit() || c == 'x') =>
        {
            alt.trim()
        }
        _ => label.trim(),
    }
}

fn wiki_link(rest: &str) -> Option<(String, &str)> {
    let body = rest.strip_prefix("[[")?;
    let end = body.find("]]")?;
    let inner = &body[..end];
    let shown = inner.split_once('|').map_or(inner, |(_, alias)| alias);
    Some((shown.trim().to_string(), &body[end + 2..]))
}

fn footnote_ref(rest: &str) -> Option<(String, &str)> {
    let body = rest.strip_prefix("[^")?;
    let end = body.find(']')?;
    Some((String::new(), &body[end + 1..]))
}

/// HTML 注释和标签去掉（`<br>` 换成空格），`<https://…>` / `<a@b.c>` 留地址。
/// 不像标签的 `<`（`a < b`）照原样留下。
fn html(rest: &str) -> Option<(String, &str)> {
    if let Some(body) = rest.strip_prefix("<!--") {
        let end = body.find("-->")?;
        return Some((String::new(), &body[end + 3..]));
    }
    let end = rest.find('>')?;
    let inner = &rest[1..end];
    let after = &rest[end + 1..];
    if !inner.is_empty()
        && !inner.contains(char::is_whitespace)
        && (inner.contains("://") || inner.contains('@'))
    {
        return Some((inner.to_string(), after));
    }
    let name = inner.strip_prefix('/').unwrap_or(inner);
    if !name.starts_with(|c: char| c.is_ascii_alphabetic()) {
        return None;
    }
    let tag: String = name
        .chars()
        .take_while(char::is_ascii_alphanumeric)
        .collect();
    let kept = if tag.eq_ignore_ascii_case("br") {
        " "
    } else {
        ""
    };
    Some((kept.to_string(), after))
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
    fn excerpt_is_plain_text() {
        for (md, expected) in [
            (
                "- [x] 已完成的任务\n- [ ] 待办事项",
                "已完成的任务 待办事项",
            ),
            ("1. 第一步\n2) 第二步", "第一步 第二步"),
            ("见 [官网](https://example.com/a_(b)) 说明", "见 官网 说明"),
            ("![截图|300x200](C:/img/a.png) 和 ![](b.png)", "截图 和"),
            (
                "[[目标笔记|别名]] 与 [[另一篇#小节]]",
                "别名 与 另一篇#小节",
            ),
            (
                "<b>粗体</b>第一行<br>第二行 <https://x.dev> <!-- 备注 -->",
                "粗体第一行 第二行 https://x.dev",
            ),
            (
                "**强调** ==高亮== ~~删除~~ __粗__ `a == b` \\*字面\\*",
                "强调 高亮 删除 粗 a == b *字面*",
            ),
            ("正文[^1]\n\n[^1]: 脚注内容", "正文 脚注内容"),
            ("## 标题 ##\n## C#\n#话题", "标题 C# #话题"),
            (
                "> > 嵌套引用\n> - [ ] 引用里的任务",
                "嵌套引用 引用里的任务",
            ),
            (
                "| 名称 | 数量 |\n|---|:-:|\n| 苹果 | 3 |",
                "名称 数量 苹果 3",
            ),
            ("[草稿] 方括号只是文字 a < b", "[草稿] 方括号只是文字 a < b"),
        ] {
            assert_eq!(make_excerpt(md, 200), expected, "输入: {md:?}");
        }
    }

    #[test]
    fn excerpt_skips_markup_only_lines() {
        let md = "---\ntitle: 周报\ntags: [a]\n---\n[TOC]\n\n```rust\nfn main() {}\n```\n\n\
                  ***\n\n标题\n===\n\n[官网]: https://example.com\n*[HTML]: HyperText\n\n\
                  <!--\n多行注释\n-->\n正文";
        assert_eq!(make_excerpt(md, 200), "fn main() {} 标题 正文");
    }

    /// 以分隔线开头、却不是 front matter 的普通笔记：别把正文当 YAML 吃掉
    #[test]
    fn leading_rule_is_not_front_matter() {
        assert_eq!(make_excerpt("---\n正文\n---\n后面", 200), "正文 后面");
    }

    #[test]
    fn link_urls_do_not_inflate_word_count() {
        assert_eq!(count_words("[官网](https://example.com/a/b/c)"), 2);
        assert_eq!(count_words("裸网址 https://example.com/a/b/c"), 4);
        assert_eq!(count_words("- [x] done task"), 2);
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

    /// 同长度的重复词不相邻时，光靠 dedup 去不掉
    #[test]
    fn query_tokens_are_deduplicated() {
        let toks = query_tokens("季度 目标 季度");
        assert_eq!(
            toks.iter().filter(|t| t.as_str() == "季度").count(),
            1,
            "重复的查询词没去重: {toks:?}"
        );
    }
}
