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
  - 📖 **详细研学复盘与对话记录**：[docs/lesson-01-dialogue-and-learnings.md](./docs/lesson-01-dialogue-and-learnings.md)
- [ ] **阶段二：Coding 工具箱与系统提示词 (Coding Engine)**
  - 实现精准编辑（`read` / `write` / `edit` / 目录检索）
  - 精简系统提示词（Token 效率优先）
- [ ] **阶段三：控制权与安全刹车 (Permission & Steering)**
  - 交互式危险操作授权门（Permission Gate）
  - 运行中介入打断与指导（Steering）
- [ ] **阶段四：上下文管理与会话回溯 (Session Rewind & Compaction)**
  - 上下文滑动压缩（Compaction）
  - 树状会话记录与 `/rewind` 撤回分支
- [ ] **阶段五：插件扩展与技能注入 (Skills & Extensions)**
  - 兼容 `SKILL.md` 规范的技能解析与加载
  - 规划模式（Plan Mode）与子代理分发

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
