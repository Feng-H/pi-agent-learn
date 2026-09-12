import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import path from "node:path";

export type SecurityLevel = "safe" | "sensitive" | "dangerous";

export interface PermissionDecision {
  allowed: boolean;
  reason?: string;
  securityLevel: SecurityLevel;
}

// 永远受到最高级别保护的敏感路径或模式
const PROTECTED_PATTERNS = [
  /\.env($|\.)/i,
  /id_rsa/i,
  /\.ssh\//i,
  /\.git\//i,
  /passwd/i,
  /shadow/i,
];

// 明确判定为破坏性高危的命令特征
const DANGEROUS_COMMAND_PATTERNS = [
  /\brm\s+(-[a-zA-Z]*r[a-zA-Z]*\s+|--recursive\s+)/i, // rm -rf
  /\bgit\s+clean\b/i,
  /\bgit\s+reset\s+--hard\b/i,
  /\bmkfs\b/i,
  /\bdd\s+if=/i,
  />\s*\/dev\/[a-z0-9]+/i,
  /\bshutdown\b/i,
  /\breboot\b/i,
  /\bkill\s+-9\b/i,
];

export class PermissionGate {
  private autoApproveSession = false;
  private approvalHandler?: (questionText: string) => Promise<string>;

  /** 注入共享的终端交互问答器，避免并发关闭 stdin */
  public setApprovalHandler(handler: (questionText: string) => Promise<string>) {
    this.approvalHandler = handler;
  }

  /**
   * 深度分析 Bash 命令的原子构成，防止分号、管道、&& 逻辑拼接逃逸
   */
  private assessBashRisk(cmd: string): { level: SecurityLevel; warning: string } {
    const trimmed = cmd.trim();

    // 1. 高危模式全局硬扫描
    for (const pat of DANGEROUS_COMMAND_PATTERNS) {
      if (pat.test(trimmed)) {
        return { level: "dangerous", warning: `检测到不可逆的高危命令模式: "${trimmed}"` };
      }
    }
    for (const pat of PROTECTED_PATTERNS) {
      if (pat.test(trimmed)) {
        return { level: "dangerous", warning: `命令中涉及核心机密或受保护文件/路径: "${trimmed}"` };
      }
    }

    // 2. 检测命令替换与动态执行符号：$(...), `...`, <(...)
    if (/\$\(.*\)|`.*`|<\(.*\)/.test(trimmed)) {
      return { level: "sensitive", warning: `检测到含有动态子命令执行: "${trimmed}"` };
    }

    // 3. 将复合命令按操作符拆解为原子子命令列表
    // 拆分控制操作符: &&, ||, ;, |, 换行
    const subCmds = trimmed.split(/&&|\|\||;|\||\n/).map((s) => s.trim()).filter(Boolean);

    // 白名单定义：纯只读命令前缀
    const safeSingleCommands = new Set(["pwd", "whoami", "uname", "which", "echo"]);
    const safeReadBinaries = new Set(["ls", "cat", "head", "tail", "wc", "grep", "rg"]);
    const safeGitSubcommands = new Set(["status", "log", "diff", "branch", "tag", "show"]);

    let allSafe = true;

    for (const sub of subCmds) {
      // 如果子命令包含重定向写操作 (> 或 >>)，绝非只读安全命令
      if (/>>|(?<!\d)>(?!\d)/.test(sub)) {
        allSafe = false;
        break;
      }

      const tokens = sub.split(/\s+/).filter(Boolean);
      if (tokens.length === 0) continue;

      const bin = tokens[0];

      if (bin === "git") {
        const gitSub = tokens[1] || "";
        if (!safeGitSubcommands.has(gitSub)) {
          allSafe = false;
          break;
        }
      } else if (safeSingleCommands.has(bin) || safeReadBinaries.has(bin)) {
        // 只读命令放行
        continue;
      } else {
        // 任何不在纯只读白名单内的子指令（如编译、写入、删除、网络请求）
        allSafe = false;
        break;
      }
    }

    if (allSafe && subCmds.length > 0) {
      return { level: "safe", warning: "" };
    }

    return { level: "sensitive", warning: `即将执行自定义 Shell 命令: "${trimmed}"` };
  }

