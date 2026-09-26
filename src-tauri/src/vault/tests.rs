use std::sync::Mutex;

use super::*;

struct Fixture {
    _dir: tempfile::TempDir,
    root: PathBuf,
    vault: Vault,
    announced: Arc<Mutex<Vec<VaultChange>>>,
}

fn fixture() -> Fixture {
    let dir = tempfile::tempdir().unwrap();
    let root = dir.path().join("仓库");
    let mut vault = Vault::open_in_memory(&root);
    let announced = Arc::new(Mutex::new(Vec::new()));
    let sink = announced.clone();
    vault.set_announcer(Arc::new(move |change| sink.lock().unwrap().push(change)));
    Fixture {
        _dir: dir,
        root,
        vault,
        announced,
    }
}

impl Fixture {
    fn read(&self, rel: &str) -> String {
        std::fs::read_to_string(fsio::abs(&self.root, rel)).unwrap()
    }

    fn exists(&self, rel: &str) -> bool {
        fsio::abs(&self.root, rel).exists()
    }

    fn files(&self) -> Vec<String> {
        fsio::walk_markdown(&self.root)
            .into_iter()
            .map(|file| file.rel)
            .collect()
    }

    /// 模拟别的程序改文件：修改时间往后挪一秒，保证和索引里的不一样
    fn write_externally(&self, rel: &str, text: &str) {
        let path = fsio::abs(&self.root, rel);
        let before = fsio::stat(&path).map_or(0, |(mtime, _)| mtime);
        fsio::write_atomic(&path, text).unwrap();
        fsio::set_mtime(&path, before + 1000).unwrap();
    }

    fn take_announced(&self) -> Vec<VaultChange> {
        std::mem::take(&mut *self.announced.lock().unwrap())
    }
}

/* ---------------- 笔记 ---------------- */

#[test]
fn a_note_is_a_markdown_file_named_after_its_title() {
    let mut f = fixture();
    let id = f.vault.note_create("周末采购", "- 燕麦奶").unwrap();
    assert_eq!(f.files(), vec!["笔记/周末采购.md"]);
    let text = f.read("笔记/周末采购.md");
    assert!(text.starts_with(&format!("---\nid: {id}\ncreated: ")));
    assert!(text.ends_with("---\n\n- 燕麦奶"));
    assert!(!text.contains("title:"), "文件名就是标题时不用再写一遍");

    let note = f.vault.note_get(&id).unwrap();
    assert_eq!(note.title, "周末采购");
    assert_eq!(note.content_md, "- 燕麦奶");
    assert!(note.word_count > 0);
}

#[test]
fn same_titles_get_numbered_files_but_keep_their_titles() {
    let mut f = fixture();
    let first = f.vault.note_create("无标题笔记", "").unwrap();
    let second = f.vault.note_create("无标题笔记", "").unwrap();
    assert_eq!(f.files(), vec!["笔记/无标题笔记 2.md", "笔记/无标题笔记.md"]);
    assert_eq!(f.vault.note_get(&first).unwrap().title, "无标题笔记");
    assert_eq!(f.vault.note_get(&second).unwrap().title, "无标题笔记");
    assert!(f.read("笔记/无标题笔记 2.md").contains("title: \"无标题笔记\""));
}

#[test]
fn renaming_a_note_renames_its_file_and_keeps_the_id() {
    let mut f = fixture();
    let id = f.vault.note_create("初稿", "正文").unwrap();
    f.vault.note_update(&id, "周报: 第 3 期", "正文改了").unwrap();

    assert_eq!(f.files(), vec!["笔记/周报： 第 3 期.md"]);
    let note = f.vault.note_get(&id).unwrap();
    assert_eq!(note.title, "周报: 第 3 期");
    assert_eq!(note.content_md, "正文改了");
    assert!(f.read("笔记/周报： 第 3 期.md").contains(&format!("id: {id}\n")));

    // 只改大小写（Windows 上是同一个文件名）
    f.vault.note_update(&id, "Weekly", "x").unwrap();
    f.vault.note_update(&id, "weekly", "x").unwrap();
    assert_eq!(f.files(), vec!["笔记/weekly.md"]);
    assert_eq!(f.vault.note_get(&id).unwrap().title, "weekly");
}

