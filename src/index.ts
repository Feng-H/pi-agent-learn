import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { runAgentLoop } from "./loop.js";

async function main() {
  const argPrompt = process.argv.slice(2).join(" ").trim();

  // 如果命令行直接传了参数，例如: npm run dev -- "查询系统信息"
  if (argPrompt) {
    await runAgentLoop(argPrompt);
    return;
  }

  // 否则进入轻量 REPL 模式
  console.log("==================================================");
  console.log("  🚀 Pi Agent Minimal Harness (Stage 1)");
  console.log("  输入你的任务要求，按回车让 Agent 自主执行。输入 exit 退出。");
  console.log("==================================================\n");

  const rl = readline.createInterface({ input, output });

  try {
    while (true) {
      const query = await rl.question("\npi> ");
      const trimmed = query.trim();

      if (!trimmed) continue;
      if (trimmed === "exit" || trimmed === "quit") {
        console.log("Bye!");
        break;
      }

      await runAgentLoop(trimmed);
    }
  } finally {
    rl.close();
  }
}

main().catch(console.error);
