import "dotenv/config";

const BASE_URL = process.env.ANTHROPIC_BASE_URL || "https://api.anthropic.com";
const AUTH_TOKEN = process.env.ANTHROPIC_AUTH_TOKEN || "";
const MODEL = process.env.ANTHROPIC_MODEL || "gemini-3.8-flash-high";

async function test() {
  console.log("Testing connection with model:", MODEL);
  const res = await fetch(`${BASE_URL}/v1/messages`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": AUTH_TOKEN,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 256,
      tools: [
        {
          name: "get_weather",
          description: "Get current temperature in a city",
          input_schema: {
            type: "object",
            properties: {
              city: { type: "string", description: "City name" }
            },
            required: ["city"]
          }
        }
      ],
      messages: [
        { role: "user", content: "What is the weather in Tokyo?" }
      ]
    })
  });

  const data = await res.json();
  console.log("Response status:", res.status);
  console.log("Response content:", JSON.stringify(data.content, null, 2));
}

test().catch(console.error);
