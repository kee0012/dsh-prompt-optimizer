# dsh-prompt-optimizer

DSH 提示词优化插件：在输入框底部工具栏（模型选择左侧）放一个紧凑的 **✨ 图标按钮**。点击后会用**当前对话所选的大模型**（例如 deepseek-V4-Flash）对输入框里的草稿做一次提示词优化，并把优化结果**直接写回输入框**——日常使用一键完成，无需先展开任何设置。

## 功能

- 按钮位置：`conversation.input.right` 插槽，order 5，位于模型选择左侧。
- 紧凑常驻：只有一个 ✨ 图标按钮 + 右侧小三角 ▾（合计约 50px）。风格选择、上下文开关、还原原文等全部收纳进 ▾ 弹出层，不再常驻占用工具栏。
- 一键优化：直接点击 ✨ 即可——自动读取当前草稿与当前模型，按生效设置（默认“标准”风格、不含上下文）优化并**直接写回输入框**。
- 使用当前模型：读取当前会话的模型选择（provider / model / reasoningEffort），通过 DSH 的 `ctx.llm.stream()` 调用同一个模型完成优化。
- 深度理解：系统提示词要求模型先分析字面意思、真实意图、角色、任务、上下文、受众、输入、约束、输出格式和歧义点，再改写。
- 优化风格：`精简` / `标准` / `详细` 三种，在 ▾ 弹出层中切换并跨会话记忆。
- 可撤销：直接应用前会把原文备份到 localStorage，之后在 ▾ 弹出层点「↩ 还原原文」即可还原（有备份时 ✨ 组右缘会出现一个小圆点提示）。
- 应用方式可选：默认“直接应用”；在 ▾ 弹出层切到“预览确认”后，优化结果会先弹原文 / 优化后对比，确认后再写入。
- 防覆盖：直接应用时若请求期间草稿已被改动，会自动降级为预览弹窗，不覆盖你正在输入的新内容。
- 上下文感知：可在 ▾ 中开启“上下文”，让优化模型参考当前会话最近几条消息，更准确地理解草稿。
- 稳定输出：服务端使用 `temperature = 0.4`，减少随机放飞。
- 失败提示：请求失败或模型无返回时，按钮旁弹出错误 toast（数秒后自动消失），按钮 title 也会保留错误信息。

## 桌面版兼容（v0.3.0）

v0.2.0 在 **DSH 桌面版**上点 ✨ 必定失败，输入框上方出现红色 `Cross-origin requests are not allowed`。原因是服务端判源只适配 `dsh web`：

- 桌面壳用 `dsh-app://app` 自定义协议承载界面，其协议代理会**剥掉 `Origin` 头**；
- 旧逻辑要求 `Origin` 必须与 `Host` 同源，于是桌面版的每个请求都被 403 拒绝；
- `dsh web` 下浏览器会带同源 `Origin`，所以只有桌面版暴露这个问题。

v0.3.0 把判源换成 `originAllowed()`：缺失 Origin（桌面版的正常情形）、`dsh-app://app`、与 `Host` 同源的浏览器请求都放行，其它来源仍然 403 —— 保留了对恶意页面的拦截。

同时新增诊断路由，用来确认宿主当前加载的是哪一版代码（宿主半边改动必须重启 DSH 才生效）：

```sh
curl http://127.0.0.1:19387/dsh-prompt-optimizer/ping
# => {"ok":true,"plugin":"dsh-prompt-optimizer","version":"0.3.0","revision":"v2-origin-fix"}
```

## 安装

插件托管在 GitHub（`kee0012/dsh-prompt-optimizer`，未发布到 npm），DSH 支持以 git 依赖方式直接安装：

```sh
# 方式一：从 GitHub 安装（推荐，日常使用；拉取默认分支最新提交）
dsh plugin --profile desktop add github:kee0012/dsh-prompt-optimizer

# 方式二：本地目录 link 安装（开发调试，改完源码跑构建后重启 DSH 生效）
dsh plugin --profile desktop add "dsh-prompt-optimizer@link:D:/path/to/dsh-prompt-optimizer-v2"
```

