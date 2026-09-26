/* ============================================================
索引：从仓库文件派生出来的缓存，随时可以删掉重建。

存在应用数据目录里（不在仓库里）：仓库可能放在网盘同步的文件夹下，
一个正在写的 SQLite 被同步程序来回拷，迟早出冲突副本。

表结构改了就升 VERSION：版本不对时整个索引清空，下次扫描从文件重建。
不需要迁移脚本 —— 这就是「文件是真相」换来的。
============================================================ */

use std::path::Path;

use rusqlite::{params, Connection, OptionalExtension, Row};

use super::tasks::ScheduledTask;
use crate::error::Result;

const VERSION: i64 = 1;

const SCHEMA: &str = "
CREATE TABLE doc (
  id             TEXT    PRIMARY KEY,
  kind           TEXT    NOT NULL,          -- note | day | goal
  rel_path       TEXT    NOT NULL UNIQUE,   -- 仓库内相对路径，正斜杠
  day            TEXT,                      -- 某一天：YYYY-MM-DD
  horizon        TEXT,                      -- 目标：week | month | year
  period_start   TEXT,
  title          TEXT    NOT NULL,
  content_md     TEXT    NOT NULL,
  excerpt        TEXT    NOT NULL,
  word_count     INTEGER NOT NULL,
  is_pinned      INTEGER NOT NULL,
  is_archived    INTEGER NOT NULL,
  archive_category TEXT,
  archived_at    INTEGER,
  created_at     INTEGER NOT NULL,
  updated_at     INTEGER NOT NULL,
  mtime          INTEGER NOT NULL,
  size           INTEGER NOT NULL,
  hash           TEXT    NOT NULL           -- 文件内容指纹：磁盘上的是不是索引里这一版
);
CREATE UNIQUE INDEX doc_day  ON doc(day) WHERE kind = 'day';
CREATE UNIQUE INDEX doc_goal ON doc(horizon, period_start) WHERE kind = 'goal';

CREATE TABLE task (
  id         TEXT    PRIMARY KEY,           -- 文档 id # 行号
  doc_id     TEXT    NOT NULL,
  line       INTEGER NOT NULL,
  raw        TEXT    NOT NULL,
  title      TEXT    NOT NULL,
  done       INTEGER NOT NULL,
  due_date   TEXT    NOT NULL,
  time_label TEXT,
  category   TEXT
);
CREATE INDEX task_doc ON task(doc_id);
CREATE INDEX task_due ON task(due_date);

-- 只有笔记进全文索引。中文靠写入前的 jieba 预切分（domain/search.rs）
CREATE VIRTUAL TABLE doc_fts USING fts5(
  id UNINDEXED,
  title,
  tokens,
  tokenize = 'unicode61 remove_diacritics 2'
);
";

pub fn open(path: &Path) -> Result<Connection> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir)?;
    }
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    conn.pragma_update(None, "synchronous", "NORMAL")?;
    conn.pragma_update(None, "temp_store", "MEMORY")?;
    prepare(&conn)?;
    Ok(conn)
}

#[cfg(test)]
pub fn open_in_memory() -> Connection {
    let conn = Connection::open_in_memory().unwrap();
    prepare(&conn).unwrap();
    conn
}

