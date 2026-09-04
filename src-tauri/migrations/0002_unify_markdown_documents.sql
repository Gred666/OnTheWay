-- GOAL 曾把同一篇 Markdown 拆成 description_md / after_md，造成编辑器与
-- 展示层双轨。合并为唯一正文列，并物理删除旧列，避免旧数据继续分叉。
CREATE TABLE goal_unified (
  id            TEXT    PRIMARY KEY,
  title         TEXT    NOT NULL,
  horizon       TEXT    NOT NULL CHECK (horizon IN ('week','month','year')),
  period_start  TEXT    NOT NULL,
  content_md    TEXT    NOT NULL DEFAULT '',
  action_title  TEXT,
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER,
  UNIQUE (horizon, period_start)
);

INSERT INTO goal_unified (
  id, title, horizon, period_start, content_md, action_title,
  created_at, updated_at, deleted_at
)
SELECT id, title, horizon, period_start,
       CASE
         WHEN trim(after_md) = '' THEN description_md
         WHEN trim(description_md) = '' THEN after_md
         ELSE rtrim(description_md) || char(10) || char(10) || ltrim(after_md)
       END,
       action_title, created_at, updated_at, deleted_at
FROM goal;

DROP TABLE goal;
ALTER TABLE goal_unified RENAME TO goal;
CREATE INDEX idx_goal_horizon ON goal(horizon, period_start DESC);
