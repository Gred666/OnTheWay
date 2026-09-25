import { describe, expect, it } from "vitest";
import {
  type CatalogExtension,
  serializeExtensionPackage,
  validateExtensionManifest,
} from "./catalog";

const manifest = {
  schemaVersion: 1 as const,
  id: "community.example",
  name: "示例扩展",
  version: "1.0.0",
  author: "Tester",
  summary: "用于测试",
  category: "editor" as const,
};

describe("extension catalog", () => {
  it("accepts and normalizes a valid manifest", () => {
    expect(validateExtensionManifest({ ...manifest, name: "  示例扩展  " }).name).toBe("示例扩展");
  });

  it.each([
    [{ ...manifest, schemaVersion: 2 }, "版本"],
    [{ ...manifest, id: "Invalid ID" }, "id"],
    [{ ...manifest, summary: "" }, "summary"],
    [{ ...manifest, category: "unknown" }, "category"],
    // 类型不对要报出是哪个字段，而不是 `.trim is not a function`
    [{ ...manifest, name: 5 }, "name 必须是字符串"],
    [{ ...manifest, description: 3 }, "description 必须是字符串"],
    [{ ...manifest, id: 7 }, "id"],
    [{ ...manifest, version: "   " }, "缺少 version"],
    [{ ...manifest, permissions: [1, {}] }, "permissions"],
    [{ ...manifest, permissions: "all" }, "permissions"],
    [{ ...manifest, homepage: "javascript:alert(1)" }, "homepage"],
    [[manifest], "JSON 对象"],
  ])("rejects an invalid manifest: %j", (value, message) => {
    expect(() => validateExtensionManifest(value)).toThrow(message);
  });

  it("keeps optional fields that are well-formed", () => {
    const result = validateExtensionManifest({
      ...manifest,
      description: "  说明  ",
      homepage: "https://example.com",
      permissions: ["notes:read"],
    });
    expect(result).toMatchObject({
      description: "说明",
      homepage: "https://example.com",
      permissions: ["notes:read"],
    });
  });

  it("does not leak catalog-only fields into downloads", () => {
    const extension: CatalogExtension = {
      ...manifest,
      source: "local",
      packageText: "private cache",
    };
    const downloaded = JSON.parse(serializeExtensionPackage(extension));
    expect(downloaded.source).toBeUndefined();
    expect(downloaded.packageText).toBeUndefined();
    expect(validateExtensionManifest(downloaded).id).toBe(manifest.id);
  });
});
