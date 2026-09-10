import { AgentSession, runAgentTurn } from "./loop.js";

async function testGovernance() {
  const session = new AgentSession();

  console.log("\n🧪 ========== 测试 1: 建立初始上下文 ==========");
  await runAgentTurn(session, "你好！我是峰哥，我正在用 TypeScript 开发一个极简 Agent Harness。请简要确认。");

  console.log("\n🧪 ========== 测试 2: 触发大体积工具调用（验证 L1 脱水） ==========");
  await runAgentTurn(session, "请用 bash 执行 git log -n 5，并为我简要总结最近的提交记录。");

  console.log("\n🧪 ========== 测试 3: 累积轮次跨越警戒线（验证 L2 自动记忆蒸馏） ==========");
  await runAgentTurn(session, "我们刚才测试了什么？请用一两句话回答。");

  console.log("\n🧪 ========== 测试 4: 终极验证——有效信息是否无损传承？ ==========");
  await runAgentTurn(session, "请综合回顾：我叫什么？我的核心项目是什么？我们之前查到的 git 最近一次提交是什么？");
}

testGovernance().catch(console.error);
