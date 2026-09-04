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

fn wiki_titles(markdown: &str) -> Vec<String> {
    let mut rest = markdown;
    let mut seen = HashSet::new();
    let mut titles = Vec::new();

    while let Some(open) = rest.find("[[") {
        rest = &rest[open + 2..];
        let Some(close) = rest.find("]]") else { break };
        let title = rest[..close].trim();
        if !title.is_empty() && !title.contains('\n') && seen.insert(title.to_string()) {
            titles.push(title.to_string());
        }
        rest = &rest[close + 2..];
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
                "SELECT entity_type, id FROM (
                   SELECT 'note' AS entity_type, id, 1 AS rank FROM note
                    WHERE title=?1 AND deleted_at IS NULL
                   UNION ALL
                   SELECT 'task', id, 2 FROM task WHERE title=?1 AND deleted_at IS NULL
                   UNION ALL
                   SELECT 'goal', id, 3 FROM goal WHERE title=?1 AND deleted_at IS NULL
                 ) ORDER BY rank LIMIT 1",
                params![title],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;

        if let Some((dst_type, dst_id)) = target {
            conn.execute(
                "INSERT INTO link
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

/// 列表：只取摘要列，不带 content_md。
/// 一个 300px 宽的列表没必要把每篇全文传过来。
pub fn list(conn: &Connection, archived: bool) -> Result<Vec<NoteSummary>> {
    let sql = format!(
        "SELECT {SUMMARY_COLS} FROM note
         WHERE deleted_at IS NULL AND is_archived = ?1
         ORDER BY is_pinned DESC, {} DESC",
        if archived {
            "archived_at"
        } else {
            "updated_at"
        }
    );
    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(params![archived as i64], summary_from_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// 单篇全文 + 挂在它下面的行动项
pub fn get(conn: &Connection, id: &str) -> Result<Note> {
    let mut note = conn
        .query_row(
            "SELECT id, title, content_md, excerpt, icon, word_count, is_pinned, is_archived,
                    archive_category, archived_at, action_title, created_at, updated_at
             FROM note WHERE id = ?1 AND deleted_at IS NULL",
            params![id],
            |r| {
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
            },
        )
        .optional()?
        .ok_or_else(|| AppError::NotFound(format!("note {id}")))?;

    if let Some(title) = note.1.take() {
        let tasks = task::for_host(conn, "note", id)?;
        if !tasks.is_empty() {
            note.0.action_group = Some(ActionGroup { title, tasks });
        }
    }
    Ok(note.0)
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
}