  /**
   * 判定一个工具调用及其参数的安全等级
   */
  public assessRisk(toolName: string, args: Record<string, any>): { level: SecurityLevel; warning: string } {
    // 1. 只读类工具：完全安全，直接放行
    if (toolName === "read_file") {
      const filePath = String(args.path || "");
      for (const pat of PROTECTED_PATTERNS) {
        if (pat.test(filePath)) {
          return { level: "sensitive", warning: `尝试读取受保护的敏感文件: "${filePath}"` };
        }
      }
      return { level: "safe", warning: "" };
    }

    // 2. 文件修改类工具：中度敏感
    if (toolName === "write_file" || toolName === "edit_file") {
      const filePath = String(args.path || "");
      for (const pat of PROTECTED_PATTERNS) {
        if (pat.test(filePath)) {
          return { level: "dangerous", warning: `严禁直接修改核心受保护文件: "${filePath}"` };
        }
      }
      return { level: "sensitive", warning: `即将修改工作区文件: "${filePath}"` };
    }

    // 3. Bash 执行类工具：深度原子级解析
    if (toolName === "bash") {
      return this.assessBashRisk(String(args.command || ""));
    }

    return { level: "sensitive", warning: `未知工具调用: ${toolName}` };
  }

  /**
   * 闸门决策器：
   * - 安全操作：自动放行
   * - 敏感/危险操作：拦截挂起，在终端向用户请求审批 [y/n/always]
   */
  public async requestApproval(
    toolName: string,
    args: Record<string, any>,
    mockInput?: string
  ): Promise<PermissionDecision> {
    const { level, warning } = this.assessRisk(toolName, args);

    // 1. 安全操作，无缝自动放行
    if (level === "safe") {
      return { allowed: true, securityLevel: level };
    }

    // 2. 如果用户之前选择了 "always"，并且不是极度危险的命令，则自动放行
    if (this.autoApproveSession && level !== "dangerous") {
      return { allowed: true, securityLevel: level };
    }

    // 3. 拦截！向人类指挥官请求审批
    console.log(`\n${"🛑".repeat(30)}`);
    console.log(`🛡️  【Harness 权限闸门 / Permission Gate 拦截生效】`);
    console.log(`   • 风险等级: ${level === "dangerous" ? "🔥 极度危险 (DANGEROUS)" : "⚠️ 中度敏感 (SENSITIVE)"}`);
    console.log(`   • 拦截原因: ${warning}`);
    console.log(`   • 申请工具: ${toolName}`);
    console.log(`   • 参数详情: ${JSON.stringify(args, null, 2)}`);
    console.log(`${"🛑".repeat(30)}`);

    let answer = "";
    if (mockInput !== undefined) {
      // 自动化测试通道
      answer = mockInput.trim().toLowerCase();
      console.log(`[测试模拟用户输入]: ${answer}`);
    } else if (this.approvalHandler) {
      // 使用共享的 REPL 终端交互器
      answer = (
        await this.approvalHandler(`👉 是否批准执行该操作？ [y = 批准一次 / n = 拒绝 / a = 本次会话全部信任]: `)
      )
        .trim()
        .toLowerCase();
    } else {
      const rl = readline.createInterface({ input, output });
      try {
        answer = (
          await rl.question(`👉 是否批准执行该操作？ [y = 批准一次 / n = 拒绝 / a = 本次会话全部信任]: `)
        )
          .trim()
          .toLowerCase();
      } finally {
        rl.close();
      }
    }

    if (answer === "y" || answer === "yes") {
      console.log(`✅ [用户授权] 操作已放行执行。\n`);
      return { allowed: true, securityLevel: level };
    } else if (answer === "a" || answer === "always") {
      this.autoApproveSession = true;
      console.log(`🔓 [信任模式] 已开启本次会话全信任模式（极度危险命令仍将被审核）。\n`);
      return { allowed: true, securityLevel: level };
    } else {
      console.log(`❌ [用户拒绝] 操作被人类指挥官否决！\n`);
      return {
        allowed: false,
        reason: `Permission Denied: 用户（人类指挥官）在审核后明确拒绝了此操作 [${warning}]。请不要强行重试，停下来重新思考并换一个安全的方案。`,
        securityLevel: level,
      };
    }
  }

  public reset() {
    this.autoApproveSession = false;
  }
}
