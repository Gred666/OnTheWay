import { indentLess, indentMore, indentWithTab, selectLine } from "@codemirror/commands";
import { searchKeymap } from "@codemirror/search";
import type { KeyBinding } from "@codemirror/view";
import {
  changeHeadingLevel,
  clearMarkdownFormat,
  insertFencedBlock,
  insertLink,
  insertTable,
  setHeading,
  toggleLinePrefix,
  wrapMarkdown,
} from "./markdownCommands";

/** 与 Typora 对齐的编辑快捷键；文件/窗口命令由应用壳层负责。 */
export const markdownKeymap: readonly KeyBinding[] = [
  ...Array.from({ length: 7 }, (_, level) => ({ key: `Mod-${level}`, run: setHeading(level) })),
  { key: "Mod-=", run: changeHeadingLevel(1) },
  { key: "Mod--", run: changeHeadingLevel(-1) },
  { key: "Mod-b", run: wrapMarkdown("**") },
  { key: "Mod-i", run: wrapMarkdown("*") },
  { key: "Mod-u", run: wrapMarkdown("<u>", "</u>") },
  { key: "Shift-Mod-`", run: wrapMarkdown("`") },
  { key: "Alt-Shift-5", mac: "Ctrl-Shift-`", run: wrapMarkdown("~~") },
  { key: "Mod-k", run: insertLink() },
  { key: "Mod-l", run: selectLine },
  { key: "Shift-Mod-i", mac: "Ctrl-Mod-i", run: insertLink(true) },
  { key: "Shift-Mod-k", mac: "Alt-Mod-c", run: insertFencedBlock() },
  {
    key: "Shift-Mod-q",
    mac: "Alt-Mod-q",
    run: toggleLinePrefix("> ", /^\s*>\s?/),
  },
  {
    key: "Shift-Mod-[",
    mac: "Alt-Mod-o",
    run: toggleLinePrefix("1. ", /^\s*\d+[.)]\s+/),
  },
  {
    key: "Shift-Mod-]",
    mac: "Alt-Mod-u",
    run: toggleLinePrefix("- ", /^\s*[-+*]\s+/),
  },
  { key: "Mod-[", run: indentMore },
  { key: "Mod-]", run: indentLess },
  indentWithTab,
  { key: "Mod-t", mac: "Alt-Mod-t", run: insertTable() },
  { key: "Mod-\\", run: clearMarkdownFormat() },
  ...searchKeymap,
];
