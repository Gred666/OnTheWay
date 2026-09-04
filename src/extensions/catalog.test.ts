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
  ])("rejects an invalid manifest", (value, message) => {
    expect(() => validateExtensionManifest(value)).toThrow(message);
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