fn prepare(conn: &Connection) -> Result<()> {
    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version == VERSION {
        return Ok(());
    }
    conn.execute_batch(
        "DROP TABLE IF EXISTS doc_fts; DROP TABLE IF EXISTS task; DROP TABLE IF EXISTS doc;",
    )?;
    conn.execute_batch(SCHEMA)?;
    conn.pragma_update(None, "user_version", VERSION)?;
    Ok(())
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DocRow {
    pub id: String,
    pub kind: &'static str,
    pub rel_path: String,
    pub day: Option<String>,
    pub horizon: Option<String>,
    pub period_start: Option<String>,
    pub title: String,
    pub content_md: String,
    pub excerpt: String,
    pub word_count: i64,
    pub pinned: bool,
    pub archived: bool,
    pub category: Option<String>,
    pub archived_at: Option<i64>,
    pub created_at: i64,
    pub updated_at: i64,
    pub mtime: i64,
    pub size: i64,
    pub hash: String,
}

const COLUMNS: &str = "id, kind, rel_path, day, horizon, period_start, title, content_md, excerpt,
    word_count, is_pinned, is_archived, archive_category, archived_at, created_at, updated_at,
    mtime, size, hash";

fn row(r: &Row) -> rusqlite::Result<DocRow> {
    let kind: String = r.get("kind")?;
    Ok(DocRow {
        id: r.get("id")?,
        kind: match kind.as_str() {
            "day" => "day",
            "goal" => "goal",
            _ => "note",
        },
        rel_path: r.get("rel_path")?,
        day: r.get("day")?,
        horizon: r.get("horizon")?,
        period_start: r.get("period_start")?,
        title: r.get("title")?,
        content_md: r.get("content_md")?,
        excerpt: r.get("excerpt")?,
        word_count: r.get("word_count")?,
        pinned: r.get::<_, i64>("is_pinned")? != 0,
        archived: r.get::<_, i64>("is_archived")? != 0,
        category: r.get("archive_category")?,
        archived_at: r.get("archived_at")?,
        created_at: r.get("created_at")?,
        updated_at: r.get("updated_at")?,
        mtime: r.get("mtime")?,
        size: r.get("size")?,
        hash: r.get("hash")?,
    })
}

fn one(conn: &Connection, filter: &str, args: impl rusqlite::Params) -> Result<Option<DocRow>> {
    Ok(conn
        .query_row(&format!("SELECT {COLUMNS} FROM doc WHERE {filter}"), args, row)
        .optional()?)
}

fn many(conn: &Connection, rest: &str, args: impl rusqlite::Params) -> Result<Vec<DocRow>> {
    let mut stmt = conn.prepare(&format!("SELECT {COLUMNS} FROM doc {rest}"))?;
    let rows = stmt.query_map(args, row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn by_id(conn: &Connection, id: &str) -> Result<Option<DocRow>> {
    one(conn, "id = ?1", params![id])
}

pub fn by_path(conn: &Connection, rel: &str) -> Result<Option<DocRow>> {
    one(conn, "rel_path = ?1", params![rel])
}

pub fn day(conn: &Connection, date: &str) -> Result<Option<DocRow>> {
    one(conn, "kind = 'day' AND day = ?1", params![date])
}

pub fn goal(conn: &Connection, horizon: &str, period_start: &str) -> Result<Option<DocRow>> {
    one(
        conn,
        "kind = 'goal' AND horizon = ?1 AND period_start = ?2",
        params![horizon, period_start],
    )
}

/// 笔记 / 归档列表：置顶在前，再按更新 / 归档时间倒序
pub fn notes(conn: &Connection, archived: bool) -> Result<Vec<DocRow>> {
    let order = if archived {
        "is_pinned DESC, COALESCE(archived_at, updated_at) DESC"
    } else {
        "is_pinned DESC, updated_at DESC"
    };
    many(
        conn,
        &format!("WHERE kind = 'note' AND is_archived = ?1 ORDER BY {order}, rel_path"),
        params![archived as i64],
    )
}

/// 之前最近一天写过东西的（今日TODO 的延续）
pub fn latest_day_before(conn: &Connection, date: &str) -> Result<Option<DocRow>> {
    one(
        conn,
        "kind = 'day' AND day < ?1 AND (title != '' OR content_md != '')
         ORDER BY day DESC LIMIT 1",
        params![date],
    )
}

/// 扫描用：已索引的每个文件的 (路径, mtime, size)
pub fn file_states(conn: &Connection) -> Result<Vec<(String, i64, i64)>> {
    let mut stmt = conn.prepare("SELECT rel_path, mtime, size FROM doc")?;
    let rows = stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn id_taken(conn: &Connection, id: &str, except_path: &str) -> Result<bool> {
    let n: i64 = conn.query_row(
        "SELECT count(*) FROM doc WHERE id = ?1 AND rel_path != ?2",
        params![id, except_path],
        |r| r.get(0),
    )?;
    Ok(n > 0)
}

/// 写入（或替换）一篇文档，连同它的任务和全文索引。同一个 id 或同一个路径的旧行先删掉。
pub fn put(
    conn: &Connection,
    doc: &DocRow,
    tasks: &[ScheduledTask],
    fts: Option<(&str, &str)>,
) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    for old in tx
        .prepare("SELECT id FROM doc WHERE id = ?1 OR rel_path = ?2")?
        .query_map(params![doc.id, doc.rel_path], |r| r.get::<_, String>(0))?
        .collect::<rusqlite::Result<Vec<_>>>()?
    {
        delete_rows(&tx, &old)?;
    }
    tx.execute(
        &format!("INSERT INTO doc ({COLUMNS}) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)"),
        params![
            doc.id,
            doc.kind,
            doc.rel_path,
            doc.day,
            doc.horizon,
            doc.period_start,
            doc.title,
            doc.content_md,
            doc.excerpt,
            doc.word_count,
            doc.pinned as i64,
            doc.archived as i64,
            doc.category,
            doc.archived_at,
            doc.created_at,
            doc.updated_at,
            doc.mtime,
            doc.size,
            doc.hash,
        ],
    )?;
    for task in tasks {
        tx.execute(
            "INSERT INTO task (id, doc_id, line, raw, title, done, due_date, time_label, category)
             VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)",
            params![
                task_id(&doc.id, task.line),
                doc.id,
                task.line as i64,
                task.raw,
                task.title,
                task.done as i64,
                task.due_date,
                task.time_label,
                task.category,
            ],
        )?;
    }
    if let Some((title, tokens)) = fts {
        tx.execute(
            "INSERT INTO doc_fts (id, title, tokens) VALUES (?1, ?2, ?3)",
            params![doc.id, title, tokens],
        )?;
    }
    tx.commit()?;
    Ok(())
}

/// 只更新文件状态（内容没变，比如 mtime 被别的程序碰了一下）
pub fn touch(conn: &Connection, id: &str, mtime: i64, size: i64) -> Result<()> {
    conn.execute(
        "UPDATE doc SET mtime = ?1, size = ?2, updated_at = ?1 WHERE id = ?3",
        params![mtime, size, id],
    )?;
    Ok(())
}

/// 文件改名 / 挪位置之后，先让索引跟上，再写新内容 —— 否则按新路径写入时
/// 旧路径那一行还占着同一个 id，新文件会被当成一篇重复的笔记。
/// 指纹清掉：标题可能来自文件名、归档与否来自位置，内容一样也得重新解析。
pub fn rename(conn: &Connection, id: &str, rel: &str) -> Result<()> {
    conn.execute(
        "UPDATE doc SET rel_path = ?1, hash = '' WHERE id = ?2",
        params![rel, id],
    )?;
    Ok(())
}

pub fn remove(conn: &Connection, id: &str) -> Result<()> {
    let tx = conn.unchecked_transaction()?;
    delete_rows(&tx, id)?;
    tx.commit()?;
    Ok(())
}

fn delete_rows(conn: &Connection, id: &str) -> Result<()> {
    conn.execute("DELETE FROM task WHERE doc_id = ?1", params![id])?;
    conn.execute("DELETE FROM doc_fts WHERE id = ?1", params![id])?;
    conn.execute("DELETE FROM doc WHERE id = ?1", params![id])?;
    Ok(())
}

pub fn task_id(doc_id: &str, line: usize) -> String {
    format!("{doc_id}#{line}")
}

/// 一篇文档当前索引里的任务，用来判断这次写入有没有改到日历
pub fn doc_tasks(conn: &Connection, doc_id: &str) -> Result<Vec<ScheduledTask>> {
    let mut stmt = conn.prepare(
        "SELECT line, raw, title, done, due_date, time_label, category
         FROM task WHERE doc_id = ?1 ORDER BY line",
    )?;
    let rows = stmt.query_map(params![doc_id], |r| {
        Ok(ScheduledTask {
            line: r.get::<_, i64>(0)? as usize,
            raw: r.get(1)?,
            title: r.get(2)?,
            done: r.get::<_, i64>(3)? != 0,
            due_date: r.get(4)?,
            time_label: r.get(5)?,
            category: r.get(6)?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

/// 日历上的一条任务，带着它所在的文档
#[derive(Debug, Clone)]
pub struct TaskRow {
    pub id: String,
    pub doc_id: String,
    pub line: usize,
    pub raw: String,
    pub title: String,
    pub done: bool,
    pub due_date: String,
    pub time_label: Option<String>,
    pub category: Option<String>,
    pub doc_kind: &'static str,
    pub doc_title: String,
    pub doc_day: Option<String>,
    pub doc_horizon: Option<String>,
    pub doc_period_start: Option<String>,
}

const TASK_COLUMNS: &str = "t.id, t.doc_id, t.line, t.raw, t.title, t.done, t.due_date,
    t.time_label, t.category, d.kind, d.title AS doc_title, d.day, d.horizon, d.period_start";

fn task_row(r: &Row) -> rusqlite::Result<TaskRow> {
    let kind: String = r.get("kind")?;
    Ok(TaskRow {
        id: r.get("id")?,
        doc_id: r.get("doc_id")?,
        line: r.get::<_, i64>("line")? as usize,
        raw: r.get("raw")?,
        title: r.get("title")?,
        done: r.get::<_, i64>("done")? != 0,
        due_date: r.get("due_date")?,
        time_label: r.get("time_label")?,
        category: r.get("category")?,
        doc_kind: match kind.as_str() {
            "day" => "day",
            "goal" => "goal",
            _ => "note",
        },
        doc_title: r.get("doc_title")?,
        doc_day: r.get("day")?,
        doc_horizon: r.get("horizon")?,
        doc_period_start: r.get("period_start")?,
    })
}

/// 某一天的任务。那一天自己的文档里写的不算 —— 它们就在正文里，不用再列一遍。
/// 归档笔记里的也不算。先列没写时间的，再按一天里的先后（上午算 9 点、下午 14 点…）。
pub fn tasks_due(conn: &Connection, date: &str) -> Result<Vec<TaskRow>> {
    let mut stmt = conn.prepare(&format!(
        "SELECT {TASK_COLUMNS} FROM task t JOIN doc d ON d.id = t.doc_id
         WHERE t.due_date = ?1 AND NOT (d.kind = 'day' AND d.day = ?1) AND d.is_archived = 0
         ORDER BY t.time_label IS NOT NULL,
           CASE t.time_label
             WHEN '全天' THEN '00:00' WHEN '上午' THEN '09:00' WHEN '中午' THEN '12:00'
             WHEN '下午' THEN '14:00' WHEN '晚上' THEN '19:00'
             ELSE substr('0' || t.time_label, -5)
           END,
           d.rel_path, t.line"
    ))?;
    let rows = stmt.query_map(params![date], task_row)?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub fn task(conn: &Connection, id: &str) -> Result<Option<TaskRow>> {
    Ok(conn
        .query_row(
            &format!("SELECT {TASK_COLUMNS} FROM task t JOIN doc d ON d.id = t.doc_id WHERE t.id = ?1"),
            params![id],
            task_row,
        )
        .optional()?)
}

/// 日历上要标小圆点的日期：写过东西的日子，和有任务的日子
pub fn marked_dates(conn: &Connection, from: &str, to: &str) -> Result<Vec<String>> {
    let mut stmt = conn.prepare(
        "SELECT DISTINCT d FROM (
           SELECT day AS d FROM doc WHERE kind = 'day' AND (title != '' OR content_md != '')
           UNION
           SELECT t.due_date AS d FROM task t JOIN doc x ON x.id = t.doc_id WHERE x.is_archived = 0
         )
         WHERE d BETWEEN ?1 AND ?2
         ORDER BY d",
    )?;
    let rows = stmt.query_map(params![from, to], |r| r.get::<_, String>(0))?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub struct Hit {
    pub doc: DocRow,
    pub score: f64,
}

/// 全文搜索：标题权重 10 倍。bm25 越小越相关。
pub fn search(conn: &Connection, match_query: &str, limit: u32) -> Result<Vec<Hit>> {
    let columns = COLUMNS
        .split(',')
        .map(|column| format!("d.{}", column.trim()))
        .collect::<Vec<_>>()
        .join(", ");
    let mut stmt = conn.prepare(&format!(
        "SELECT {columns}, bm25(doc_fts, 0.0, 10.0, 1.0) AS score
         FROM doc_fts JOIN doc d ON d.id = doc_fts.id
         WHERE doc_fts MATCH ?1 AND d.kind = 'note'
         ORDER BY score LIMIT ?2"
    ))?;
    let rows = stmt.query_map(params![match_query, limit], |r| {
        Ok(Hit {
            doc: row(r)?,
            score: r.get("score")?,
        })
    })?;
    Ok(rows.collect::<rusqlite::Result<Vec<_>>>()?)
}

pub struct Counts {
    pub notes: i64,
    pub archived: i64,
    pub days: i64,
    pub goals: i64,
    pub tasks: i64,
}

pub fn counts(conn: &Connection) -> Result<Counts> {
    let one = |sql: &str| -> Result<i64> { Ok(conn.query_row(sql, [], |r| r.get(0))?) };
    Ok(Counts {
        notes: one("SELECT count(*) FROM doc WHERE kind = 'note' AND is_archived = 0")?,
        archived: one("SELECT count(*) FROM doc WHERE kind = 'note' AND is_archived = 1")?,
        days: one("SELECT count(*) FROM doc WHERE kind = 'day'")?,
        goals: one("SELECT count(*) FROM doc WHERE kind = 'goal'")?,
        tasks: one("SELECT count(*) FROM task")?,
    })
}
