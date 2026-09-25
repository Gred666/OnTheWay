use rusqlite::{params, Connection, OptionalExtension, Row};
use std::collections::HashSet;

use crate::db::{new_id, now_ms};
use crate::domain::model::{ActionGroup, Note, NoteInput, NoteSummary, SearchHit, SearchResult};
use crate::domain::{activity, search, task};
use crate::error::{AppError, Result};

const SUMMARY_COLS: &str = "id, title, excerpt, icon, is_pinned, archive_category,
                            archived_at, created_at, updated_at";

fn summary_from_row(r: &Row) -> rusqlite::Result<NoteSummary> {
    Ok(NoteSummary {
        id: r.get("id")?,
        title: r.get("title")?,
        excerpt: r.get("excerpt")?,
        icon: r.get("icon")?,
        is_pinned: r.get::<_, i64>("is_pinned")? != 0,
        archive_category: r.get("archive_category")?,
        archived_at: r.get("archived_at")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
    })
}

/// 正文里 `[[…]]` 指向的标题，和前端 editor/links.ts 的解析一致：
/// `[[目标|别名]]` 取目标，`[[标题#小节]]` / `[[标题^块]]` 取标题。
/// 双链不跨行，所以逐行找 —— 否则一个没闭合的 `[[` 会把下一行的双链吞掉。
fn wiki_titles(markdown: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut titles = Vec::new();

    for line in markdown.lines() {
        let mut rest = line;
        while let Some(open) = rest.find("[[") {
            rest = &rest[open + 2..];
            let Some(close) = rest.find("]]") else { break };
            let target = rest[..close].split('|').next().unwrap_or("").trim();
            rest = &rest[close + 2..];

            let cut = target
                .char_indices()
                .skip(1)
                .find(|&(_, c)| c == '#' || c == '^')
                .map_or(target.len(), |(index, _)| index);
            let title = target[..cut].trim();
            if !title.is_empty() && seen.insert(title.to_string()) {
                titles.push(title.to_string());
            }
        }
    }
    titles
}

/// 正文中的双链和 link 表在同一个事务里同步。只记录当前能解析到的实体；
/// 尚未创建的目标保留在 Markdown 中，下次保存时会再次尝试解析。
fn sync_wiki_links(conn: &Connection, src_id: &str, markdown: &str, now: i64) -> Result<()> {
    conn.execute(
        "DELETE FROM link WHERE src_type='note' AND src_id=?1 AND kind='ref'",
        params![src_id],
    )?;

    for (index, title) in wiki_titles(markdown).into_iter().enumerate() {
        let target = conn
            .query_row(
                // 忽略大小写，和编辑器里 Mod+点击跳转的匹配一致（NOCASE 只管 ASCII，
                // 中文标题本来也没有大小写）。完全同名的优先。
                "SELECT entity_type, id FROM (
                   SELECT 'note' AS entity_type, id, 1 AS rank, title FROM note
                    WHERE title=?1 COLLATE NOCASE AND deleted_at IS NULL
                   UNION ALL
                   SELECT 'task', id, 2, title FROM task
                    WHERE title=?1 COLLATE NOCASE AND deleted_at IS NULL
                   UNION ALL
                   SELECT 'goal', id, 3, title FROM goal
                    WHERE title=?1 COLLATE NOCASE AND deleted_at IS NULL
                 ) ORDER BY title = ?1 DESC, rank LIMIT 1",
                params![title],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;

        if let Some((dst_type, dst_id)) = target {
            // OR IGNORE：大小写不同的两个双链（`[[Kyoto]]`、`[[kyoto]]`）会落到同一篇上，
            // 撞 link 的唯一约束；那样整次保存都会失败
            conn.execute(
                "INSERT OR IGNORE INTO link
                   (id, src_type, src_id, dst_type, dst_id, kind, sort_key, created_at)
                 VALUES (?1,'note',?2,?3,?4,'ref',?5,?6)",
                params![
                    new_id(),
                    src_id,
                    dst_type,
                    dst_id,
                    format!("a{index:04}"),
                    now
                ],
            )?;
        }
    }
    Ok(())
}

/// 摘要 / 字数的算法改过之后，库里已有的派生列不会自己变，要等每篇都再保存一次。
/// 启动时按这个版本号整体重算一遍，每个版本只跑一次。
const DERIVED_VERSION_KEY: &str = "note_derived_v2";