> `--profile` 换成你实际使用的 profile（`desktop` / `web`）。
> 如需固定某个版本，可在仓库后追加 `#<tag>`（例如 `github:kee0012/dsh-prompt-optimizer#v0.3.0`），发布时打 tag 即可。
> 本地目录 link 安装**必须写成 `<包名>@link:<路径>`**：只写 `link:<路径>` 时 pnpm 会用目录名当依赖键，DSH 解析 bundle 时会因键名与包名不一致而报 `cannot resolve profile bundle`。
> 安装后需要**重启 DSH** 才会加载新的服务端代码与 client bundle。

验证配置层是否生效：

```sh
dsh plugin --profile desktop dump-config | grep -A2 dsh-prompt-optimizer
```

## 使用

1. 在输入框输入或粘贴一段提示词草稿。
2. 直接点击模型选择左侧的 **✨ 图标**。
3. 等待当前模型返回，优化结果自动写入输入框（原文已备份）。
4. 如想还原原文：点 ✨ 旁的小三角 ▾ → 「↩ 还原原文」。
5. （可选）进阶：点 ▾ 展开设置，可切换优化风格（精简/标准/详细）、开启“上下文”、把应用方式改为“预览确认”，或恢复默认设置；这些选择会跨会话记忆。

## 目录结构

```
dsh-prompt-optimizer-v2/
├── package.json          # DSH bundle 清单 + client 注入声明
├── cordis.patch.yml      # 把插件插入 DSH 组合层
├── tsconfig.json         # 编辑器用（allowJs，不产出）
├── LICENSE               # MIT
├── README.md
├── docs/plan.md          # 需求 / 形态 / 验证 / 发布决策追踪
├── src/index.js          # 服务端源码：HTTP 路由 + 调用 ctx.llm.stream()
├── client/client.js      # 客户端源码：✨ 按钮 + ▾ 设置弹出层 + 一键写回草稿
├── scripts/build.mjs     # 构建：src/ + client/ → lib/
├── scripts/gates/run.mjs # 一致性门禁（名称、exports、inject、React external）
└── lib/                  # 构建产物（由 build 生成，不要手改）
    ├── index.js
    └── client.js
```

## 开发

```sh
node scripts/build.mjs      # 生成 lib/ 产物（= pnpm run bundle）
node scripts/gates/run.mjs  # 一致性门禁（= pnpm run gates）
pnpm run check              # = build + node --check + gates 三连
```

改代码只改 `src/`、`client/`；改完跑构建。**服务端改动必须重启 DSH**（宿主半边 ESM 不热重载），客户端改动刷新页面即可。

## 工作原理

- **客户端**：注册到 `conversation.input.right` 插槽，通过 `modelDirectories.directoryFor(sessionId)` 获取当前模型选择，通过输入框插槽提供的 `useInput` / `inputActions` 读取和写回草稿。设置（风格 / 上下文 / 应用方式）保存在 `localStorage`，未展开过设置时使用默认值（标准风格、不含上下文、直接应用），保证点 ✨ 即一键完成。
- **服务端**：注册 `POST /dsh-prompt-optimizer/optimize`，收到 `{ provider, model, text, style, includeContext, sessionId, reasoningEffort }` 后：
  1. 判源（`originAllowed()`）；
  2. 按风格拼接系统提示词；
  3. 如果开启上下文，读取当前会话最近若干条消息作为上下文；
  4. 以 `temperature = 0.4` 调用 `ctx.llm.stream()`；
  5. 收集文本增量并返回 `{ ok: true, optimized }`。

## 安全说明

- 优化接口只接受本机 UI 发起的 POST：桌面壳无 `Origin`（协议代理会剥离）或 `dsh-app://app` 时放行，浏览器请求必须与 `Host` 同源；其它来源一律 403。
- 请求体限制为 1 MiB。
- 插件只把 `provider`、`model`、`text`、`style`、`sessionId`（开启上下文时）等必要字段传给 DSH 已有的 LLM 适配器，不接触凭据文件。

## License

MIT
