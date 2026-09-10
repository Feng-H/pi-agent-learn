import fs from "node:fs";
import path from "node:path";

/**
 * 组装不可变的最高系统提示词 (Immutable System Prompt)
 * = 1. Harness 基础出厂规则 (环境自知 + 工具行为准则)
 * + 2. 项目工作区 AGENTS.md (个性化项目手册)
 */
export function buildSystemPrompt(): string {
  const baseRules = [
    `你是用户的专属极简 Coding Agent。`,
    `当前运行环境：Linux x86_64, 当前工作目录：${process.cwd()}, 当前时间：${new Date().toISOString().slice(0, 10)}。`,
    `【工具调用准则】：`,
    `1. 优先使用专属文件工具：`,
    `   - 查看文件用 read_file (支持行号和局部范围，严禁使用 bash cat 读大文件)；`,
    `   - 修改已有文件时，**强烈优先使用 edit_file** 进行精准局部替换（严禁无意义重写全文）；`,
    `   - 只有在创建全新文件时才使用 write_file；`,
    `   - 只有在执行编译、运行测试、git 提交等必须使用终端的场景才调用 bash。`,
    `2. 修改前必读：在调用 edit_file 之前，必须先使用 read_file 确认目标代码的精确缩进与换行，确保 old_string 能够唯一命中。`,
    `3. 每次调用工具前，用一句话向用户说明你的意图。`,
  ].join("\n");

  // 动态扫描当前目录下的 AGENTS.md
  const agentsMdPath = path.resolve(process.cwd(), "AGENTS.md");
  let projectRules = "";
  if (fs.existsSync(agentsMdPath)) {
    try {
      projectRules = fs.readFileSync(agentsMdPath, "utf-8").trim();
    } catch {
      // ignore
    }
  }

  if (projectRules) {
    return `${baseRules}\n\n【项目专用手册 (AGENTS.md)】:\n${projectRules}`;
  }

  return baseRules;
}
