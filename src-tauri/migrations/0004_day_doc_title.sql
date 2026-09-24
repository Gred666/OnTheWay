-- 日历的每一天也是一篇带标题的文档：标题和笔记一样可以直接改。
ALTER TABLE day_doc ADD COLUMN title TEXT NOT NULL DEFAULT '';

-- 「今日TODO」不再是一篇藏起来的特殊笔记（n-today），而就是今天这一天的
-- day_doc。把旧的 n-today 挪进它最后编辑的那一天；那天已有备注的话接在后面。
INSERT INTO day_doc (date, title, note_md, created_at, updated_at)
SELECT date(updated_at / 1000, 'unixepoch', 'localtime'),
       title, content_md, created_at, updated_at
FROM note
WHERE id = 'n-today' AND deleted_at IS NULL
ON CONFLICT(date) DO UPDATE SET
  title      = excluded.title,
  note_md    = CASE
                 WHEN trim(day_doc.note_md) = '' THEN excluded.note_md
                 ELSE rtrim(excluded.note_md) || char(10) || char(10) || ltrim(day_doc.note_md)
               END,
  updated_at = max(day_doc.updated_at, excluded.updated_at);

UPDATE note
SET deleted_at = CAST(strftime('%s', 'now') AS INTEGER) * 1000
WHERE id = 'n-today' AND deleted_at IS NULL;