/// 用当前算法重算所有笔记的 excerpt / word_count。不动 updated_at —— 这不是用户的编辑。
pub fn refresh_derived_columns(conn: &mut Connection) -> Result<()> {
    let done: i64 = conn.query_row(
        "SELECT count(*) FROM setting WHERE key = ?1",
        params![DERIVED_VERSION_KEY],
        |r| r.get(0),
    )?;
    if done > 0 {
        return Ok(());
    }

    let tx = conn.transaction()?;
    {
        let mut select = tx.prepare("SELECT id, content_md FROM note")?;
        let notes = select
            .query_map([], |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        // 值没变的不写：每次 UPDATE 都会触发 note_au 重建这一行的全文索引
        let mut update = tx.prepare(
            "UPDATE note SET excerpt = ?1, word_count = ?2
             WHERE id = ?3 AND (excerpt != ?1 OR word_count != ?2)",
        )?;
        for (id, markdown) in notes {
            update.execute(params![
                search::make_excerpt(&markdown, 60),
                search::count_words(&markdown),
                id
            ])?;
        }
    }
    tx.execute(
        "INSERT INTO setting (key, value) VALUES (?1, 'true')",
        params![DERIVED_VERSION_KEY],
    )?;
    tx.commit()?;
    Ok(())
}

/// 列表：只取摘要列，不带 content_md。
/// 一个 300px 宽的列表没必要把每篇全文传过来。
pub fn list(conn: &Connection, archived: bool) -> Result<Vec<NoteSummary>> {
    let sql = format!(
        "SELECT {SUMMARY_COLS} FROM note
         WHERE deleted_at IS NULL AND is_archived = ?1
         ORDER BY {}",
        list_order(archived)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![archived as i64], summary_from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

fn list_order(archived: bool) -> &'static str {
    if archived {
        "is_pinned DESC, archived_at DESC"
    } else {
        "is_pinned DESC, updated_at DESC"
    }
}

const FULL_COLS: &str = "id, title, content_md, excerpt, icon, word_count, is_pinned, is_archived,
                         archive_category, archived_at, action_title, created_at, updated_at";

/// 全文一行 + 它的 action_title（旧版行动项分组的标题，迁移 0003 之后都是 NULL）
fn full_from_row(r: &Row) -> rusqlite::Result<(Note, Option<String>)> {
    Ok((
        Note {
            id: r.get("id")?,
            title: r.get("title")?,
            content_md: r.get("content_md")?,
            excerpt: r.get("excerpt")?,
            icon: r.get("icon")?,
            word_count: r.get("word_count")?,
            is_pinned: r.get::<_, i64>("is_pinned")? != 0,
            is_archived: r.get::<_, i64>("is_archived")? != 0,
            archive_category: r.get("archive_category")?,
            archived_at: r.get("archived_at")?,
            created_at: r.get("created_at")?,
            updated_at: r.get("updated_at")?,
            action_group: None,
        },
        r.get::<_, Option<String>>("action_title")?,
    ))
}

fn with_action_group(
    conn: &Connection,
    (mut note, action_title): (Note, Option<String>),
) -> Result<Note> {
    if let Some(title) = action_title {
        let tasks = task::for_host(conn, "note", &note.id)?;
        if !tasks.is_empty() {
            note.action_group = Some(ActionGroup { title, tasks });
        }
    }
    Ok(note)
}

/// 单篇全文 + 挂在它下面的行动项
pub fn get(conn: &Connection, id: &str) -> Result<Note> {
    let row = conn
        .query_row(
            &format!("SELECT {FULL_COLS} FROM note WHERE id = ?1 AND deleted_at IS NULL"),
            params![id],
            full_from_row,
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("note {id}")))?;
    with_action_group(conn, row)
}

/// 一个列表（笔记 / 归档）的全部笔记，含正文，顺序和 `list` 一样。
/// 前端启动时要的就是全文；以前先取摘要列表再逐篇 note_get，N 篇就是 N 次 IPC 往返。
pub fn list_full(conn: &Connection, archived: bool) -> Result<Vec<Note>> {
    let sql = format!(
        "SELECT {FULL_COLS} FROM note
         WHERE deleted_at IS NULL AND is_archived = ?1
         ORDER BY {}",
        list_order(archived)
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt
        .query_map(params![archived as i64], full_from_row)?
        .collect::<rusqlite::Result<Vec<_>>>()?;
    rows.into_iter()
        .map(|row| with_action_group(conn, row))
        .collect()
}

/// 新建或更新。
/// excerpt / word_count / content_tokens 三个派生列在这里统一算，
/// 保证它们永远和 content_md 一致 —— 调用方不需要关心。
pub fn upsert(conn: &Connection, input: NoteInput) -> Result<String> {
    let now = now_ms();
    let tokens = search::tokenize_for_index(&format!("{} {}", input.title, input.content_md));
    let excerpt = search::make_excerpt(&input.content_md, 60);
    let words = search::count_words(&input.content_md);
    let icon = input.icon.unwrap_or_else(|| "file".to_string());
    let content_for_links = input.content_md.clone();

    let tx = conn.unchecked_transaction()?;
    let id = match input.id {
        Some(id) => {
            let n = tx.execute(
                "UPDATE note SET title=?1, content_md=?2, content_tokens=?3, excerpt=?4,
                                 word_count=?5, icon=?6, updated_at=?7
                 WHERE id=?8 AND deleted_at IS NULL",
                params![
                    input.title,
                    input.content_md,
                    tokens,
                    excerpt,
                    words,
                    icon,
                    now,
                    id
                ],
            )?;
            if n == 0 {
                return Err(AppError::NotFound(format!("note {id}")));
            }
            activity::log(&tx, "note", &id, "updated", None)?;
            id
        }
        None => {
            let id = new_id();
            tx.execute(
                "INSERT INTO note (id, title, content_md, content_tokens, excerpt,
                                   word_count, icon, created_at, updated_at)
                 VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8)",
                params![
                    id,
                    input.title,
                    input.content_md,
                    tokens,
                    excerpt,
                    words,
                    icon,
                    now
                ],
            )?;
            activity::log(&tx, "note", &id, "created", None)?;
            id
        }
    };
    sync_wiki_links(&tx, &id, &content_for_links, now)?;
    tx.commit()?;
    Ok(id)
}

