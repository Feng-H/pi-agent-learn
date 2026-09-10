import { callLLM, type Message, type ContentBlock, type ToolDefinition } from "./llm.js";
import { bashToolDefinition, executeBash } from "./tools.js";

interface RunOptions {
  maxSteps?: number;
}

/**
 * 核心 Agent 循环 (ReAct Loop)
 * @param userPrompt 用户下达的初始指令
 * @param options 可选配置 (如最大步数)
 */
export async function runAgentLoop(userPrompt: string, options: RunOptions = {}) {
  const { maxSteps = 10 } = options;
  const tools: ToolDefinition[] = [bashToolDefinition];

  // 1. 初始化对话历史 (上下文)
  const messages: Message[] = [
    { role: "user", content: userPrompt },
  ];

  console.log(`\n🤖 [Agent 启动] 目标: "${userPrompt}"\n${"─".repeat(50)}`);

  let step = 0;

  // 2. 核心 while 循环: 只要目标没达成且没超过最大步数就一直跑
  while (step < maxSteps) {
    step++;
    console.log(`\n▶ [Step ${step}] 正在请求模型决策...`);

    // ① 把历史上下文发送给 LLM
    const response = await callLLM(messages, tools);

    // ② 记录模型的回复到历史中 (保持上下文完整)
    messages.push({
      role: "assistant",
      content: response.content,
    });

    // ③ 检查模型是否输出了普通文本回答
    const textBlocks = response.content.filter((b) => b.type === "text");
    for (const tb of textBlocks) {
      if (tb.text) {
        console.log(`💬 [Agent 思考/回复]:\n${tb.text}`);
      }
    }

    // ④ 核心判断标准: 检查模型是否需要调用工具
    const toolCalls = response.content.filter((b) => b.type === "tool_use");

    // 标准 A: 如果没有任何工具调用请求 -> 目标已达成 (自然结束)
    if (toolCalls.length === 0) {
      console.log(`\n✅ [目标达成] Agent 认为任务已完成，退出循环 (共执行 ${step} 步)`);
      return;
    }

    // 标准 B: 如果有工具调用 -> Harness 介入执行工具，并将结果喂回模型
    const toolResults: ContentBlock[] = [];

    for (const tc of toolCalls) {
      const toolName = tc.name;
      const toolId = tc.id!;
      const args = tc.input;

      console.log(`⚙️ [Harness 拦截执行] 工具: ${toolName}, 参数: ${JSON.stringify(args)}`);

      let resultText = "";
      if (toolName === "bash") {
        resultText = await executeBash(args.command);
      } else {
        resultText = `Unknown tool: ${toolName}`;
      }

      console.log(`📥 [工具返回输出]:\n${resultText.slice(0, 300)}${resultText.length > 300 ? "..." : ""}`);

      // 组装 tool_result 块
      toolResults.push({
        type: "tool_result",
        tool_use_id: toolId,
        content: resultText,
      });
    }

    // ⑤ 将本轮工具的执行结果，作为新的输入消息 (role: "user") 追加到历史中
    messages.push({
      role: "user",
      content: toolResults,
    });

    // 循环继续: 下一轮会带着这个 tool_result 再次请求 LLM
  }

  // 标准 C: 达到最大步数兜底，强行打断
  console.log(`\n⚠️ [安全退出] 已达到最大限制步数 (${maxSteps})，终止循环以防止死循环。`);
}
