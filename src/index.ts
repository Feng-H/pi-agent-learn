import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { AgentSession, runAgentTurn } from "./loop.js";

async function main() {
  const argPrompt = process.argv.slice(2).join(" ").trim();
  const session = new AgentSession();

  // 单次命令行直接传参
  if (argPrompt) {
    await runAgentTurn(session, argPrompt);
    return;
  }

  // 多轮交互式 REPL
  console.log("===============================================================");
  console.log("  🚀 Pi Agent Harness (Stage 2.1: Multi-Turn Stateful REPL)");
  console.log("  • 支持连续多轮对话与上下文记忆");
  console.log("  • 输入 /clear 清空历史");
  console.log("  • 输入 exit 退出");
  console.log("===============================================================\n");

  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const query = await rl.question("pi> ");
      const trimmed = query.trim();

      if (!trimmed) continue;
      if (trimmed === "exit" || trimmed === "quit") {
        console.log("Bye!");
        break;
      }

      if (trimmed === "/clear") {
        session.clear();
        continue;
      }

      await runAgentTurn(session, trimmed);
    }
  } finally {
    rl.close();
  }
}

main().catch(console.error);