pub fn set_pinned(conn: &Connection, id: &str, pinned: bool) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let n = tx.execute(
        "UPDATE note SET is_pinned=?1, updated_at=?2 WHERE id=?3 AND deleted_at IS NULL",
        params![pinned as i64, now_ms(), id],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("note {id}")));
    }
    activity::log(
        &tx,
        "note",
        id,
        if pinned { "pinned" } else { "unpinned" },
        None,
    )?;
    tx.commit()?;
    Ok(())
}

pub fn archive(conn: &Connection, id: &str, category: Option<String>) -> Result<()> {
    let now = now_ms();
    let tx = conn.unchecked_transaction()?;
    let n = tx.execute(
        "UPDATE note SET is_archived=1, is_pinned=0, archived_at=?1,
                         archive_category=COALESCE(?2, archive_category, '笔记'), updated_at=?1
         WHERE id=?3 AND deleted_at IS NULL",
        params![now, category, id],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("note {id}")));
    }
    activity::log(&tx, "note", id, "archived", None)?;
    tx.commit()?;
    Ok(())
}

pub fn restore(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let n = tx.execute(
        "UPDATE note SET is_archived=0, archived_at=NULL, updated_at=?1
         WHERE id=?2 AND deleted_at IS NULL",
        params![now_ms(), id],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("note {id}")));
    }
    activity::log(&tx, "note", id, "restored", None)?;
    tx.commit()?;
    Ok(())
}

/// 软删除。永不物理删除 —— 为将来的同步和「最近删除」留余地。
pub fn delete(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let n = tx.execute(
        "UPDATE note SET deleted_at=?1, updated_at=?1 WHERE id=?2 AND deleted_at IS NULL",
        params![now_ms(), id],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("note {id}")));
    }
    activity::log(&tx, "note", id, "deleted", None)?;
    tx.commit()?;
    Ok(())
}

/// 撤销删除。删除只是软删除，恢复就是把 deleted_at 清掉。
pub fn undelete(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    let n = tx.execute(
        "UPDATE note SET deleted_at=NULL WHERE id=?1 AND deleted_at IS NOT NULL",
        params![id],
    )?;
    if n == 0 {
        return Err(AppError::NotFound(format!("deleted note {id}")));
    }
    activity::log(&tx, "note", id, "undeleted", None)?;
    tx.commit()?;
    Ok(())
}

