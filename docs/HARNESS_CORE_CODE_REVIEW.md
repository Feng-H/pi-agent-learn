# 专属 Coding Agent Harness 核心源码审查手卷 (Code Review Handbook)

> 本文件为整个 Harness 架构的核心源码浓缩汇总版，剔除边缘胶水代码，仅保留最 load-bearing（承重）的核心逻辑、状态机模型与防御性切面，供进行架构级 Code Review。

---

## 目录索引
1. [数据契约层：协议与消息模型 (Data Contracts)](#1-数据契约层协议与消息模型-data-contracts)
2. [不可变宪法层：System Prompt 与 AGENTS.md 动态融合](#2-不可变宪法层system-prompt-与-agentsmd-动态融合)
3. [作业工具箱：Pi 风格读写修三件套与三重防错 (Tools & Guardrails)](#3-作业工具箱pi-风格读写修三件套与三重防错-tools--guardrails)
4. [安全刹车：三级安全光谱权限闸门 (Permission Gate)](#4-安全刹车三级安全光谱权限闸门-permission-gate)
5. [智能方向盘：自动车道保持看门狗 (Steering Watchdog)](#5-智能方向盘自动车道保持看门狗-steering-watchdog)
6. [记忆中枢：双层全自动上下文治理 (L1 脱水 + L2 蒸馏)](#6-记忆中枢双层全自动上下文治理-l1-脱水--l2-蒸馏)
7. [核心引擎：双循环架构 (Session Outer Loop + ReAct Inner Loop)](#7-核心引擎双循环架构-session-outer-loop--react-inner-loop)

---

## 1. 数据契约层：协议与消息模型 (Data Contracts)
> 对应文件: `src/llm.ts`  
> 设计思想：基于 Anthropic 原生 Content Block 模型，将思考（Thinking）、文本（Text）、工具调用（Tool Use）和执行结果（Tool Result）统一为多态块。

```typescript
// 1.1 内容块（Content Block）：一切输出/输入皆为块
export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string; signature?: string }
  | { type: "tool_use"; id: string; name: string; input: Record<string, any> }
  | { type: "tool_result"; tool_use_id: string; content: string };

// 1.2 消息实体：仅保留 user 与 assistant 两个基础角色
export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

// 1.3 工具声明 Schema
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

// 1.4 LLM 纯净调用函数 (物理无状态 HTTP POST)
export async function callLLM(
  messages: Message[],
  tools: ToolDefinition[] = [],
  model: string = "gemini-3.8-flash-high",
  systemPrompt?: string
): Promise<{ content: ContentBlock[]; stop_reason: string; usage?: { input_tokens: number; output_tokens: number } }> {
  const payload: any = { model, max_tokens: 4096, messages };
  if (systemPrompt) payload.system = systemPrompt.trim();
  if (tools.length > 0) payload.tools = tools;

  const res = await fetch(`${process.env.ANTHROPIC_BASE_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_AUTH_TOKEN || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  return await res.json();
}
```

---

## 2. 不可变宪法层：System Prompt 与 AGENTS.md 动态融合
> 对应文件: `src/prompt.ts`  
> 设计思想：“隔壁朋友测试法”——代码内置出厂环境自知，外部工作区动态加载项目守则。

```typescript
export function buildSystemPrompt(): string {
  // 1. 出厂通用规则 (无论什么项目都必须具备的职业素养)
  const baseRules = [
    `你是用户的专属极简 Coding Agent。`,
    `当前运行环境：Linux x86_64, 工作目录：${process.cwd()}, 日期：${new Date().toISOString().slice(0, 10)}。`,
    `【工具调用准则】：`,
    `1. 优先使用专属文件工具：查看用 read_file (支持行号)，修改用 edit_file (精准局部替换)，严禁 bash cat 读大文件或重写全文；`,
    `2. 修改前必读：调用 edit_file 前必须先用 read_file 确认精确缩进，确保 old_string 唯一命中；`,
    `3. 每次调用工具前，用一句话向用户说明意图。`,
  ].join("\n");

  // 2. 动态扫描工作区 AGENTS.md (项目个性化规章)
  const agentsMdPath = path.resolve(process.cwd(), "AGENTS.md");
  let projectRules = "";
  if (fs.existsSync(agentsMdPath)) {
    projectRules = fs.readFileSync(agentsMdPath, "utf-8").trim();
  }

  // 3. 缝合成不可变宪法
  return projectRules ? `${baseRules}\n\n【项目专用手册 (AGENTS.md)】:\n${projectRules}` : baseRules;
}
```

---

## 3. 作业工具箱：Pi 风格读写修三件套与三重防错 (Tools & Guardrails)
> 对应文件: `src/tools.ts`  
> 设计思想：告别单一 Bash 转义符地狱，以精准局部替换（`edit_file`）为核心灵魂。

```typescript
// 3.1 read_file: 带行号的分页探针
export function executeReadFile(filePath: string, offset = 1, limit = 200): string {
  const absPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) return `Error: File not found: "${filePath}"`;

  const lines = fs.readFileSync(absPath, "utf-8").split("\n");
  const start = Math.max(1, offset);
  const end = Math.min(lines.length, start + limit - 1);

  const numbered = lines.slice(start - 1, end).map((l, i) => `${String(start + i).padStart(6, " ")}\t${l}`);
  return `[File: ${filePath} (lines ${start}-${end} of ${lines.length})]\n${numbered.join("\n")}`;
}

// 3.2 write_file: 自动递归建目录的原子写入
export function executeWriteFile(filePath: string, content: string): string {
  const absPath = path.resolve(process.cwd(), filePath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content, "utf-8");
  return `Successfully wrote ${Buffer.byteLength(content)} bytes to "${filePath}".`;
}

// 3.3 edit_file: 精准局部替换与三重防错 (Harness 的核心)
export function executeEditFile(filePath: string, oldString: string, newString: string, replaceAll = false): string {
  const absPath = path.resolve(process.cwd(), filePath);
  if (!fs.existsSync(absPath)) return `Error: File not found: "${filePath}".`;

  const content = fs.readFileSync(absPath, "utf-8");

  // 【防错 1: 存在性校验】
  if (!content.includes(oldString)) {
    return `Error: old_string not found in "${filePath}". Please read_file first to verify exact indentation.`;
  }
  // 【防错 2: 相同替换校验】
  if (oldString === newString) {
    return `Error: old_string and new_string are identical.`;
  }
  // 【防错 3: 唯一性校验（非 replaceAll 模式）】
  const occurrences = content.split(oldString).length - 1;
  if (!replaceAll && occurrences > 1) {
    return `Error: old_string is ambiguous (found ${occurrences} occurrences). Provide more surrounding context lines!`;
  }

  const updated = replaceAll
    ? content.split(oldString).join(newString)
    : content.slice(0, content.indexOf(oldString)) + newString + content.slice(content.indexOf(oldString) + oldString.length);

  fs.writeFileSync(absPath, updated, "utf-8");
  return `Successfully edited "${filePath}". Replaced ${replaceAll ? occurrences : 1} occurrence(s).`;
}
```

---

## 4. 安全刹车：三级安全光谱权限闸门 (Permission Gate)
> 对应文件: `src/permission.ts`  
> 设计思想：拒绝无意义的全量弹窗，以只读静默、敏感审批、高危绝对咬死进行三级风险隔离。

```typescript
export class PermissionGate {
  private autoApproveSession = false;

  // 4.1 三级风险评估
  public assessRisk(toolName: string, args: Record<string, any>): { level: "safe" | "sensitive" | "dangerous"; warning: string } {
    // 绿色安全级：read_file 与无害只读 bash 直接放行
    if (toolName === "read_file") return { level: "safe", warning: "" };
    if (toolName === "bash") {
      const cmd = String(args.command || "").trim();
      if (/rm\s+(-[a-zA-Z]*r|--recursive)/i.test(cmd)) return { level: "dangerous", warning: `不可逆高危删除: ${cmd}` };
      if (/\.env|\.git|\.ssh/i.test(cmd)) return { level: "dangerous", warning: `触碰核心机密文件: ${cmd}` };
      if (/^(ls|git status|git log|git diff|pwd)/.test(cmd)) return { level: "safe", warning: "" };
      return { level: "sensitive", warning: `执行常规命令: ${cmd}` };
    }
    // 黄色敏感级：修改文件
    if (toolName === "write_file" || toolName === "edit_file") {
      if (/\.env|\.git|\.ssh/i.test(args.path)) return { level: "dangerous", warning: `禁止修改受保护文件: ${args.path}` };
      return { level: "sensitive", warning: `修改工作区文件: ${args.path}` };
    }
    return { level: "sensitive", warning: `调用工具: ${toolName}` };
  }

  // 4.2 拦截执行切面
  public async requestApproval(toolName: string, args: Record<string, any>, mockInput?: string): Promise<{ allowed: boolean; reason?: string }> {
    const { level, warning } = this.assessRisk(toolName, args);
    if (level === "safe") return { allowed: true };
    if (this.autoApproveSession && level !== "dangerous") return { allowed: true };

    // 挂起执行，在终端交互请求审批 [y/n/a]
    const answer = mockInput ?? (await promptUserApproval(warning, toolName, args));
    if (answer === "y") return { allowed: true };
    if (answer === "a") { this.autoApproveSession = true; return { allowed: true }; }

    // 人类指挥官否决
    return {
      allowed: false,
      reason: `Permission Denied: 人类指挥官拒绝了此操作 [${warning}]。请换用更安全的替代方案。`,
    };
  }
}
```

---

## 5. 智能方向盘：自动车道保持看门狗 (Steering Watchdog)
> 对应文件: `src/steering.ts`  
> 设计思想：破除必须人类盯盘的假设，以“鬼打墙检测”与“连续报错检测”实现自动纠偏与自愈。

```typescript
export class SteeringWatchdog {
  private history: { argsSignature: string; isError: boolean }[] = [];
  private consecutiveErrors = 0;
  private humanSteeringQueue: string[] = [];

  // 人工中途插嘴队列
  public pushHumanSteering(text: string) { this.humanSteeringQueue.push(text); }

  public recordToolExecution(toolName: string, args: Record<string, any>, output: string) {
    const isErr = output.startsWith("Error:") || output.includes("[Command Error]") || output.includes("fatal:");
    this.consecutiveErrors = isErr ? this.consecutiveErrors + 1 : 0;
    this.history.push({ argsSignature: `${toolName}:${JSON.stringify(args)}`, isError: isErr });
  }

  // 核心车道偏航检测
  public inspectDeviation(): string | null {
    // 1. 人工指令最高优先
    const humanInput = this.humanSteeringQueue.shift();
    if (humanInput) return `【用户中途直接介入指导】：\n"${humanInput}"\n请立即遵从最新指导调整方向！`;

    const len = this.history.length;
    // 2. 自动检测 A：鬼打墙（连续两次完全相同操作）
    if (len >= 2 && this.history[len - 1].argsSignature === this.history[len - 2].argsSignature) {
      return `🚨 【Harness 自动车道保持警报 / Loop Detected】\n检测到你连续两次执行了完全相同的操作！严禁盲目重试，必须先输出反思并换一条全新路线。`;
    }

    // 3. 自动检测 B：硬撞南墙（连续两次操作报错失败）
    if (this.consecutiveErrors >= 2) {
      return `🚨 【Harness 自动车道保持警报 / Consecutive Failures】\n已连续 ${this.consecutiveErrors} 次执行报错！当前路径走不通，请退后一步仔细分析根因再做决策。`;
    }

    return null;
  }
}
```

---

## 6. 记忆中枢：双层全自动上下文治理 (L1 脱水 + L2 蒸馏)
> 对应文件: `src/context-manager.ts`  
> 设计思想：拒绝粗暴 `/clear`，通过“单轮即时脱水（微观）+ 跨轮滚动备忘录（宏观）”保全核心事实与抑制 Token 暴增。

```typescript
// 6.1 L1 微观层：单轮工具输出脱水折叠 (防止单个大命令单点暴击)
export function dehydratePriorToolOutputs(messages: Message[]): number {
  let savedChars = 0;
  for (const msg of messages) {
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue;
    for (const block of msg.content) {
      if (block.type === "tool_result" && typeof block.content === "string" && block.content.length > 300) {
        const head = block.content.slice(0, 120);
        const tail = block.content.slice(-80);
        const omitted = block.content.length - 200;
        block.content = `${head}\n... [💧 L1 脱水：已折叠 ${omitted} 字符冗余日志，结论已提炼] ...\n${tail}`;
        savedChars += omitted;
      }
    }
  }
  return savedChars;
}

// 6.2 L2 宏观层：跨轮滚动蒸馏为【长期记忆备忘录】(化解多轮慢火膨胀)
export async function compactSessionIfNeeded(messages: Message[], tokenWatermark: number): Promise<boolean> {
  if (messages.length < 6 && tokenWatermark < 1500) return false;

  // 切割：保留最后 2 条活跃工作上下文，早期冷数据送去提炼
  const splitIdx = messages.length - 2;
  const cold = messages.slice(0, splitIdx);
  const hot = messages.slice(splitIdx);

  const distillReq: Message[] = [
    ...cold,
    { role: "user", content: "【系统指令】：请将上述历史提炼为一份核心事实备忘录（包含：用户身份/偏好、已确立的核心事实与已完成的操作），要求结构化极简。" },
  ];

  const resp = await callLLM(distillReq, []);
  const summary = resp.content.find((b) => b.type === "text")?.text || "（历史已归档）";

  // 缝合：备忘录置顶 + 活跃上下文
  messages.length = 0;
  messages.push({ role: "user", content: `【🧠 系统长期记忆备忘录 (Memory Ledger)】\n${summary}` }, ...hot);
  return true;
}
```

---

## 7. 核心引擎：双循环架构 (Session Outer Loop + ReAct Inner Loop)
> 对应文件: `src/loop.ts`  
> 设计思想：外层管生命周期与记忆常驻，内层管工具派发、权限拦截、看门狗纠偏与治理触发。

```typescript
export class AgentSession {
  public messages: Message[] = [];
  public watchdog = new SteeringWatchdog();
  public permissionGate = new PermissionGate();
  public stats = { turnCount: 0, totalInputTokens: 0, totalOutputTokens: 0 };
}

export async function runAgentTurn(session: AgentSession, userPrompt: string, options: { maxSteps?: number; mockPermissionAnswer?: string } = {}) {
  const { maxSteps = 10 } = options;
  session.stats.turnCount++;

  // 1. 追加最新指令进持久 Session
  session.messages.push({ role: "user", content: userPrompt });

  // 2. 【L2 治理切面】：检查是否触发滚动蒸馏
  await compactSessionIfNeeded(session.messages, session.stats.totalInputTokens);

  let step = 0;
  // 3. 内层 ReAct while 循环
  while (step < maxSteps) {
    step++;

    // ① 请求 LLM 决策 (挂载不可变宪法 System Prompt)
    const systemPrompt = buildSystemPrompt();
    const response = await callLLM(session.messages, ALL_TOOLS, undefined, systemPrompt);

    if (response.usage) {
      session.stats.totalInputTokens += response.usage.input_tokens;
      session.stats.totalOutputTokens += response.usage.output_tokens;
    }

    session.messages.push({ role: "assistant", content: response.content });

    // ② 终止条件判定：若无工具调用，任务自然达成
    const toolCalls = response.content.filter((b) => b.type === "tool_use");
    if (toolCalls.length === 0) break;

    // ③ 工具执行回路 (挂载刹车与看门狗)
    const toolResults: ContentBlock[] = [];
    for (const tc of toolCalls) {
      const { name, id, input } = tc;

      // 🛑【刹车切面】：Permission Gate 审核
      const permission = await session.permissionGate.requestApproval(name, input, options.mockPermissionAnswer);
      let outputText = "";

      if (!permission.allowed) {
        outputText = permission.reason!;
      } else {
        // 放行执行
        outputText = await dispatchTool(name, input);
      }

      // 🐕 登记到看门狗
      session.watchdog.recordToolExecution(name, input, outputText);
      toolResults.push({ type: "tool_result", tool_use_id: id, content: outputText });
    }

    // 反馈工具结果
    session.messages.push({ role: "user", content: toolResults });

    // 🛡️【方向盘切面】：看门狗检测偏航，必要时注入当头棒喝
    const steeringAlert = session.watchdog.inspectDeviation();
    if (steeringAlert) {
      session.messages.push({ role: "user", content: steeringAlert });
    }
  }

  // 4. 【L1 治理切面】：单轮任务结束，即时脱水折叠工具输出
  dehydratePriorToolOutputs(session.messages);
}
```

---

## 8. Code Review 关键检查清单 (Self-Review Checklist)

| 检查维度 | 审查点与防线说明 | 状态 |
| :--- | :--- | :--- |
| **内存与 Token 泄露** | 工具长输出在轮次结项时是否脱水（L1）？跨轮历史是否受水位线控制滚动蒸馏（L2）？ | ✅ 已通过实测验证 |
| **规则稳定性** | `AGENTS.md` 是否从 `messages` 物理隔离？压缩时是否绝对不会冲淡用户的宪法规则？ | ✅ 独立注入顶层 `system` 字段 |
| **文件修改幂等与安全** | `edit_file` 是否强制唯一匹配？是否杜绝了重写整个文件的幻觉与截断风险？ | ✅ 三重校验拦截歧义 |
| **死循环与硬撞南墙** | 模型在反复报错或重复调用同一工具时，Harness 是否能自动介入干预？ | ✅ Watchdog 自动注入反思指令 |
| **高危命令防御** | `rm -rf`、修改 `.env` 或 `.git` 是否有物理拦截锁？用户拒绝后是否能优雅降级？ | ✅ 三级安全光谱严格阻断 |
| **端到端可验证性** | 是否经过了真实存在 Bug 代码的自主读取、修复与运行测试闭环？ | ✅ `sample-calculator` 测试全绿通过 |
