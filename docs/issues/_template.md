---
id: 000
type: docs
title: Issue 模板（新建时复制本文件）
status: template
priority: -
labels: []
created: 2026-11-09
updated: 2026-11-09
assignee: -
related: []
---

# {ID} · {标题}

> 本文件是**模板**，不要直接提交。
> 使用方法：`cp _template.md 00X-type-title.md`，然后填写下方内容。编号从已有最大编号 +1，规范见 [AGENTS.md](AGENTS.md)。

## 背景

为什么需要做这件事？问题现象、根因、关联现状（尽量给实测证据与文件路径:行号）。

## 目标

完成后达到什么效果？可量化标准。

## 方案

具体怎么实现？

- 涉及模块（host 半边 / client 半边 / typert face / scripts / 持久化？）
- 改动点（文件 / 目录）
- 关键技术决策与替代方案对比

## 影响面

- 影响插件的哪些行为 / 数据
- 是否需要数据迁移或重导（`storeDir` 下已有数据？）
- 是否触碰自守护栏（bundle 形态 / client 边界 / typert 产物）

## 验收标准

- [ ] 验收点 1（功能 / 数据 / 校验 / 实机验证）

## 依赖

- 前置 issue / 外部条件
- 阻塞项

## 进度日志

- 2026-11-09  jianan  创建
