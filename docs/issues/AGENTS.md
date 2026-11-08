---
type: agent-context
scope: dsh-chat-search/docs/issues
version: 1.0
last-updated: 2026-11-09
---

# AGENTS.md · dsh-chat-search/docs/issues

> **你是 Agent，进入这里处理本项目的 issue 跟踪任务。**
> 本文档是此目录的入口与**唯一索引**（状态真相源）；每个 issue 的正文记录背景与方案。

## 文档定位：issues 记录「过程」

本目录的文档是**需求 / 开发等迭代过程中的专项任务跟踪**：背景、方案、决策、进度、
验收结论。任务结束后成为档案，不再随代码变化而更新。「系统现在是什么样」不在这里，
看代码与 README；两者冲突时，代码代表当前事实，issue 描述当时语境。
系统现状的稳定文档在 `docs/wiki/`（含 [00-变更日志](../wiki/00-变更日志.md)）。

## 目录速览

| 文件 | 用途 |
|---|---|
| `_template.md` | 新建 issue 时复制的模板 |
| `0XX-<type>-<title>.md` | 具体 issue，编号自增（三位） |
| `AGENTS.md`（本文件） | Agent 入口：规范、索引、工作流 |

**本目录只放 issue。** 验证记录、实测数据、临时分析一律并进所属 issue 的正文
（方案节或进度日志），不另立文件。

## 命名规范

```
<3位编号>-<type>-<kebab-case-标题>.md
```

- 编号：已有最大编号 +1，保留三位（001、002…）
- type：`feat`（新功能）/ `fix`（缺陷修复）/ `chore`（工程杂务）/ `refactor`（重构）/ `docs`（文档）
- 标题：中文短句，用 `-` 连接语义片段（kebab-case 风格），例：`002-feat-导出账单页.md`
- frontmatter 必填：`id / type / title / status / priority / created / updated / assignee / related`

## status / priority 取值

| status | 含义 |
|---|---|
| `open` | 待做 |
| `doing` | 进行中 |
| `blocked` | 被外部条件阻塞（注明阻塞项） |
| `done` | 已完成（验收标准全绿） |

| priority | 含义 |
|---|---|
| `P0` | 影响数据正确性 / 不可用 |
| `P1` | 明显影响使用体验 |
| `P2` | 优化项 |

## 工作流

### 场景 1：用户给了新需求 / 发现新问题

```
1. 读 _template.md 理清字段
2. 新编号 = 已有最大编号 + 1（三位）
3. cp _template.md 0XX-<type>-<标题>.md
4. 填 frontmatter（status: open）
5. 写正文：背景（带证据）/ 目标 / 方案 / 影响面 / 验收标准
6. 在本文件「活跃 Issue」表追加一行
7. git commit: docs(issues): 新增 0XX <type> <标题>
```

### 场景 2：更新现有 issue

```
1. 改 frontmatter（status / updated）
2. 「进度日志」末尾追加一行（YYYY-MM-DD HH:MM  user  说明）
3. 同步本文件索引表状态列
4. git commit: docs(issues): 更新 0XX <简述>
```

### 场景 3：问状态

```
1. 读本文件「活跃 Issue」表直接回答
2. 需要细节再读具体 issue 正文
```

## 活跃 Issue

| # | type | 标题 | status | priority |
|---|---|---|---|---|
| — | — | （暂无） | — | — |

## 已完成 Issue

| # | type | 标题 | 完成日 |
|---|---|---|---|
| — | — | （暂无） | — |
