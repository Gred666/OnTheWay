import { describe, expect, it } from "vitest";
import { attachmentMarkdown } from "./attachments";

describe("附件插进正文的写法", () => {
  it("images become ![name](link), other files plain links", () => {
    expect(
      attachmentMarkdown([
        { link: "../附件/屏幕-截图.png", name: "屏幕-截图.png", isImage: true },
        { link: "../附件/报价单.pdf", name: "报价单.pdf", isImage: false },
      ]),
    ).toBe("![屏幕-截图](../附件/屏幕-截图.png)\n[报价单](../附件/报价单.pdf)");
  });

  it("drops brackets from the label so the link stays intact", () => {
    expect(attachmentMarkdown([{ link: "a.png", name: "图[1].png", isImage: true }])).toBe(
      "![图1](a.png)",
    );
  });
});