#[test]
fn saving_keeps_front_matter_written_by_other_tools() {
    let mut f = fixture();
    f.write_externally(
        "笔记/京都.md",
        "---\ntags:\n  - 旅行\naliases: [Kyoto]\n---\n\n书店",
    );
    f.vault.rescan().unwrap();
    let note = &f.vault.note_list_full(false).unwrap()[0];
    assert_eq!(note.title, "京都");
    assert_eq!(note.content_md, "书店");

    f.vault.note_update(&note.id, "京都", "书店和咖啡").unwrap();
    let text = f.read("笔记/京都.md");
    assert!(text.contains(&format!("id: {}\n", note.id)), "没有 id 的文件第一次保存时写进去");
    assert!(text.contains("tags:\n  - 旅行\naliases: [Kyoto]\n"), "别的工具的属性丢了: {text}");
    assert!(text.ends_with("书店和咖啡"));
}

#[test]
fn pin_archive_restore_move_the_file() {
    let mut f = fixture();
    let id = f.vault.note_create("路线图", "内容").unwrap();

    f.vault.note_set_pinned(&id, true).unwrap();
    assert!(f.read("笔记/路线图.md").contains("pinned: true\n"));
    assert!(f.vault.note_get(&id).unwrap().is_pinned);

    f.vault.note_archive(&id, Some("工作笔记".into())).unwrap();
    assert_eq!(f.files(), vec!["归档/路线图.md"]);
    let archived = f.vault.note_get(&id).unwrap();
    assert!(archived.is_archived);
    assert!(!archived.is_pinned, "归档清掉置顶");
    assert_eq!(archived.archive_category.as_deref(), Some("工作笔记"));
    assert!(archived.archived_at.is_some());
    assert!(f.vault.note_list_full(false).unwrap().is_empty());
    assert_eq!(f.vault.note_list_full(true).unwrap().len(), 1);

    f.vault.note_restore(&id).unwrap();
    assert_eq!(f.files(), vec!["笔记/路线图.md"]);
    let restored = f.vault.note_get(&id).unwrap();
    assert!(!restored.is_archived);
    assert!(restored.archived_at.is_none());
    assert_eq!(restored.content_md, "内容");
}

#[test]
fn delete_goes_to_the_trash_and_undo_puts_it_back() {
    let mut f = fixture();
    std::fs::create_dir_all(fsio::abs(&f.root, "笔记/工作")).unwrap();
    f.write_externally("笔记/工作/周报.md", "内容");
    f.vault.rescan().unwrap();
    let id = f.vault.note_list_full(false).unwrap()[0].id.clone();

    f.vault.note_delete(&id).unwrap();
    assert!(f.files().is_empty());
    assert!(matches!(f.vault.note_get(&id), Err(AppError::NotFound(_))));
    assert!(!f.exists("笔记/工作"), "挪空的子文件夹顺手删掉");
    assert!(f.exists(&format!(".ontheway/trash/{id}.md")));

    f.vault.note_undelete(&id).unwrap();
    assert_eq!(f.files(), vec!["笔记/工作/周报.md"], "放回原来的文件夹");
    assert_eq!(f.vault.note_get(&id).unwrap().content_md, "内容");
    assert!(!f.read("笔记/工作/周报.md").contains("trashed-from"));
    assert!(matches!(
        f.vault.note_undelete(&id),
        Err(AppError::NotFound(_))
    ));
}

#[test]
fn old_trash_is_purged() {
    let mut f = fixture();
    let id = f.vault.note_create("临时", "x").unwrap();
    f.vault.note_delete(&id).unwrap();
    let trashed = fsio::abs(&f.root, &format!(".ontheway/trash/{id}.md"));
    fsio::set_mtime(&trashed, now_ms() - 31 * 86_400_000).unwrap();
    f.vault.purge_trash(30 * 86_400_000);
    assert!(!trashed.exists());
}

#[test]
fn search_finds_two_character_chinese_words() {
    let mut f = fixture();
    f.vault
        .note_create("秋季项目复盘", "这一周把季度目标推进到可以交付的状态。")
        .unwrap();
    f.vault.note_create("周末采购", "燕麦奶、灯泡、咖啡豆。").unwrap();
    let result = f.vault.search("季度", 10).unwrap();
    assert_eq!(result.hits.len(), 1);
    assert_eq!(result.hits[0].title, "秋季项目复盘");
    assert!(f.vault.search("   ", 10).unwrap().hits.is_empty());
}

/* ---------------- 某一天 ---------------- */

