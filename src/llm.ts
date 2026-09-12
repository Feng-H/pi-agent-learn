import "dotenv/config";

const BASE_URL = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
const AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN || "";
const DEFAULT_MODEL = process.env.ANTHROPIC_MODEL || "gemini-3.8-flash-high";

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: "object";
    properties: Record<string, any>;
    required?: string[];
  };
}

export interface ContentBlock {
  type: "text" | "tool_use" | "tool_result" | "thinking";
  text?: string;
  id?: string;
  name?: string;
  input?: any;
  tool_use_id?: string;
  content?: string;
  thinking?: string;
  signature?: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string | ContentBlock[];
}

export interface LLMResponse {
  id: string;
  role: "assistant";
  content: ContentBlock[];
  stop_reason: "end_turn" | "tool_use" | "max_tokens" | string;
  usage?: {
    input_tokens: number;
    output_tokens: number;
  };
}

/**
 * 消息管线规范器 (Message Pipeline Normalizer)
 * 严格遵循大模型 API（如 Anthropic Messages）状态机契约：
 * 1. 严格保证 user 与 assistant 角色交替，自动合并连续同角色消息；
 * 2. 保证首条消息角色必须为 user；
 * 3. 修复/降级孤儿 tool_result：若前置消息中不存在对应 id 的 tool_use，自动将 tool_result 降级为 text，杜绝 400 报错。
 */
export function normalizeMessages(messages: Message[]): Message[] {
  if (!messages || messages.length === 0) return [];

  const toBlocks = (content: string | ContentBlock[]): ContentBlock[] => {
    if (typeof content === "string") {
      return [{ type: "text", text: content }];
    }
    return content;
  };

  const merged: Message[] = [];

  for (const msg of messages) {
    if (!msg.content || (Array.isArray(msg.content) && msg.content.length === 0)) continue;

    if (merged.length === 0) {
      merged.push({
        role: msg.role,
        content: typeof msg.content === "string" ? msg.content : [...msg.content],
      });
    } else {
      const last = merged[merged.length - 1];
      if (last.role === msg.role) {
        // 合并连续相同角色的消息
        const lastBlocks = toBlocks(last.content);
        const curBlocks = toBlocks(msg.content);
        last.content = [...lastBlocks, ...curBlocks];
      } else {
        merged.push({
          role: msg.role,
          content: typeof msg.content === "string" ? msg.content : [...msg.content],
        });
      }
    }
  }

  // 孤儿 tool_result 检查与修剪
  for (let i = 0; i < merged.length; i++) {
    const cur = merged[i];
    if (cur.role === "user" && Array.isArray(cur.content)) {
      const prev = i > 0 ? merged[i - 1] : null;
      const validToolUseIds = new Set<string>();
      if (prev && prev.role === "assistant" && Array.isArray(prev.content)) {
        for (const b of prev.content) {
          if (b.type === "tool_use" && b.id) {
            validToolUseIds.add(b.id);
          }
        }
      }

      cur.content = cur.content.map((b) => {
        if (b.type === "tool_result" && b.tool_use_id && !validToolUseIds.has(b.tool_use_id)) {
          return {
            type: "text",
            text: `[历史工具输出 (已脱敏归档 ID: ${b.tool_use_id})]:\n${b.content || ""}`,
          };
        }
        return b;
      });
    }
  }

  return merged;
}

/**
 * 基础 LLM 单次调用函数
 * 输入: messages(对话上下文) + tools(可选的工具列表)
 * 输出: 模型的原始回复 (包含文本或 tool_use)
 */
export async function callLLM(
  messages: Message[],
  tools: ToolDefinition[] = [],
  model: string = DEFAULT_MODEL,
  systemPrompt?: string
): Promise<LLMResponse> {
  const cleanMessages = normalizeMessages(messages);
  const payload: any = {
    model,
    max_tokens: 4096,
    messages: cleanMessages,
  };

  if (systemPrompt && systemPrompt.trim()) {
    payload.system = systemPrompt.trim();
  }

  if (tools.length > 0) {
    payload.tools = tools;
  }

  const res = await fetch(`${BASE_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": AUTH_TOKEN,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`LLM API request failed [${res.status}]: ${errorText}`);
  }

  return (await res.json()) as LLMResponse;
}
