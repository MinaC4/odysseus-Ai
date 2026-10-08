export interface ArchivedProject {
  id: string;
  title: string;
  made_at: string | null;
  github_repo_url: string | null;
  full_documentation: string;
  current_status_documentation: string;
  required_changes_documentation: string;
  suggested_changes_documentation: string;
  ai_tools_used: { tool: string; reason: string }[];
  readme_markdown: string;
  custom_fields: Record<string, string>;
  category: string;
  status: string;
  tags: string[];
  favorite: boolean;
  tech_stack: string[];
  project_url: string | null;
  summary: string;
  created_at: string;
  updated_at: string;
  sort_order: number;
}

export interface ArchivedFile {
  id: string;
  archived_project_id: string;
  file_name: string;
  mime_type: string;
  size_bytes: number;
  data_base64?: string;
  kind: "image" | "document";
  caption?: string | null;
  created_at: string;
}

export const MAX_FILE_SIZE = 10 * 1024 * 1024;
export const MAX_TEXT_PREVIEW = 1024 * 1024;
export const ARCHITECTURE_KEY = "architecture_documentation";
export const FILE_METADATA =
  "id, archived_project_id, file_name, mime_type, size_bytes, kind, caption, created_at";
export const PROJECT_METADATA =
  "id, title, made_at, github_repo_url, project_url, summary, category, status, tags, favorite, tech_stack, created_at, updated_at, sort_order";
export const CATEGORIES = [
  ["general", "General"],
  ["web", "Web app"],
  ["mobile", "Mobile"],
  ["devops", "DevOps / infrastructure"],
  ["ai", "AI / ML"],
  ["research", "Research"],
  ["automation", "Automation"],
  ["game", "Game"],
  ["other", "Other"],
] as const;
export const STATUSES = [
  ["active", "Active"],
  ["completed", "Completed"],
  ["on-hold", "On hold"],
  ["archived", "Archived"],
] as const;
export const DOCUMENTS = [
  {
    field: "full_documentation",
    label: "Full documentation",
    description: "Purpose, setup, implementation and operating guidance.",
  },
  {
    field: "current_status_documentation",
    label: "Current status",
    description: "What works today, known limitations and progress.",
  },
  {
    field: "required_changes_documentation",
    label: "Required changes",
    description: "Work that must be completed or corrected.",
  },
  {
    field: "suggested_changes_documentation",
    label: "Suggested changes",
    description: "Ideas and improvements for the next iteration.",
  },
] as const;

export function safeExternalUrl(
  value: string | null | undefined,
): string | undefined {
  if (!value || Array.from(value).some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)) return undefined;
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password
      ? url.href
      : undefined;
  } catch {
    return undefined;
  }
}

/** Paths describe archive folders only. They never become filesystem targets. */
export function archivePath(value: string): string {
  return (
    value
      .replace(/\\/g, "/")
      .split("/")
      .filter((part) => part && part !== "." && part !== "..")
      .map((part) => Array.from(part).filter(char => char.charCodeAt(0) >= 32 && char.charCodeAt(0) !== 127).join("").trim())
      .filter(Boolean)
      .join("/") || "unnamed-file"
  );
}

export function downloadName(value: string): string {
  return (
    archivePath(value)
      .split("/")
      .pop()!
      .replace(/[<>:"|?*]/g, "_")
      .slice(0, 240) || "download"
  );
}

export function decodeAttachment(file: ArchivedFile): Uint8Array {
  const base64 = file.data_base64;
  if (
    typeof base64 !== "string" ||
    base64.length > Math.ceil(MAX_FILE_SIZE / 3) * 4 ||
    Number(file.size_bytes) > MAX_FILE_SIZE
  ) {
    throw new Error(
      "Attachment is missing or exceeds the 10 MiB download limit.",
    );
  }
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0)
    throw new Error("Invalid attachment encoding.");
  const decoded = atob(base64);
  if (decoded.length > MAX_FILE_SIZE)
    throw new Error("Attachment exceeds the 10 MiB limit.");
  if (decoded.length !== Number(file.size_bytes))
    throw new Error("Attachment size does not match its stored metadata.");
  return Uint8Array.from(decoded, (character) => character.charCodeAt(0));
}

export function rasterMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  const head = Array.from(bytes.slice(0, 12));
  if (head.slice(0, 8).join(",") === "137,80,78,71,13,10,26,10")
    return "image/png";
  if (head[0] === 255 && head[1] === 216 && head[2] === 255)
    return "image/jpeg";
  const ascii = new TextDecoder().decode(bytes.slice(0, 12));
  if (/^GIF8[79]a/.test(ascii)) return "image/gif";
  if (ascii.startsWith("RIFF") && ascii.slice(8) === "WEBP")
    return "image/webp";
  return null;
}

export function isTextFile(file: ArchivedFile): boolean {
  return (
    file.mime_type.startsWith("text/") ||
    /\.(md|markdown|txt|json|csv|ya?ml|log|tsx?|jsx?|py|sh|bash|zsh|html?|css|sql|toml|ini|env|lock|xml|svg|conf|dockerfile|gitignore)$/i.test(
      file.file_name,
    ) ||
    /(?:^|\/)(Dockerfile|Makefile|LICENSE|README)$/i.test(file.file_name)
  );
}

export function normalizeProject(project: Partial<ArchivedProject> & Pick<ArchivedProject, 'id' | 'title' | 'created_at' | 'updated_at'>): ArchivedProject {
  return {
    ...project,
    made_at: project.made_at ?? null,
    github_repo_url: project.github_repo_url ?? null,
    project_url: project.project_url ?? null,
    favorite: project.favorite ?? false,
    summary: project.summary ?? "",
    category: project.category ?? "general",
    status: project.status ?? "archived",
    tags: project.tags ?? [],
    tech_stack: project.tech_stack ?? [],
    ai_tools_used: project.ai_tools_used ?? [],
    custom_fields: project.custom_fields ?? {},
    readme_markdown: project.readme_markdown ?? "",
    full_documentation: project.full_documentation ?? "",
    current_status_documentation: project.current_status_documentation ?? "",
    required_changes_documentation:
      project.required_changes_documentation ?? "",
    suggested_changes_documentation:
      project.suggested_changes_documentation ?? "",
    sort_order: project.sort_order ?? 0,
  };
}

export function projectSearchText(
  project: ArchivedProject,
  files: ArchivedFile[],
): string {
  return [
    project.title,
    project.summary,
    project.made_at,
    project.tags.join(" "),
    project.tech_stack.join(" "),
    ...files.map((file) => `${file.file_name} ${file.caption ?? ""}`),
  ]
    .join(" ")
    .toLocaleLowerCase();
}

export function projectPayload(project: ArchivedProject) {
  const {
    id: _id,
    created_at: _created,
    updated_at: _updated,
    ...payload
  } = project;
  void _id; void _created; void _updated;
  return payload;
}