#[test]
fn a_day_lives_in_the_diary_folder_and_empty_days_leave_no_file() {
    let mut f = fixture();
    let saved = f.vault.save_day("2026-09-26", "周六", "- [ ] 跑步").unwrap();
    assert_eq!(saved.title, "周六");
    assert_eq!(
        f.read("日记/2026/2026-09-26.md"),
        "---\ntitle: \"周六\"\n---\n\n- [ ] 跑步"
    );

    f.vault.save_day("2026-09-26", "", "只有正文").unwrap();
    assert_eq!(f.read("日记/2026/2026-09-26.md"), "只有正文");

    f.vault.save_day("2026-09-26", "", "").unwrap();
    assert!(f.files().is_empty());
    assert!(!f.exists("日记/2026"), "空了的年份文件夹也删掉");
    assert!(f.vault.marked_dates("2026-01-01", "2026-12-31").unwrap().is_empty());
}

#[test]
fn today_carries_over_from_the_latest_written_day_without_writing() {
    let mut f = fixture();
    f.vault.save_day("2026-08-27", "周四的 TODO", "- [ ] 跑步").unwrap();
    f.vault.save_day("2026-08-25", "更早的", "旧").unwrap();

    let today = f.vault.day("2026-08-29", true).unwrap();
    assert_eq!(today.title, "周四的 TODO");
    assert_eq!(today.note_md, "- [ ] 跑步");
    assert_eq!(today.carried_from.as_deref(), Some("2026-08-27"));
    assert!(!f.exists("日记/2026/2026-08-29.md"), "延续不等于写入");
    assert!(f.vault.day("2026-08-28", false).unwrap().carried_from.is_none());

    f.vault.save_day("2026-08-29", "今天", "新的").unwrap();
    let own = f.vault.day("2026-08-29", true).unwrap();
    assert_eq!(own.title, "今天");
    assert!(own.carried_from.is_none());
}

/* ---------------- 目标 ---------------- */

#[test]
fn goals_are_one_file_per_period() {
    let mut f = fixture();
    let empty = f.vault.goal("week", "2026-09-21").unwrap();
    assert_eq!(empty.id, "");
    assert_eq!(empty.updated_at, 0);

    let saved = f.vault.save_goal("week", "2026-09-21", "# 本周").unwrap();
    assert!(!saved.id.is_empty());
    assert_eq!(f.read("目标/2026/2026-W39.md"), "# 本周");
    let again = f.vault.save_goal("week", "2026-09-21", "# 本周\n\n改了").unwrap();
    assert_eq!(again.id, saved.id);
    assert_eq!(f.files(), vec!["目标/2026/2026-W39.md"]);

    assert!(matches!(
        f.vault.goal("week", "2026-09-22"),
        Err(AppError::Invalid(_))
    ));
    f.vault.save_goal("week", "2026-09-21", "  ").unwrap();
    assert!(f.files().is_empty());
}

/* ---------------- 任务 ---------------- */

#[test]
fn dated_tasks_anywhere_show_up_on_their_day() {
    let mut f = fixture();
    let note = f
        .vault
        .note_create("复盘", "## 行动\n\n- [ ] 交稿 @2026-09-04 16:00 #写作\n- [ ] 没日期的")
        .unwrap();
    f.vault
        .save_day("2026-09-04", "", "- [ ] 那天自己写的 @2026-09-04")
        .unwrap();

    let day = f.vault.day("2026-09-04", false).unwrap();
    assert_eq!(day.tasks.len(), 1, "那一天自己的任务就在正文里，不再列一遍");
    let task = &day.tasks[0];
    assert_eq!(task.title, "交稿");
    assert_eq!(task.meta.as_deref(), Some("写作 · 16:00 · 复盘"));
    assert_eq!(
        f.vault.marked_dates("2026-09-01", "2026-09-30").unwrap(),
        vec!["2026-09-04"]
    );

    // 归档笔记里的任务不进日历
    f.vault.note_archive(&note, None).unwrap();
    assert!(f.vault.day("2026-09-04", false).unwrap().tasks.is_empty());
}

