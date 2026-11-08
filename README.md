# @dreamariner/dsh-chat-search

Time-window chat transcript search over DSH session history（由 create-dsh-plugin 生成的 DeepSeek Harness 插件，形态：**纯 Node 半边**）。

本仓是**单包布局**：根即插件包，构建、发布、安装都以本仓为单位。lib/ 是构建产物，不进 git。

## 工具：chat_search

按时间窗检索全部会话历史，输出 slim 聊天实录：仅真人发言（`source.kind = user`）与助手回复的原文；框架注入上下文（agent 指令、运行时上下文、记忆召回快照、定时投递等）一律过滤。数据源走官方 `ctx.sessionQuery` seam（活会话优先、物理编码透明、路径零手拼），单会话读取失败跳过并在输出末尾留痕，不拖垮整轮扫描。

| 参数 | 默认 | 说明 |
|---|---|---|
| `hours` | 配置 `defaultHours`（24） | 滚动时间窗；`start`/`end` 任一给出时忽略 |
| `start` / `end` | 无 | 窗口端点，半开区间 `[start, end)`；`YYYY-MM-DD` 或 `YYYY-MM-DD HH:mm`（按配置时区解释），带时区后缀的 ISO 按后缀解析；`end` 缺省回落 now，`start` 缺省回落 `now - hours` |
| `session_id` | 无 | 会话 id 子串过滤，纯过滤项，可与时间参数自由组合 |
| `limit` | 200 | 最大输出消息条数（夹在配置 `maxLimit` 内），截断时输出截断标记 |

配置项：`timezone`（默认 `Asia/Shanghai`，同时用于无后缀入参解释与时间戳渲染）、`defaultHours`（默认 24）、`maxLimit`（默认 2000）。

性能特征：每次调用遍历并回放校验全部会话日志（`listSessions` + 逐会话 `readSession`），耗时随会话总量增长（数百会话、数百 MB 日志为秒级到数十秒级），工具超时 120s。若需要关键词全文检索，用宿主自带的会话检索（`ctx.sessionQuery` 的 `searchSessions`/`searchEvents`，需挂载 FTS 后端），本工具专注无关键词的时间窗实录。

## 安装

**想用**（npm）：

- headless 环境：`dsh plugin --profile <name> add @dreamariner/dsh-chat-search`（官方 reconcile 登记名单）
- desktop 应用：Plugin Manager 里直接装
- 或统一一条命令：`pnpm profile:add --npm`（同下，多一层自检）

**想改**（本地源码态）：

```sh
pnpm profile:add          # link: 本仓装进 ~/.dsh/profiles/desktop；缺依赖自动 install、装前自动构建
pnpm profile:add --remove # 反向卸载（含名单清理）
```

脚本依次做：缺依赖先 `pnpm install`；构建本包（lib/ 不入库，link: 安装不触发 pnpm
lifecycle）；`pnpm add <spec> --dir <profile>`；把包名幂等追加进 profile
`package.json` 的 `dsh.profile.bundles`（DSH 只认这份名单，裸 `pnpm add` 不登记 =
插件静默不挂载）并钉 packageManager；realpath 自检 manifest 带 `dsh.bundle`、包名
一致、入口产物存在。装完**重启实例一次**生效。

> 手动等价：`pnpm add <spec> --dir <profile>` 后，把 `@dreamariner/dsh-chat-search` 补进
> profile `package.json` 的 `dsh.profile.bundles` 数组。

## DSH 实例管理

```sh
pnpm dsh:status     # 实例在跑与否 + 访问地址
pnpm dsh:start      # 启动实例（启动前构建门：构建失败阻断启动）
pnpm dsh:restart    # 优雅停止后重启（默认后台）
pnpm dsh:stop       # 优雅停止
pnpm dsh:probe      # 连实例验证本插件装载且 active
```

纪律：实例固定经 `dsh:start` 启动（脚本给打包版带 `--inspect` 并等就绪）；Dock 直启的
实例没有 inspector，stop / restart 管不了。环境变量：`DSH_HOME` / `DSH_PROFILE` /
`DSH_LOG` / `DSH_DESKTOP_APP` / `DSH_DESKTOP_FORM`（=dev 需 `DSH_CHECKOUT`）。

## 开发

```sh
pnpm install
pnpm dev           # watch 构建：保存即重建 lib/
pnpm dev:hmr       # host 半边热重载接线（见下）
pnpm test          # vitest run
pnpm typecheck     # tsc --noEmit
pnpm build         # 单次构建
```

- **pnpm dev:hmr**：把本包 `lib/` 注册进本机 home patch（`$DSH_HOME/cordis.patch.yml`）
  的 hmr watch 根。**注册后需重启实例一次**，之后的 host 半边改动随 `pnpm dev`
  重建即时热重载（免重启、PID 不变）。`--remove` 注销注册。

## 发布

```sh
pnpm publish   # prepare 自动构建 lib/ 再打包；scoped 包已配 access=public
```

发布前检查：`locale/*.json` 的 `meta.title` / `meta.description` 换成真实文案、
`icon.svg` 换成原创图形（Plugin Manager 与 Settings 会展示它们）。

## 结构

```
src/index.ts        宿主半边入口（apply + inject + Config；注册 chat_search 工具）
src/config.ts       配置 schema（schemastery，peer 共享宿主实例）
src/window.ts       时间窗解析（时区解释、start/end 优先级）
src/session-query.ts  ctx.sessionQuery 的结构化视图与运行时守卫
src/scan.ts         全会话扫描与 slim 对话提取（真人发言过滤）
src/format.ts       实录渲染（时区呈现、截断、空窗口文案）
cordis.patch.yml    自挂载 bundle patch
locale/*.json       展示元数据（meta.title / meta.description）
icon.svg            插件图标（≤ 256 KiB）
tests/              bundle 形态守卫 / 窗口 / 扫描 / 渲染用例
scripts/lib/manifest-deps.mjs  依赖策略单一来源（不变式 I1/I2，tsdown 配置引用）
```

## 依赖纪律（不变式，改动前必读）

名单只写在 `package.json` 一处，`tsdown.config.ts` 从它派生：

- `peerDependencies`（schemastery 等）＝宿主供给同一实例 → 构建外置；
- `dependencies` ＝插件自带 → 构建内联；
- `devDependencies` ＝只许 `import type`（类型源，dev 精确钉版本）。


## 后续要加插件 / 升级成 full？

本仓是单包布局；追加第二个插件或长出 typert 双端时，用脚手架对既有仓重排
（profile 里的旧 link 安装会自动迁移）：

```sh
npx @dreamariner/create-dsh-plugin add <包名> --type host|client|full --dir <本仓路径>
```
