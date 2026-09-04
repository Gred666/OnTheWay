export type ExtensionCategory = "editor" | "appearance" | "productivity" | "integration";

export interface ExtensionManifest {
  schemaVersion: 1;
  id: string;
  name: string;
  version: string;
  author: string;
  summary: string;
  description?: string;
  category: ExtensionCategory;
  icon?: string;
  homepage?: string;
  permissions?: string[];
  verified?: boolean;
  downloads?: number;
  updatedAt?: string;
}

export interface CatalogExtension extends ExtensionManifest {
  source: "official" | "local";
  packageText?: string;
}

/**
 * 扩展目录边界。以后接上传审核服务/CDN时实现同一接口，页面无需改动。
 */
export interface ExtensionCatalogProvider {
  list(): Promise<CatalogExtension[]>;
  importPackage(file: File): Promise<CatalogExtension>;
  removeLocal(id: string): Promise<void>;
  download(extension: CatalogExtension): Promise<void>;
}

const STORAGE_KEY = "otw.extension-catalog.v1";
const MAX_PACKAGE_BYTES = 2 * 1024 * 1024;
const ID_PATTERN = /^[a-z0-9]+(?:[._-][a-z0-9]+)*$/;

const officialExtensions: CatalogExtension[] = [
  {
    schemaVersion: 1,
    id: "official.math",
    name: "数学公式",
    version: "0.1.0",
    author: "OnTheWay",
    summary: "在 Markdown 中渲染行内公式与公式块。",
    description: "计划支持 $...$ 与 $$...$$，并提供可替换的公式渲染器。",
    category: "editor",
    permissions: [],
    verified: true,
    downloads: 0,
    updatedAt: "2026-09-02",
    source: "official",
  },
  {
    schemaVersion: 1,
    id: "official.mermaid",
    name: "Mermaid 图表",
    version: "0.1.0",
    author: "OnTheWay",
    summary: "把 Mermaid 代码块渲染为流程图、时序图与关系图。",
    category: "editor",
    permissions: [],
    verified: true,
    downloads: 0,
    updatedAt: "2026-09-02",
    source: "official",
  },
  {
    schemaVersion: 1,
    id: "official.callouts",
    name: "增强 Callout",
    version: "0.1.0",
    author: "OnTheWay",
    summary: "注册自定义提示块类型、图标和配色。",
    category: "appearance",
    permissions: [],
    verified: true,
    downloads: 0,
    updatedAt: "2026-09-02",
    source: "official",
  },
];

export function validateExtensionManifest(value: unknown): ExtensionManifest {
  if (!value || typeof value !== "object") throw new Error("扩展包必须是 JSON 对象");
  const manifest = value as Partial<ExtensionManifest>;
  if (manifest.schemaVersion !== 1) throw new Error("暂不支持此扩展清单版本");
  if (!manifest.id || !ID_PATTERN.test(manifest.id)) throw new Error("扩展 id 格式不正确");
  if (!manifest.name?.trim() || !manifest.version?.trim() || !manifest.author?.trim()) {
    throw new Error("扩展缺少 name、version 或 author");
  }
  if (!manifest.summary?.trim()) throw new Error("扩展缺少 summary");
  if (
    !(["editor", "appearance", "productivity", "integration"] as const).includes(manifest.category!)
  ) {
    throw new Error("扩展 category 不受支持");
  }
  return {
    schemaVersion: 1,
    id: manifest.id,
    name: manifest.name.trim(),
    version: manifest.version.trim(),
    author: manifest.author.trim(),
    summary: manifest.summary.trim(),
    description: manifest.description?.trim(),
    category: manifest.category!,
    icon: manifest.icon,
    homepage: manifest.homepage,
    permissions: Array.isArray(manifest.permissions) ? manifest.permissions : [],
  };
}

export function serializeExtensionPackage(extension: CatalogExtension): string {
  const { source: _source, packageText: _packageText, ...manifest } = extension;
  return JSON.stringify(manifest, null, 2);
}

function loadLocal(): CatalogExtension[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as CatalogExtension[];
    return Array.isArray(value) ? value.filter((item) => item.source === "local") : [];
  } catch {
    return [];
  }
}

function saveLocal(items: CatalogExtension[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
}

function downloadText(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const localExtensionCatalog: ExtensionCatalogProvider = {
  async list() {
    return [...officialExtensions, ...loadLocal()];
  },

  async importPackage(file) {
    if (file.size > MAX_PACKAGE_BYTES) throw new Error("扩展清单不能超过 2 MB");
    const packageText = await file.text();
    const manifest = validateExtensionManifest(JSON.parse(packageText));
    if (officialExtensions.some((item) => item.id === manifest.id)) {
      throw new Error("不能覆盖官方扩展");
    }
    const extension: CatalogExtension = { ...manifest, source: "local", packageText };
    const local = loadLocal();
    saveLocal([extension, ...local.filter((item) => item.id !== extension.id)]);
    return extension;
  },

  async removeLocal(id) {
    saveLocal(loadLocal().filter((item) => item.id !== id));
  },

  async download(extension) {
    const text = extension.packageText ?? serializeExtensionPackage(extension);
    downloadText(`${extension.id}-${extension.version}.otwx.json`, text);
  },
};