#[test]
fn toggling_a_task_edits_its_line_in_the_source_file() {
    let mut f = fixture();
    let note = f
        .vault
        .note_create("复盘", "开头\n\n- [ ] 交稿 @2026-09-04")
        .unwrap();
    let task_id = f.vault.day("2026-09-04", false).unwrap().tasks[0].id.clone();
    f.take_announced();

    let toggled = f.vault.toggle_task(&task_id).unwrap();
    assert_eq!(toggled.status, "done");
    assert!(f.read("笔记/复盘.md").ends_with("- [x] 交稿 @2026-09-04"));
    assert_eq!(
        f.vault.note_get(&note).unwrap().content_md,
        "开头\n\n- [x] 交稿 @2026-09-04"
    );
    // 前端手里这篇的正文过时了：通知里要有它，日历也要刷新
    let announced = f.take_announced();
    assert!(announced.iter().any(|change| change.notes.contains(&note) && change.tasks));

    let back = f.vault.toggle_task(&toggled.id).unwrap();
    assert_eq!(back.status, "todo");
}

#[test]
fn toggling_follows_the_line_when_the_file_changed_above_it() {
    let mut f = fixture();
    let note = f.vault.note_create("复盘", "- [ ] 交稿 @2026-09-04").unwrap();
    let task_id = f.vault.day("2026-09-04", false).unwrap().tasks[0].id.clone();
    // 外部在上面插了两行，监听还没来得及处理
    let text = f.read("笔记/复盘.md").replace("- [ ] 交稿", "新的一行\n\n- [ ] 交稿");
    f.write_externally("笔记/复盘.md", &text);

    f.vault.toggle_task(&task_id).unwrap();
    assert!(f.read("笔记/复盘.md").ends_with("新的一行\n\n- [x] 交稿 @2026-09-04"));
    assert_eq!(
        f.vault.note_get(&note).unwrap().content_md,
        "新的一行\n\n- [x] 交稿 @2026-09-04"
    );
}

#[test]
fn saving_a_document_that_changes_its_dated_tasks_tells_the_calendar() {
    let mut f = fixture();
    let id = f.vault.note_create("复盘", "正文").unwrap();
    f.take_announced();

    f.vault.note_update(&id, "复盘", "正文\n\n- [ ] 交稿 @2026-09-04").unwrap();
    let announced = f.take_announced();
    assert_eq!(announced.len(), 1);
    assert!(announced[0].tasks);
    assert!(announced[0].notes.is_empty(), "前端自己存的那篇不用再通知回去");

    // 没碰到带日期的任务：不打扰
    f.vault
        .note_update(&id, "复盘", "正文改了\n\n- [ ] 交稿 @2026-09-04")
        .unwrap();
    assert!(f.take_announced().is_empty());
}

/* ---------------- 外部改动与冲突 ---------------- */

#[test]
fn saving_over_an_unseen_external_edit_keeps_both_versions() {
    let mut f = fixture();
    let id = f.vault.note_create("周报", "原来的").unwrap();
    let theirs = f.read("笔记/周报.md").replace("原来的", "别处改的");
    f.write_externally("笔记/周报.md", &theirs);

    f.vault.note_update(&id, "周报", "我改的").unwrap();

    let files = f.files();
    assert_eq!(files.len(), 2, "{files:?}");
    assert_eq!(f.vault.note_get(&id).unwrap().content_md, "我改的");
    let copy = files.iter().find(|rel| rel.contains("冲突")).unwrap();
    assert!(f.read(copy).ends_with("别处改的"));
    assert!(!f.read(copy).contains(&id), "冲突副本是另一篇笔记，不能和原文抢 id");
    let announced = f.take_announced();
    assert_eq!(announced.len(), 1);
    assert_eq!(announced[0].conflicts.len(), 1);
    assert_eq!(announced[0].notes.len(), 1, "新出现的冲突副本要进列表");
}

#[test]
fn keeping_a_conflict_copy_on_request() {
    let mut f = fixture();
    f.vault.save_day("2026-09-26", "", "磁盘上的").unwrap();
    let title = f
        .vault
        .keep_conflict_copy(&DocTarget::Day {
            id: "2026-09-26".into(),
        })
        .unwrap()
        .unwrap();
    assert!(title.starts_with("2026-09-26 (冲突 "));
    // 冲突副本不是日期，是一篇普通笔记
    let notes = f.vault.note_list_full(false).unwrap();
    assert_eq!(notes.len(), 1);
    assert_eq!(notes[0].content_md, "磁盘上的");
    assert_eq!(f.vault.day("2026-09-26", false).unwrap().note_md, "磁盘上的");
}

