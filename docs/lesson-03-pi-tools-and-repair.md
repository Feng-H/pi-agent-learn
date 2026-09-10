# 第三讲复盘：Pi 风格工具箱架构与自主代码修复实战

> “工具不是单纯的函数，它是 Harness 给模型划定的安全作业面与防错围栏。”

本篇文档记录了我们在第三阶段中，基于 Pi（[pi.dev](https://pi.dev)）的设计哲学，告别单一 `bash`，构建专业级文件操作工具箱（`read_file` / `write_file` / `edit_file`），并成功让 Agent 自主修复源码中 Bug 的全过程。

---

## 一、为什么不能“一个 Bash 走天下”？

1. **转义字符地狱**：用 `echo` 或 `cat << EOF` 写入复杂代码时，多层引号和换行极易错乱，导致代码被截断；
2. **上下文暴击**：无节制地使用 `cat` 阅读大文件，一次命令就会吞噬上万 Token；
3. **权限无法细分**：Harness 无法从复杂的 shell 字符串中轻易分辨“只读安全操作”还是“破坏性删除”。

---

## 二、Pi 风格的三大核心文件工具与防错设计

### 1. `read_file`：带行号的分页探针
- **防爆设计**：强制提供 `offset`（起始行号）与 `limit`（读取行数，默认 200 行）；
- **行号呈现**：每行前缀 6 位右对齐行号（如 `     4\texport function...`），为后续的精准修改提供空间坐标。

### 2. `write_file`：原子覆盖与自动建目录
- 只有在新建文件或明确需要整文件覆盖时调用；
- 写入前通过 `fs.mkdirSync(..., { recursive: true })` 自动补全各级不存在的父目录。

### 3. `edit_file`：精准局部替换（整个 Harness 的灵魂）
这是 Pi 区别于劣质 Agent 最核心的设计——**绝不全量重写整个文件**：
- **输入参数**：`path`、`old_string`、`new_string`；
- **Harness 三重防错校验（Guardrails）**：
  1. `old_string` 必须在原文件中存在；如果不存在，报错提示模型“请先调用 read_file 核对精确缩进与换行”；
  2. `old_string` 与 `new_string` 不能相同；
  3. `old_string` 在文件中**必须唯一出现**（出现多次则报错存在歧义，逼迫模型扩充上下文行数，防止误伤无辜代码）。

---

## 三、实战演练：Agent 自主阅读、精准修复与跑测

我们构造了一个真实存在逻辑 Bug 的测试模块 `src/sample-calculator.ts`（乘法写成了加法导致测试报错），然后下达指令：

```text
"src/sample-calculator.ts 中的乘法函数似乎有 Bug，请帮我阅读该文件，使用 edit_file 修复它，然后运行 npx tsx src/test-calculator.ts 确认通过。"
```

### Agent 的自主行动轨迹：
1. **[Step 1] 阅读**：主动调用 `read_file`，定位到了第 8-11 行的 Bug 所在；
2. **[Step 2] 精准修改**：遵守 `AGENTS.md` 规范，调用 `edit_file` 将 `return a + b;` 单独替换为 `return a * b;`；
3. **[Step 3] 验证**：调用 `bash` 执行 `npx tsx src/test-calculator.ts`，捕获到测试全绿通过；
4. **[Step 4] 交付**：遵守 `AGENTS.md` 规定，直呼“峰哥”，简明扼要汇报修复结果；
5. **[治理介入]**：L1 脱水自动折叠多余日志，准备好迎接下一轮对话。
