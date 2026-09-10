import { exec } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import path from "node:path";
import type { ToolDefinition } from "./llm.js";

const execAsync = promisify(exec);

// ==========================================
// 1. bash 工具
// ==========================================
export const bashToolDefinition: ToolDefinition = {
  name: "bash",
  description: "Execute a bash shell command in the current environment and return stdout/stderr.",
  input_schema: {
    type: "object",
    properties: {
      command: {
        type: "string",
        description: "The bash command to run",
      },
    },
    required: ["command"],
  },
};

export async function executeBash(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: process.cwd(),
      timeout: 30000,
      maxBuffer: 1024 * 1024 * 4,
    });
    const output = (stdout + (stderr ? `\n[stderr]\n${stderr}` : "")).trim();
    return output.length > 0 ? output : "(command completed with no output)";
  } catch (err: any) {
    return `[Command Error]: ${err.message || String(err)}`;
  }
}

// ==========================================
// 2. read_file 工具 (带行号、支持分页切片)
// ==========================================
export const readFileToolDefinition: ToolDefinition = {
  name: "read_file",
  description:
    "Read the content of a file from the filesystem with 1-based line numbers. Supports offset (start line) and limit (number of lines) to avoid context overflow.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The path of the file to read (relative to current directory or absolute)",
      },
      offset: {
        type: "integer",
        description: "Optional 1-based starting line number (default: 1)",
      },
      limit: {
        type: "integer",
        description: "Optional maximum number of lines to read (default: 200)",
      },
    },
    required: ["path"],
  },
};

export function executeReadFile(filePath: string, offset = 1, limit = 200): string {
  try {
    const resolvedPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(resolvedPath)) {
      return `Error: File not found at path "${filePath}"`;
    }
    const stat = fs.statSync(resolvedPath);
    if (stat.isDirectory()) {
      return `Error: Path "${filePath}" is a directory, not a regular file.`;
    }

    const content = fs.readFileSync(resolvedPath, "utf-8");
    const lines = content.split("\n");
    const totalLines = lines.length;

    const startLine = Math.max(1, offset);
    const endLine = Math.min(totalLines, startLine + limit - 1);

    if (startLine > totalLines) {
      return `[File: ${filePath} has ${totalLines} lines. Requested offset ${startLine} is past EOF]`;
    }

    const slice = lines.slice(startLine - 1, endLine);
    const numbered = slice.map((line, idx) => {
      const lineNum = String(startLine + idx).padStart(6, " ");
      return `${lineNum}\t${line}`;
    });

    return `[File: ${filePath} (lines ${startLine}-${endLine} of ${totalLines})]\n${numbered.join("\n")}`;
  } catch (err: any) {
    return `Error reading file "${filePath}": ${err.message}`;
  }
}

// ==========================================
// 3. write_file 工具 (全新创建或覆盖写入)
// ==========================================
export const writeFileToolDefinition: ToolDefinition = {
  name: "write_file",
  description:
    "Write content to a file. Overwrites if file exists, creates parent directories automatically if needed.",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The file path to write to",
      },
      content: {
        type: "string",
        description: "The full content to write to the file",
      },
    },
    required: ["path", "content"],
  },
};

export function executeWriteFile(filePath: string, content: string): string {
  try {
    const resolvedPath = path.resolve(process.cwd(), filePath);
    const parentDir = path.dirname(resolvedPath);
    if (!fs.existsSync(parentDir)) {
      fs.mkdirSync(parentDir, { recursive: true });
    }
    fs.writeFileSync(resolvedPath, content, "utf-8");
    const byteCount = Buffer.byteLength(content, "utf-8");
    return `Successfully wrote ${byteCount} bytes to "${filePath}".`;
  } catch (err: any) {
    return `Error writing file "${filePath}": ${err.message}`;
  }
}

// ==========================================
// 4. edit_file 工具 (精准局部字符串替换 - Pi 核心设计)
// ==========================================
export const editFileToolDefinition: ToolDefinition = {
  name: "edit_file",
  description:
    "Perform exact string replacement in a file without rewriting the entire file. old_string must match the file content uniquely and exactly (including whitespace/indentation).",
  input_schema: {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "The path of the file to edit",
      },
      old_string: {
        type: "string",
        description: "The exact existing text in the file to replace",
      },
      new_string: {
        type: "string",
        description: "The new replacement text",
      },
      replace_all: {
        type: "boolean",
        description: "Whether to replace all occurrences (default: false, requiring old_string to be unique)",
      },
    },
    required: ["path", "old_string", "new_string"],
  },
};

export function executeEditFile(
  filePath: string,
  oldString: string,
  newString: string,
  replaceAll = false
): string {
  try {
    const resolvedPath = path.resolve(process.cwd(), filePath);
    if (!fs.existsSync(resolvedPath)) {
      return `Error: File not found at path "${filePath}".`;
    }

    const content = fs.readFileSync(resolvedPath, "utf-8");

    // 防错检查 1: old_string 必须存在
    if (!content.includes(oldString)) {
      return `Error: old_string was not found in "${filePath}". Please use read_file first to verify exact indentation and line breaks.`;
    }

    // 防错检查 2: old_string 与 new_string 不能相同
    if (oldString === newString) {
      return `Error: old_string and new_string are identical. No changes were made.`;
    }

    // 防错检查 3: 非 replace_all 模式下，匹配项必须唯一
    const occurrences = content.split(oldString).length - 1;
    if (!replaceAll && occurrences > 1) {
      return `Error: old_string is ambiguous (found ${occurrences} occurrences in "${filePath}"). Please include more surrounding context lines to make it uniquely identifiable.`;
    }

    let updatedContent = "";
    if (replaceAll) {
      updatedContent = content.split(oldString).join(newString);
    } else {
      const idx = content.indexOf(oldString);
      updatedContent = content.slice(0, idx) + newString + content.slice(idx + oldString.length);
    }

    fs.writeFileSync(resolvedPath, updatedContent, "utf-8");
    return `Successfully edited "${filePath}". Replaced ${replaceAll ? occurrences : 1} occurrence(s).`;
  } catch (err: any) {
    return `Error editing file "${filePath}": ${err.message}`;
  }
}

// 导出所有可用工具定义列表与路由分发器
export const ALL_TOOLS: ToolDefinition[] = [
  bashToolDefinition,
  readFileToolDefinition,
  writeFileToolDefinition,
  editFileToolDefinition,
];

export async function dispatchTool(name: string, args: Record<string, any>): Promise<string> {
  switch (name) {
    case "bash":
      return await executeBash(args.command || "");
    case "read_file":
      return executeReadFile(args.path || "", args.offset || 1, args.limit || 200);
    case "write_file":
      return executeWriteFile(args.path || "", args.content || "");
    case "edit_file":
      return executeEditFile(
        args.path || "",
        args.old_string || "",
        args.new_string || "",
        Boolean(args.replace_all)
      );
    default:
      return `Error: Tool "${name}" is not implemented by this Harness.`;
  }
}