/// 全文搜索。中文分词细节见 domain/search.rs。
pub fn search_notes(conn: &Connection, query: &str, limit: u32) -> Result<SearchResult> {
    let Some(match_query) = search::build_match_query(query) else {
        return Ok(SearchResult {
            hits: vec![],
            tokens: vec![],
        });
    };

    let mut stmt = conn.prepare(
        "SELECT n.id, n.title, n.excerpt, n.icon, n.is_archived, n.updated_at,
                bm25(note_fts, 10.0, 1.0) AS score
         FROM note_fts
         JOIN note n ON n.rowid = note_fts.rowid
         WHERE note_fts MATCH ?1 AND n.deleted_at IS NULL
         ORDER BY score
         LIMIT ?2",
    )?;

    let rows = stmt.query_map(params![match_query, limit], |r| {
        Ok(SearchHit {
            id: r.get("id")?,
            title: r.get("title")?,
            excerpt: r.get("excerpt")?,
            icon: r.get("icon")?,
            is_archived: r.get::<_, i64>("is_archived")? != 0,
            updated_at: r.get("updated_at")?,
            score: r.get("score")?,
        })
    })?;

    Ok(SearchResult {
        hits: rows.collect::<rusqlite::Result<Vec<_>>>()?,
        tokens: search::query_tokens(query),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::db::test_support::test_conn;

    fn mk(conn: &Connection, title: &str, body: &str) -> String {
        upsert(
            conn,
            NoteInput {
                id: None,
                title: title.into(),
                content_md: body.into(),
                icon: None,
            },
        )
        .unwrap()
    }

    #[test]
    fn upsert_computes_derived_columns() {
        let conn = test_conn();
        let id = mk(&conn, "标题", "## 小节\n\n正文一共十个字。");
        let n = get(&conn, &id).unwrap();

        assert!(n.word_count > 0, "字数没算");
        assert!(!n.excerpt.is_empty(), "摘要没生成");
        assert!(
            !n.excerpt.contains('#'),
            "摘要里混进了 markdown 标记: {}",
            n.excerpt
        );
    }

    /// 这是整个中文搜索方案要解决的核心问题
    #[test]
    fn finds_note_by_two_char_chinese_word() {
        let conn = test_conn();
        mk(
            &conn,
            "秋季项目复盘",
            "这一周把季度目标推进到可以交付的状态。",
        );
        mk(&conn, "周末采购", "燕麦奶、灯泡、咖啡豆。");

        let r = search_notes(&conn, "季度", 10).unwrap();
        assert_eq!(r.hits.len(), 1, "双字词搜不到，分词方案失效");
        assert_eq!(r.hits[0].title, "秋季项目复盘");
    }

    #[test]
    fn finds_note_by_single_char_prefix() {
        let conn = test_conn();
        mk(&conn, "笔记本推荐", "关于纸张和装订。");

        let r = search_notes(&conn, "笔", 10).unwrap();
        assert_eq!(r.hits.len(), 1, "单字前缀匹配失效");
    }

    #[test]
    fn search_matches_title_and_body() {
        let conn = test_conn();
        mk(&conn, "京都书店清单", "安静、可以坐一下午的地方。");

        assert_eq!(
            search_notes(&conn, "京都", 10).unwrap().hits.len(),
            1,
            "标题没进索引"
        );
        assert_eq!(
            search_notes(&conn, "安静", 10).unwrap().hits.len(),
            1,
            "正文没进索引"
        );
    }

    #[test]
    fn search_excludes_deleted() {
        let conn = test_conn();
        let id = mk(&conn, "临时笔记", "内容");
        assert_eq!(search_notes(&conn, "临时", 10).unwrap().hits.len(), 1);

        delete(&conn, &id).unwrap();
        assert_eq!(
            search_notes(&conn, "临时", 10).unwrap().hits.len(),
            0,
            "软删除的还能搜到"
        );
    }

    /// 更新正文后 FTS 索引必须同步 —— 靠的是迁移里的 note_au 触发器
    #[test]
    fn search_index_follows_updates() {
        let conn = test_conn();
        let id = mk(&conn, "原标题", "原来的内容");
        assert_eq!(search_notes(&conn, "原来", 10).unwrap().hits.len(), 1);

        upsert(
            &conn,
            NoteInput {
                id: Some(id),
                title: "新标题".into(),
                content_md: "换成了别的东西".into(),
                icon: None,
            },
        )
        .unwrap();

        assert_eq!(
            search_notes(&conn, "原来", 10).unwrap().hits.len(),
            0,
            "旧内容还留在索引里"
        );
        assert_eq!(
            search_notes(&conn, "别的", 10).unwrap().hits.len(),
            1,
            "新内容没进索引"
        );
    }

    #[test]
    fn empty_query_returns_nothing_rather_than_everything() {
        let conn = test_conn();
        mk(&conn, "甲", "内容");
        mk(&conn, "乙", "内容");
        assert_eq!(search_notes(&conn, "   ", 10).unwrap().hits.len(), 0);
    }

    #[test]
    fn archive_moves_between_lists_and_clears_pin() {
        let conn = test_conn();
        let id = mk(&conn, "会被归档的", "内容");
        set_pinned(&conn, &id, true).unwrap();

        assert_eq!(list(&conn, false).unwrap().len(), 1);
        assert_eq!(list(&conn, true).unwrap().len(), 0);

        archive(&conn, &id, Some("工作笔记".into())).unwrap();

        assert_eq!(list(&conn, false).unwrap().len(), 0, "归档后还在笔记列表里");
        let arch = list(&conn, true).unwrap();
        assert_eq!(arch.len(), 1);
        assert!(!arch[0].is_pinned, "归档应清除置顶");
        assert_eq!(arch[0].archive_category.as_deref(), Some("工作笔记"));

        restore(&conn, &id).unwrap();
        assert_eq!(list(&conn, false).unwrap().len(), 1);
        assert_eq!(list(&conn, true).unwrap().len(), 0);
    }

    #[test]
    fn list_puts_pinned_first() {
        let conn = test_conn();
        mk(&conn, "先建的", "a");
        let second = mk(&conn, "后建的", "b");
        set_pinned(&conn, &second, true).unwrap();

        let l = list(&conn, false).unwrap();
        assert_eq!(l[0].title, "后建的", "置顶的没排在最前");
    }

    #[test]
    fn deleted_note_is_gone_from_list_and_get() {
        let conn = test_conn();
        let id = mk(&conn, "临时", "内容");
        delete(&conn, &id).unwrap();

        assert_eq!(list(&conn, false).unwrap().len(), 0);
        assert!(matches!(get(&conn, &id), Err(AppError::NotFound(_))));
    }

    #[test]
    fn mutations_on_missing_note_are_not_found() {
        let conn = test_conn();
        assert!(matches!(
            set_pinned(&conn, "x", true),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(
            archive(&conn, "x", None),
            Err(AppError::NotFound(_))
        ));
        assert!(matches!(restore(&conn, "x"), Err(AppError::NotFound(_))));
        assert!(matches!(delete(&conn, "x"), Err(AppError::NotFound(_))));
    }

    #[test]
    fn upsert_synchronizes_wiki_links_without_duplicates() {
        let conn = test_conn();
        let target = mk(&conn, "目标笔记", "正文");
        let source = mk(
            &conn,
            "来源",
            "关联 [[目标笔记]]、[[不存在]] 和 [[目标笔记]]",
        );

        let link: (String, String, i64) = conn
            .query_row(
                "SELECT dst_type, dst_id, count(*) FROM link
                 WHERE src_type='note' AND src_id=?1 AND kind='ref'",
                params![source],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(link, ("note".into(), target, 1));

        upsert(
            &conn,
            NoteInput {
                id: Some(source.clone()),
                title: "来源".into(),
                content_md: "已经移除引用".into(),
                icon: None,
            },
        )
        .unwrap();
        let count: i64 = conn
            .query_row(
                "SELECT count(*) FROM link WHERE src_type='note' AND src_id=?1 AND kind='ref'",
                params![source],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn list_full_matches_list_order_and_carries_bodies() {
        let conn = test_conn();
        let first = mk(&conn, "先建的", "正文一");
        let second = mk(&conn, "后建的", "正文二");
        let archived = mk(&conn, "归档的", "正文三");
        set_pinned(&conn, &first, true).unwrap();
        archive(&conn, &archived, None).unwrap();

        let full = list_full(&conn, false).unwrap();
        let ids: Vec<&str> = full.iter().map(|n| n.id.as_str()).collect();
        let summary_ids: Vec<String> = list(&conn, false)
            .unwrap()
            .into_iter()
            .map(|n| n.id)
            .collect();
        assert_eq!(ids, summary_ids);
        assert_eq!(ids, vec![first.as_str(), second.as_str()]);
        assert_eq!(full[1].content_md, "正文二");

        let full_archived = list_full(&conn, true).unwrap();
        assert_eq!(full_archived.len(), 1);
        assert!(full_archived[0].is_archived);
        assert_eq!(full_archived[0].content_md, "正文三");
    }

    #[test]
    fn undelete_brings_a_deleted_note_back() {
        let conn = test_conn();
        let id = mk(&conn, "误删的", "内容");
        delete(&conn, &id).unwrap();
        assert!(list(&conn, false).unwrap().is_empty());

        undelete(&conn, &id).unwrap();
        assert_eq!(get(&conn, &id).unwrap().content_md, "内容");
        assert_eq!(search_notes(&conn, "误删", 10).unwrap().hits.len(), 1);

        // 没被删过的不能「撤销删除」
        assert!(matches!(undelete(&conn, &id), Err(AppError::NotFound(_))));
    }

    #[test]
    fn refresh_recomputes_stale_excerpts_once_without_touching_updated_at() {
        let mut conn = test_conn();
        let id = mk(
            &conn,
            "旧笔记",
            "- [x] 已完成\n见 [官网](https://example.com)",
        );
        conn.execute(
            "UPDATE note SET excerpt = 'x 已完成 见 官网https://example.com', word_count = 99,
                             updated_at = 7 WHERE id = ?1",
            params![id],
        )
        .unwrap();

        refresh_derived_columns(&mut conn).unwrap();
        let n = get(&conn, &id).unwrap();
        assert_eq!(n.excerpt, "已完成 见 官网");
        assert_eq!(n.word_count, 6);
        assert_eq!(n.updated_at, 7, "重算摘要不是用户的编辑，不该改 updated_at");

        // 同一版本只跑一次
        conn.execute(
            "UPDATE note SET excerpt = '手动' WHERE id = ?1",
            params![id],
        )
        .unwrap();
        refresh_derived_columns(&mut conn).unwrap();
        assert_eq!(get(&conn, &id).unwrap().excerpt, "手动");
    }

    #[test]
    fn wiki_titles_strip_alias_and_anchor_like_the_editor() {
        assert_eq!(
            wiki_titles("[[目标笔记|别名]] [[目标笔记#小节]] [[另一篇^块]] [[#只有小节]]"),
            vec!["目标笔记", "另一篇", "#只有小节"]
        );
    }

    fn ref_targets(conn: &Connection, source: &str) -> Vec<String> {
        conn.prepare("SELECT dst_id FROM link WHERE src_id=?1 AND kind='ref' ORDER BY sort_key")
            .unwrap()
            .query_map(params![source], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap()
    }

    #[test]
    fn wiki_links_resolve_case_insensitively() {
        let conn = test_conn();
        let kyoto = mk(&conn, "Kyoto 书店", "正文");
        let source = mk(&conn, "来源", "[[KYOTO 书店]]");
        assert_eq!(ref_targets(&conn, &source), vec![kyoto]);
    }

    #[test]
    fn exact_title_wins_over_case_insensitive_match() {
        let conn = test_conn();
        mk(&conn, "Kyoto 书店", "正文");
        let exact = mk(&conn, "kyoto 书店", "同名只差大小写");
        let source = mk(&conn, "来源", "[[kyoto 书店]]");
        assert_eq!(ref_targets(&conn, &source), vec![exact]);
    }

    /// 两个只差大小写的双链落到同一篇上：只记一条，保存不能因此失败
    #[test]
    fn links_differing_only_in_case_do_not_break_saving() {
        let conn = test_conn();
        let kyoto = mk(&conn, "Kyoto 书店", "正文");
        let source = mk(&conn, "来源", "[[KYOTO 书店]] 和 [[kyoto 书店]]");
        assert_eq!(ref_targets(&conn, &source), vec![kyoto]);
    }

    #[test]
    fn unclosed_wiki_link_does_not_swallow_the_next_line() {
        assert_eq!(wiki_titles("[[没闭合\n[[完整]]"), vec!["完整"]);
    }

    #[test]
    fn aliased_wiki_link_is_recorded() {
        let conn = test_conn();
        let target = mk(&conn, "目标笔记", "正文");
        let source = mk(&conn, "来源", "见 [[目标笔记|这篇]] 的 [[目标笔记#小节]]");

        let rows: Vec<String> = conn
            .prepare("SELECT dst_id FROM link WHERE src_type='note' AND src_id=?1 AND kind='ref'")
            .unwrap()
            .query_map(params![source], |row| row.get(0))
            .unwrap()
            .collect::<rusqlite::Result<_>>()
            .unwrap();
        assert_eq!(rows, vec![target]);
    }
}
