-- 旧版把正文后的「行动项」做成不可编辑的独立区块。把可见内容迁回
-- Markdown 清单，然后删除关联数据；此后整篇文档只有一个编辑面。
UPDATE note
SET content_md = rtrim(content_md) || char(10) || char(10) ||
                 '## ' || action_title || char(10) || char(10) ||
                 COALESCE((
                   SELECT group_concat(line, char(10))
                   FROM (
                     SELECT '- [' || CASE WHEN t.status = 'done' THEN 'x' ELSE ' ' END || '] ' || t.title AS line
                     FROM link l JOIN task t ON t.id = l.dst_id
                     WHERE l.src_type = 'note' AND l.src_id = note.id
                       AND l.kind = 'action' AND t.deleted_at IS NULL
                     ORDER BY l.sort_key
                   )
                 ), '')
WHERE action_title IS NOT NULL
  AND EXISTS (SELECT 1 FROM link WHERE src_type='note' AND src_id=note.id AND kind='action');

UPDATE goal
SET content_md = rtrim(content_md) || char(10) || char(10) ||
                 '## ' || action_title || char(10) || char(10) ||
                 COALESCE((
                   SELECT group_concat(line, char(10))
                   FROM (
                     SELECT '- [' || CASE WHEN t.status = 'done' THEN 'x' ELSE ' ' END || '] ' || t.title AS line
                     FROM link l JOIN task t ON t.id = l.dst_id
                     WHERE l.src_type = 'goal' AND l.src_id = goal.id
                       AND l.kind = 'action' AND t.deleted_at IS NULL
                     ORDER BY l.sort_key
                   )
                 ), '')
WHERE action_title IS NOT NULL
  AND EXISTS (SELECT 1 FROM link WHERE src_type='goal' AND src_id=goal.id AND kind='action');

CREATE TEMP TABLE removed_action_tasks AS
SELECT DISTINCT dst_id FROM link WHERE kind='action' AND src_type IN ('note','goal');

DELETE FROM link WHERE kind='action' AND src_type IN ('note','goal');
DELETE FROM task
WHERE id IN (SELECT dst_id FROM removed_action_tasks)
  AND NOT EXISTS (SELECT 1 FROM link WHERE link.dst_type='task' AND link.dst_id=task.id);
DROP TABLE removed_action_tasks;

UPDATE note SET action_title = NULL;
UPDATE goal SET action_title = NULL;
