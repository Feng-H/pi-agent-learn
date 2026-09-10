import { callLLM, type Message, type ContentBlock, type ToolDefinition } from "./llm.js";
import { ALL_TOOLS, dispatchTool } from "./tools.js";
import { dehydratePriorToolOutputs, compactSessionIfNeeded } from "./context-manager.js";
import { buildSystemPrompt } from "./prompt.js";
import { SteeringWatchdog } from "./steering.js";

export interface SessionStats {
  turnCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
}

/**
 * 代表一个跨轮次存活的会话实体 (Session)
 * 只要 REPL 进程不退出，它就持久保存在内存中
 */
export class AgentSession {
  public messages: Message[] = [];
  public watchdog: SteeringWatchdog = new SteeringWatchdog();
  public stats: SessionStats = {
    turnCount: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
  };

  /** 清空会话历史（相当于 /clear） */
  public clear() {
    this.messages = [];
    this.watchdog.resetTurn();
    console.log("🧹 [Session] 会话历史已清空，开启全新对话。");
  }
}

interface RunOptions {
  maxSteps?: number;
}

/**
 * 运行单次人机交互轮次 (Turn)
 * - 外层：用户的这句指令被追加到 session.messages
 * - 内层：模型通过 ReAct while 循环调用工具，直到本轮结束
 * - 结束后：完整的上下文保留在 session.messages 中，供下一轮继续使用
 */
export async function runAgentTurn(
  session: AgentSession,
  userPrompt: string,
  options: RunOptions = {}
) {
  const { maxSteps = 10 } = options;
  const tools: ToolDefinition[] = ALL_TOOLS;

  session.stats.turnCount++;
  const turnNum = session.stats.turnCount;

  // 1. 将用户的最新输入，追加到跨轮次常驻的历史列表中
  session.messages.push({ role: "user", content: userPrompt });

  // 【L2 治理检测】：如果历史消息过多或 Token 偏高，自动静默蒸馏早期记忆
  const lastInputTokens = session.stats.totalInputTokens;
  await compactSessionIfNeeded(session.messages, lastInputTokens);

  console.log(`\n${"═".repeat(60)}`);
  console.log(`🎯 [第 ${turnNum} 轮对话开始] 用户指令: "${userPrompt}"`);
  console.log(`📚 [上下文状态] 当前累积历史消息条数: ${session.messages.length}`);
  console.log(`${"═".repeat(60)}`);

  let step = 0;
  let turnInputTokens = 0;
  let turnOutputTokens = 0;

  // 2. 内层 ReAct 循环
  while (step < maxSteps) {
    step++;
    console.log(`\n▶ [Turn ${turnNum} / Step ${step}] 正在请求模型决策 (发送整个历史上下文)...`);

    const systemPrompt = buildSystemPrompt();
    const response = await callLLM(session.messages, tools, undefined, systemPrompt);

    // 统计 Token
    if (response.usage) {
      turnInputTokens += response.usage.input_tokens;
      turnOutputTokens += response.usage.output_tokens;
      session.stats.totalInputTokens += response.usage.input_tokens;
      session.stats.totalOutputTokens += response.usage.output_tokens;
      console.log(
        `   📊 [本步 Token] 输入: ${response.usage.input_tokens} | 输出: ${response.usage.output_tokens}`
      );
    }

    // 模型的回复追加到历史中
    session.messages.push({
      role: "assistant",
      content: response.content,
    });

    // 打印文本回复
    const textBlocks = response.content.filter((b) => b.type === "text");
    for (const tb of textBlocks) {
      if (tb.text) {
        console.log(`\n💬 [Agent 回复]:\n${tb.text}`);
      }
    }

    // 检查是否有工具调用
    const toolCalls = response.content.filter((b) => b.type === "tool_use");

    // 若无工具调用 -> 本轮完成
    if (toolCalls.length === 0) {
      console.log(`\n✅ [本轮任务完成] 共执行 ${step} 步思考与交互`);
      break;
    }

    // 若有工具调用 -> 执行并将结果追加进历史
    const toolResults: ContentBlock[] = [];
    for (const tc of toolCalls) {
      const toolName = tc.name;
      const toolId = tc.id!;
      const args = tc.input;

      console.log(`⚙️ [Harness 执行工具] ${toolName} -> 参数: ${JSON.stringify(args)}`);
      const resultText = await dispatchTool(toolName, args || {});

      console.log(`📥 [输出预览]: ${resultText.slice(0, 150)}${resultText.length > 150 ? "..." : ""}`);

      // 登记到看门狗记录中
      session.watchdog.recordToolExecution(step, toolName, args || {}, resultText);

      toolResults.push({
        type: "tool_result",
        tool_use_id: toolId,
        content: resultText,
      });
    }

    // 把工具输出作为 user 消息存入历史，供下一步作为输入
    session.messages.push({
      role: "user",
      content: toolResults,
    });

    // 【看门狗车道偏离检测】：检查是否需要注入自动警报或用户插话
    const steeringAlert = session.watchdog.inspectDeviation();
    if (steeringAlert) {
      console.log(`\n🛡️ [Harness 方向盘介入] 向模型强制注入纠偏指令！`);
      session.messages.push({
        role: "user",
        content: steeringAlert,
      });
    }
  }

  // 3. 【L1 治理触发】：本轮任务已结项，立即对历史中臃肿的 tool_result 脱水折叠
  const savedChars = dehydratePriorToolOutputs(session.messages);

  // 4. 本轮结束时的 Token 与上下文仪表盘
  const totalTokens = session.stats.totalInputTokens + session.stats.totalOutputTokens;
  console.log(`\n${"─".repeat(60)}`);
  console.log(`📈 [会话 Token 仪表盘]`);
  console.log(`   • 本轮消耗: 输入 ${turnInputTokens} + 输出 ${turnOutputTokens} = ${turnInputTokens + turnOutputTokens} Tokens`);
  console.log(`   • 会话累计: 输入 ${session.stats.totalInputTokens} + 输出 ${session.stats.totalOutputTokens} = ${totalTokens} Tokens`);
  console.log(`   • 内存留存历史消息: ${session.messages.length} 条`);
  if (savedChars > 0) {
    console.log(`   • 💧 [L1 工具脱水]: 自动挤压折叠了 ${savedChars} 个字符的原始工具冗余输出！`);
  }
  console.log(`${"─".repeat(60)}\n`);
}
