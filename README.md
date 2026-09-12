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
  - 实现三大核心工具（`read_file` / `write_file` / `edit_file`）
  - 融合 System Prompt 与 `AGENTS.md` 双重规范注入
  - 端到端实测：Agent 自主阅读、精准修复 `sample-calculator` 中的 Bug 并跑测通过
  - 📖 **详细研学复盘**：[docs/lesson-03-pi-tools-and-repair.md](./docs/lesson-03-pi-tools-and-repair.md)
- [x] **阶段四：双轨方向盘与自动车道保持看门狗 (Steering Watchdog & Interruption)**
  - 破除“人肉盯盘”假设：解决人不在电脑前 Agent 撞南墙白烧 Token 的核心痛点
  - 打造双轨纠偏系统（自动看门狗车道保持 + 人工插话队列）
  - 📖 **详细研学复盘**：[docs/lesson-04-steering-watchdog.md](./docs/lesson-04-steering-watchdog.md)
- [x] **阶段五：安全气囊与刹车系统 (Permission Gate 权限分级拦截门)**
  - 拒绝“狼来了”式的全量弹窗骚扰，确立三级安全光谱机制：
    - `SAFE`（只读操作）：完全静默、自动放行
    - `SENSITIVE`（文件修改/常规命令）：审批确认，支持 `[y]` 批准与 `[a]` 会话信任
    - `DANGEROUS`（高危删除/机密敏感路径）：刹车绝对咬死，杜绝破坏性灾难
  - 端到端实测：拦截高危 `rm -rf`，用户否决后模型自主停止破坏并体面复盘
  - 📖 **详细研学复盘**：[docs/lesson-05-permission-gate.md](./docs/lesson-05-permission-gate.md)
- [x] **阶段六：工业级防线硬化与架构健壮性重构 (Industrial Hardening & Protocol Normalizer)**
  - 对标 **CMU 11-768 (AI Agents)** 核心要求：Assignment 1 · Harness 工业级标准
  - 消息状态机规范器（`normalizeMessages`）：保证角色严格交替，自动修复/降级孤儿 `tool_result`
  - 工具类型感知 L1 差异化脱水：源码（`read_file`）保真留存，仅对臃肿命令日志（`bash`）折叠
  - 权限闸门原子级 Shell 拆解：按操作符（`&&` / `||` / `;` / `|` / `>`）切分子命令，封死前缀逃逸漏洞
  - REPL 异步非阻塞实时插话：在 Agent 单轮思考与工具执行中随时捕获键盘指导并送入看门狗
  - 自动化回归套件：新增 `src/test-architecture-fixes.ts` 全量覆盖漏洞防线
- [ ] **终章与生态扩展：兼容 `SKILL.md` 规范与定制技能动态注入**

---

## 快速上手与验证

### 1. 安装依赖
```bash
npm install
```

### 2. 配置环境变量
复制 `.env.example` 为 `.env` 并填写 API 密钥与端点：
```bash
cp .env.example .env
```

### 3. 运行架构自动化回归测试
运行本次架构修复与防线全量验证（无需消耗外部 API Token）：
```bash
npm test
```

### 4. 启动交互式 Agent 会话
启动多轮状态化 REPL，支持实时插话与三级权限拦截：
```bash
npm run dev
```
