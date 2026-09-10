import { AgentSession, runAgentTurn } from "./loop.js";

async function runTest() {
  const session = new AgentSession();

  console.log(">>> [模拟用户输入 Turn 1]");
  await runAgentTurn(session, "你好，我是峰哥，我正在学习怎么从零写一个 Agent Harness。请简短回复。");

  console.log("\n>>> [模拟用户输入 Turn 2]");
  await runAgentTurn(session, "我叫什么名字？我刚才跟你说了我在做什么？");
}

runTest().catch(console.error);
