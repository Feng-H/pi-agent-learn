import { callLLM, normalizeMessages, type Message, type ContentBlock } from "./llm.js";

export interface GovernanceResult {
  l1CharsDehydrated: number;
  l2Compacted: boolean;
  distillationSummary?: string;
}

const COMPACT_TOKEN_WATERMARK = 1500; // 累计/单次 token 超过此值触发蒸馏
const COMPACT_MESSAGE_COUNT_WATERMARK = 6; // 消息条数超过此值触发蒸馏

/**
 * 【第一层治理：L1 工具输出脱水 (Tool Output Dehydration)】
 * 在每一轮人机交互结束后触发。
 * 对历史中臃肿的 tool_result 进行脱水折叠，只留开头和结尾预览。
 */
export function dehydratePriorToolOutputs(messages: Message[]): number {
  // 1. 建立 tool_use_id -> toolName 索引，进行精准工具语义识别
  const toolNameMap = new Map<string, string>();
  for (const msg of messages) {
    if (msg.role === "assistant" && Array.isArray(msg.content)) {
      for (const block of msg.content) {
        if (block.type === "tool_use" && block.id && block.name) {
          toolNameMap.set(block.id, block.name);
        }
      }
    }
  }

  let totalSavedChars = 0;

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i];
    if (msg.role !== "user" || !Array.isArray(msg.content)) continue;

    for (const block of msg.content) {
      if (block.type === "tool_result" && typeof block.content === "string") {
        const toolName = block.tool_use_id ? toolNameMap.get(block.tool_use_id) : undefined;
        const originalLen = block.content.length;

        // 🛡️ 差异化脱水策略：
        // - read_file: 代码源码是后续精准 edit_file 的核心真值，严禁激进脱水！除非超大文件(>8000字符)
        // - bash: 日志、git log、编译信息容易巨额膨胀，超过 400 字符果断脱水
        // - write_file / edit_file: 仅有几行状态回执，保持原样
        if (toolName === "read_file") {
          if (originalLen > 8000) {
            const head = block.content.slice(0, 1000);
            const tail = block.content.slice(-500);
            const omitted = originalLen - 1500;
            block.content = `${head}\n... [💧 Harness L1 脱水：已折叠 ${omitted} 字符过长源码切片，若需修改请先 read_file 局部指定行] ...\n${tail}`;
            totalSavedChars += omitted;
          }
          continue;
        }

        if (toolName === "edit_file" || toolName === "write_file") {
          continue;
        }

        const threshold = toolName === "bash" ? 400 : 800;
        if (originalLen > threshold) {
          const head = block.content.slice(0, 120);
          const tail = block.content.slice(-80);
          const omitted = originalLen - 200;
          block.content = `${head}\n... [💧 Harness L1 脱水：已折叠 ${omitted} 字符冗余日志，结论已由模型在当轮沉淀] ...\n${tail}`;
          totalSavedChars += omitted;
        }
      }
    }
  }

  return totalSavedChars;
}

/**
 * 【第二层治理：L2 宏观滚动蒸馏 (Rolling Distillation)】
 * 当会话上下文消息数或 Token 达到警戒水位线时触发。
 * 将早期轮次自动化蒸馏为一份精炼的【事实备忘录 (Memory Ledger)】，保留最新活跃轮次。
 */
export async function compactSessionIfNeeded(
  messages: Message[],
  latestInputTokens: number
): Promise<{ compacted: boolean; summary?: string }> {
  // 仅在消息总数达到警戒线，或 Token 水位过高时触发
  const needCompact =
    messages.length >= COMPACT_MESSAGE_COUNT_WATERMARK ||
    latestInputTokens >= COMPACT_TOKEN_WATERMARK;

  if (!needCompact || messages.length <= 3) {
    return { compacted: false };
  }

  console.log(`\n🌀 [Harness L2 触发] 检测到历史消息达 ${messages.length} 条 (Token 水位: ${latestInputTokens})，启动自动记忆蒸馏...`);

  // 🛡️ 安全轮次切分：寻找最近一个完整人类指令作为边界，严禁将 tool_use 与 tool_result 拦腰切断
  let splitIndex = -1;
  for (let i = messages.length - 1; i >= 1; i--) {
    const msg = messages[i];
    if (msg.role === "user" && typeof msg.content === "string") {
      splitIndex = i;
      break;
    }
  }

  if (splitIndex <= 0) {
    splitIndex = Math.max(1, messages.length - 2);
  }

  const coldMessages = messages.slice(0, splitIndex);
  const hotMessages = messages.slice(splitIndex);

  // 构造蒸馏专用提示词
  const distillationMessages: Message[] = [
    ...coldMessages,
    {
      role: "user",
      content:
        "【系统指令】：请将上述早期的对话历史，提炼为一份核心事实备忘录（Memory Ledger）。请包含：\n1. 用户的身份/核心意图与偏好；\n2. 已经确立的核心事实与已完成的操作；\n3. 重要的参数或配置信息。\n请用结构化要点输出，极其精炼，不要废话。",
    },
  ];

  try {
    const distillResponse = await callLLM(distillationMessages, [], "gemini-3.8-flash-high");
    const summaryBlock = distillResponse.content.find((b) => b.type === "text");
    const summaryText = summaryBlock?.text || "（历史记录已归档）";

    // 重新拼装 messages：由备忘录 + 最新的活跃对话构成
    const memoryLedgerMessage: Message = {
      role: "user",
      content: `【🧠 系统长期记忆备忘录 (Memory Ledger)】\n${summaryText}`,
    };

    // 结合 normalizeMessages 保证角色严格交替与孤儿工具清理
    const assembled = normalizeMessages([memoryLedgerMessage, ...hotMessages]);
    messages.length = 0;
    messages.push(...assembled);

    console.log(`✨ [Harness L2 完成] 成功将 ${coldMessages.length} 条早期消息蒸馏为长期记忆备忘录！`);
    return { compacted: true, summary: summaryText };
  } catch (err: any) {
    console.log(`⚠️ [Harness L2 异常] 自动蒸馏失败，保留原始消息: ${err.message}`);
    return { compacted: false };
  }
}
