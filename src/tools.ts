import { exec } from "node:child_process";
import { promisify } from "node:util";
import type { ToolDefinition } from "./llm.js";

const execAsync = promisify(exec);

// 1. 工具声明: 告诉模型这个工具是干什么的，需要什么参数
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

// 2. 工具执行器: 真正由 Harness 在操作系统中执行的操作
export async function executeBash(command: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(command, {
      cwd: process.cwd(),
      timeout: 30000, // 30s 超时保护
      maxBuffer: 1024 * 1024 * 4, // 4MB buffer
    });
    const output = (stdout + (stderr ? `\n[stderr]\n${stderr}` : "")).trim();
    return output.length > 0 ? output : "(command completed with no output)";
  } catch (err: any) {
    return `[Command Error]: ${err.message || String(err)}`;
  }
}