#[test]
fn rescan_picks_up_external_adds_edits_renames_and_deletes() {
    let mut f = fixture();
    f.write_externally("笔记/外面写的.md", "---\nid: ext1\n---\n\n你好");
    f.write_externally("日记/2026/2026-09-26.md", "今天");
    let change = f.vault.rescan().unwrap();
    assert_eq!(change.notes, vec!["ext1"]);
    assert_eq!(change.days, vec!["2026-09-26"]);

    // 没变的文件不再报
    assert!(f.vault.rescan().unwrap().is_empty());

    std::fs::rename(
        fsio::abs(&f.root, "笔记/外面写的.md"),
        fsio::abs(&f.root, "笔记/改了名.md"),
    )
    .unwrap();
    let change = f.vault.rescan().unwrap();
    assert_eq!(change.notes, vec!["ext1"], "改名是同一篇");
    assert_eq!(f.vault.note_get("ext1").unwrap().title, "改了名");

    std::fs::remove_file(fsio::abs(&f.root, "日记/2026/2026-09-26.md")).unwrap();
    let change = f.vault.rescan().unwrap();
    assert_eq!(change.days, vec!["2026-09-26"]);
    assert!(f.vault.day("2026-09-26", false).unwrap().note_md.is_empty());
}

#[test]
fn a_copied_file_with_the_same_id_becomes_its_own_note() {
    let mut f = fixture();
    let id = f.vault.note_create("原件", "内容").unwrap();
    let text = f.read("笔记/原件.md");
    f.write_externally("笔记/原件 - 副本.md", &text);
    f.vault.rescan().unwrap();

    let notes = f.vault.note_list_full(false).unwrap();
    assert_eq!(notes.len(), 2);
    assert!(notes.iter().any(|note| note.id == id && note.title == "原件"));
    assert!(notes.iter().any(|note| note.id != id && note.title == "原件 - 副本"));
}

#[test]
fn the_index_can_be_thrown_away_and_rebuilt_from_files() {
    let mut f = fixture();
    let id = f.vault.note_create("周报: 第 3 期", "内容 @x").unwrap();
    f.vault.note_set_pinned(&id, true).unwrap();
    f.vault.save_day("2026-09-26", "周六", "- [ ] 跑步").unwrap();
    f.vault.save_goal("month", "2026-09-01", "九月").unwrap();
    let before = (
        f.vault.note_list_full(false).unwrap()[0].clone(),
        f.vault.day("2026-09-26", false).unwrap(),
        f.vault.goal("month", "2026-09-01").unwrap(),
    );

    let rebuilt = Vault::open_in_memory(&f.root);
    let note = rebuilt.note_get(&id).unwrap();
    assert_eq!(note.title, before.0.title);
    assert_eq!(note.is_pinned, before.0.is_pinned);
    assert_eq!(note.created_at, before.0.created_at);
    assert_eq!(note.updated_at, before.0.updated_at);
    assert_eq!(rebuilt.day("2026-09-26", false).unwrap().title, before.1.title);
    assert_eq!(rebuilt.goal("month", "2026-09-01").unwrap().id, before.2.id);
}

#[test]
fn locates_files_for_revealing_them() {
    let mut f = fixture();
    let id = f.vault.note_create("周报", "x").unwrap();
    let (path, is_file) = f.vault.locate(&DocTarget::Note { id }).unwrap();
    assert!(is_file);
    assert_eq!(path, fsio::abs(&f.root, "笔记/周报.md"));

    // 还没写过的某一天：给它将来所在的、已经存在的那一层
    let (path, is_file) = f
        .vault
        .locate(&DocTarget::Day {
            id: "2030-01-01".into(),
        })
        .unwrap();
    assert!(!is_file);
    assert_eq!(path, f.root);
}

#[test]
fn activity_is_logged_as_json_lines() {
    let mut f = fixture();
    let id = f.vault.note_create("复盘", "- [ ] 交稿 @2026-09-04").unwrap();
    let task = f.vault.day("2026-09-04", false).unwrap().tasks[0].id.clone();
    f.vault.toggle_task(&task).unwrap();
    f.vault.note_archive(&id, None).unwrap();

    let entries = activity::read_all(&fsio::abs(&f.root, layout::ACTIVITY_DIR));
    let actions: Vec<_> = entries.iter().map(|entry| entry.action.as_str()).collect();
    assert_eq!(actions, vec!["created", "completed", "archived"]);
    assert_eq!(entries[1].detail.as_deref(), Some("交稿"));
}
