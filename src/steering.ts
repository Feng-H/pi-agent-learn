import type { Message, ContentBlock } from "./llm.js";

export interface ToolExecutionRecord {
  step: number;
  toolName: string;
  argsSignature: string;
  isError: boolean;
  outputPreview: string;
}

export class SteeringWatchdog {
  private history: ToolExecutionRecord[] = [];
  private humanSteeringQueue: string[] = [];
  private consecutiveErrors = 0;
  private autoInterventionsCount = 0;

  /** 用户随时在终端插话，塞入纠偏队列 */
  public pushHumanSteering(text: string) {
    this.humanSteeringQueue.push(text);
  }

  /** 获取排队的人工纠偏指令 */
  public popHumanSteering(): string | undefined {
    return this.humanSteeringQueue.shift();
  }

  /** 记录一次工具调用的执行结果 */
  public recordToolExecution(
    step: number,
    toolName: string,
    args: Record<string, any>,
    output: string
  ) {
    const isError =
      output.startsWith("Error:") ||
      output.includes("[Command Error]") ||
      output.includes("command not found") ||
      output.includes("fatal:");

    if (isError) {
      this.consecutiveErrors++;
    } else {
      this.consecutiveErrors = 0;
    }

    const argsSignature = `${toolName}:${JSON.stringify(args)}`;
    this.history.push({
      step,
      toolName,
      argsSignature,
      isError,
      outputPreview: output.slice(0, 100),
    });
  }

  /**
   * 核心看门狗：车道偏航检测
   * 返回纠偏警告文本；若正常则返回 null
   */
  public inspectDeviation(): string | null {
    // 1. 人工指令最高优先：如果有用户人工插话，直接返回人工纠偏
    const humanInput = this.popHumanSteering();
    if (humanInput) {
      console.log(`\n🚨 [人工握紧方向盘] 检测到用户中途介入指令: "${humanInput}"`);
      return `【用户中途直接介入指导 (Human Steering)】：\n"${humanInput}"\n请立即停止原计划，遵从用户的最新指导调整方向！`;
    }

    // 2. 自动检测 A：鬼打墙死循环（连续 2 次发起完全一样的工具调用）
    const len = this.history.length;
    if (len >= 2) {
      const last = this.history[len - 1];
      const prev = this.history[len - 2];
      if (last.argsSignature === prev.argsSignature) {
        this.autoInterventionsCount++;
        console.log(`\n⚠️ [看门狗拉响警报] 检测到模型正在执行完全重复的工具调用: ${last.toolName}`);
        return (
          `🚨 【Harness 自动车道保持警报 / Loop Detected】\n` +
          `系统检测到你连续两次执行了完全相同的操作（${last.argsSignature}）！\n` +
          `你显然已经陷入了死循环或逻辑死胡同。\n` +
          `【强制要求】：\n` +
          `1. 严禁再次调用相同的参数；\n` +
          `2. 停下来先输出反思：为什么刚才的方法没有产生预期效果？\n` +
          `3. 提出一个截然不同的新假说或新工具来破局。`
        );
      }
    }

    // 3. 自动检测 B：硬撞南墙（连续 2 次工具调用报错失败）
    if (this.consecutiveErrors >= 2) {
      this.autoInterventionsCount++;
      const lastErr = this.history[len - 1]?.outputPreview || "未知错误";
      console.log(`\n⚠️ [看门狗拉响警报] 模型已连续 ${this.consecutiveErrors} 次执行报错，硬撞南墙！`);
      return (
        `🚨 【Harness 自动车道保持警报 / Consecutive Failures】\n` +
        `系统检测到你已经连续 ${this.consecutiveErrors} 次操作报错失败！（最近一次错误: ${lastErr}）\n` +
        `你当前的路线显然存在重大盲区，继续盲试只会徒劳烧毁 Token！\n` +
        `【强制要求】：\n` +
        `1. 暂停当前代码或命令尝试；\n` +
        `2. 退后一步，仔细分析报错背后的底层根因；\n` +
        `3. 换一条全新路线，或者先用 read_file 检查周边上下文环境再做决策。`
      );
    }

    return null;
  }

  public resetTurn() {
    this.history = [];
    this.consecutiveErrors = 0;
  }
}
