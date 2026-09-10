# Building a Coding Agent Harness from Scratch (pi-agent-learn)

> "There are many agent harnesses, but this one is yours." — inspired by [pi.dev](https://pi.dev)

本项目是一个交互式构建的 Coding Agent Harness 学习旅程与完整实现仓库。
通过 **Vibe Coding** 驱动，从第一行代码开始，逐步演进出一个安全、可控、极简且功能齐备的终端智能体系统。

---

## 路线图与学习进度

- [x] **阶段零：脚手架搭建与环境验证**
  - 初始化 TypeScript / Node.js ESM 环境
  - 接入 Anthropic 协议模型端点，验证 Tool Calling 基础连通性
- [x] **阶段一：极简 Agent 核心循环与协议解构 (Minimal ReAct Loop & Protocols)**
  - 实现状态机消息驱动循环（LLM 请求 -> Harness 拦截执行 -> 反馈结果）
  - 裁判权辨析：“LLM 不能既当运动员，又当裁判”
  - 通用场景验收契约机制设计
  - 三大协议深度剖析：OpenAI Chat vs Anthropic Messages vs OpenAI Responses
  - 实战攻坚：为 VPS 网关编写透明中间件，以 SQLite TTL 方案真正打通状态化 Responses 记忆链路
  - 📖 **详细研学复盘**：[docs/lesson-01-dialogue-and-learnings.md](./docs/lesson-01-dialogue-and-learnings.md)
- [x] **阶段二：多轮长上下文治理与不可变规则金字塔 (Context Governance & Rule Pyramid)**
  - 多轮会话生命周期与实时 Token 仪表盘
  - 拒绝粗暴人工截断，构建双层全自动治理（L1 单轮工具脱水 + L2 跨轮滚动蒸馏）
  - 破除规则漂移：解构不可变宪法层（代码 System Prompt vs 项目文件 `AGENTS.md`）
  - 📖 **详细研学复盘**：[docs/lesson-02-context-and-rules.md](./docs/lesson-02-context-and-rules.md)
- [x] **阶段三：Pi 风格核心文件工具箱与自主代码修复 (Pi-Style Tools & Self-Repair)**
  - 破除“单一 Bash 依赖”：转义符灾难与上下文防爆考量
  - 实现三大核心工具：
    - `read_file`：行号分页与局部切片
    - `write_file`：原子覆盖与自动目录补全
    - `edit_file`：精准字符串替换与三重防错防歧义（Guardrails）
  - 融合 System Prompt 与 `AGENTS.md` 双重规范注入
  - 端到端实测：Agent 自主阅读、精准修复 `sample-calculator` 中的 Bug 并跑测通过
  - 📖 **详细研学复盘**：[docs/lesson-03-pi-tools-and-repair.md](./docs/lesson-03-pi-tools-and-repair.md)
- [ ] **阶段四：打造方向盘与刹车 (Permission & Steering 机制)**

---

## 快速开始

### 1. 安装依赖
```bash
npm install
```

### 2. 配置环境变量
复制 `.env.example` 为 `.env` 并填写 API 密钥与端点：
```bash
cp .env.example .env
```

### 3. 运行测试
```bash
npm run dev
```
