import "dotenv/config";

// 1. 从环境变量中读取端点、密钥和模型名称
const BASE_URL = process.env.ANTHROPIC_BASE_URL;
const AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN;
const MODEL = process.env.ANTHROPIC_MODEL || "gemini-3.8-flash-high";

async function main() {
  console.log("正在向 API 发送最原始的单次请求...\n");

  // 2. 组装请求体（Payload）
  const payload = {
    model: MODEL,
    max_tokens: 100,
    // 对话列表：目前只有一句话
    messages: [
      { role: "user", content: "请用一句话介绍你自己。" }
    ]
  };

  // 3. 发送标准 HTTP POST 请求
  const response = await fetch(`${BASE_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": AUTH_TOKEN || "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify(payload),
  });

  // 4. 获取原始的 JSON 返回值
  const data = await response.json();

  console.log("=== 服务器返回的完整原始数据 (Raw JSON) ===");
  console.log(JSON.stringify(data, null, 2));
}

main().catch(console.error);
