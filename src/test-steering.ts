import { AgentSession, runAgentTurn } from "./loop.js";

async function testSteering() {
  const session = new AgentSession();

  console.log("\n🧪 ========== 场景 1: 触发“连续报错硬撞南墙”自愈纠偏 ==========");
  // 下达一个会诱导模型尝试错误路径的任务（比如读取一个拼写错误的不存在的文件）
  await runAgentTurn(
    session,
    "请帮我读取 src/no-such-config.json 并总结配置；如果读取不到，请尝试 read_file src/non_existent_fallback.json；若仍失败，请反思并告诉我替代方案。"
  );

  console.log("\n🧪 ========== 场景 2: 人工中途介入纠偏 (Human Steering) ==========");
  // 模拟用户在它执行前插入了一句关键提示
  session.watchdog.pushHumanSteering("不用找那个 json 了，其实配置在 package.json 里面，请去读 package.json");

  await runAgentTurn(session, "请继续帮我获取项目名称。");
}

testSteering().catch(console.error);
