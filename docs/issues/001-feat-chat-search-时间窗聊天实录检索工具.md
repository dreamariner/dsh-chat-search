---
id: 001
type: feat
title: chat_search 时间窗聊天实录检索工具
status: done
priority: P1
labels: [tool, session-query]
created: 2026-11-09
updated: 2026-11-09
assignee: jianan
related: []
---

# 001 · feat · chat_search 时间窗聊天实录检索工具

## 背景

DSH 自带的会话检索（`session_search` 系列，experimental）以关键词为必填入口，服务「找写过什么」；但「回顾过去一段时间聊了什么」「核对某段时间的对话事实」是无关键词、纯时间窗的全量实录需求，内置查询覆盖不了（query 必填、来源不过滤、输出是命中片段而非对话清单）。本插件把这个能力做成模型可调用的工具，数据源走官方 `ctx.sessionQuery` seam，不手拼会话目录布局，对日志物理编码（明文 / zstd）透明。

## 目标

模型可通过 `chat_search` 工具按时间窗取到全部会话的 slim 聊天实录，且满足：

1. 只含真人发言（`source.kind = user`）与助手回复原文，框架注入上下文零泄漏
2. 窗口语义可预期：滚动窗（hours）与显式窗（start/end）并存，显式窗优先；时间解释时区可配置
3. 单会话读取失败只跳过并留痕，不整轮归零

## 方案

- 涉及模块：host 半边（纯 Node，无 client 面）
- 改动点：
  - `src/window.ts`：窗口折算 + IANA 时区墙钟换算（两遍法消 DST 歧义）
  - `src/session-query.ts`：`ctx.sessionQuery` 的结构化视图 + 运行时守卫（漏注入显式报错）
  - `src/scan.ts`：`listSessions` + 逐会话 `readSession`，来源过滤（user/message 只认 `source.kind='user'`）、半开区间切窗、失败隔离
  - `src/format.ts`：实录渲染（配置时区、单条 500 字截断、limit 截断标记、空窗口区分措辞、跳过留痕）
  - `src/index.ts`：注册工具（timeout 120s、并发安全、presentCall 搜索卡）
- 关键技术决策：
  - 不 import `@deepseek-ai/dsh-session-query`：结构化类型钉住消费面，插件依赖只剩 schemastery peer；服务缺失在 apply 期显式抛错
  - 全量扫描换来零索引依赖：FTS 索引预热与否不影响正确性；性能特征记录在 README，留 session-search.db 预筛的优化后路

## 影响面

- 只读工具，不写任何状态，无数据迁移
- 触碰自守护栏：无（bundle 形态守卫保持脚手架原样）

## 验收标准

- [x] `pnpm test && pnpm typecheck` 全绿（30 用例：时区解释、窗口优先级、来源过滤、坏会话隔离、渲染截断）
- [x] 真实数据冒烟：以文件后端伪造服务跑本机全部会话，与 CLI 摘要脚本同窗口逐行比对一致（285 条消息，归一化角色标签后 diff 为空）
- [ ] 实机验收：装进 desktop profile，重启后模型实际调用 `chat_search` 返回正确实录

## 依赖

- 前置：无
- 阻塞：无

## 进度日志

- 2026-11-09  jianan  创建
- 2026-11-09  jianan  实现完成，单测与真实数据冒烟通过
