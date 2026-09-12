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

  // 共享终端问答器，避免多实例竞争 stdin
  let isPromptingApproval = false;
  session.permissionGate.setApprovalHandler(async (q) => {
    isPromptingApproval = true;
    try {
      return await rl.question(q);
    } finally {
      isPromptingApproval = false;
    }
  });

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

      // 在模型思考与工具执行期间，监听终端用户随意敲下的插话指令
      const steerListener = (line: string) => {
        if (isPromptingApproval) return;
        const steerText = line.trim();
        if (steerText) {
          session.watchdog.pushHumanSteering(steerText);
          console.log(`\n🚨 [人工握紧方向盘] 捕获实时插话指令: "${steerText}"，将在模型下一步行动前强制介入！`);
        }
      };

      rl.on("line", steerListener);
      try {
        await runAgentTurn(session, trimmed);
      } finally {
        rl.removeListener("line", steerListener);
      }
    }
  } finally {
    rl.close();
  }
}

main().catch(console.error);
