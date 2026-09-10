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
}

/**
 * 基础 LLM 单次调用函数
 * 输入: messages(对话上下文) + tools(可选的工具列表)
 * 输出: 模型的原始回复 (包含文本或 tool_use)
 */
export async function callLLM(
  messages: Message[],
  tools: ToolDefinition[] = [],
  model: string = DEFAULT_MODEL
): Promise<LLMResponse> {
  const payload: any = {
    model,
    max_tokens: 4096,
    messages,
  };

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
