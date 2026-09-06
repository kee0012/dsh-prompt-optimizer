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

## 安装

在 DSH 运行的终端中执行：

```sh
# 方式一：本地目录安装（开发迭代，改代码后重启 DSH 生效）
dsh plugin --profile desktop add "D:\path\to\dsh-prompt-optimizer-release"

# 方式二：先打包再安装（适合分发）
cd "D:\path\to\dsh-prompt-optimizer-release"
pnpm pack
dsh plugin --profile desktop add ./dsh-prompt-optimizer-0.2.0.tgz
```

> 如果用的是 web profile，把 `--profile desktop` 换成 `--profile web`。
> 安装后需要重启 DSH 才会加载新的 client bundle。

验证配置层是否生效：

```sh
dsh --profile desktop --dump-config | grep -A2 dsh-prompt-optimizer
```

## 使用

1. 在输入框输入或粘贴一段提示词草稿。
2. 直接点击模型选择左侧的 **✨ 图标**。
3. 等待当前模型返回，优化结果自动写入输入框（原文已备份）。
4. 如想还原原文：点 ✨ 旁的小三角 ▾ → 「↩ 还原原文」。
5. （可选）进阶：点 ▾ 展开设置，可切换优化风格（精简/标准/详细）、开启“上下文”、把应用方式改为“预览确认”，或恢复默认设置；这些选择会跨会话记忆。

## 目录结构

```
dsh-prompt-optimizer/
├── package.json          # DSH bundle 清单 + client 注入声明
├── cordis.patch.yml      # 把插件插入 DSH 组合层
├── src/index.js          # 服务端：HTTP 路由 + 调用 ctx.llm.stream()
├── client/client.js      # 客户端：✨ 图标按钮 + ▾ 设置弹出层 + 一键写回草稿
└── README.md
```

## 工作原理

- **客户端**：注册到 `conversation.input.right` 插槽，通过 `modelDirectories.directoryFor(sessionId)` 获取当前模型选择，通过输入框插槽提供的 `useInput` / `inputActions` 读取和写回草稿。设置（风格 / 上下文 / 应用方式）保存在 `localStorage`，未展开过设置时使用默认值（标准风格、不含上下文、直接应用），保证点 ✨ 即一键完成。
- **服务端**：注册 `POST /dsh-prompt-optimizer/optimize`，收到 `{ provider, model, text, style, includeContext, sessionId, reasoningEffort }` 后：
  1. 按风格拼接系统提示词；
  2. 如果开启上下文，读取当前会话最近若干条消息作为上下文；
  3. 以 `temperature = 0.4` 调用 `ctx.llm.stream()`；
  4. 收集文本增量并返回 `{ ok: true, optimized }`。

## 安全说明

- 优化接口只接受同源 POST，拒绝跨域请求。
- 请求体限制为 1 MiB。
- 插件只把 `provider`、`model`、`text`、`style`、`sessionId`（开启上下文时）等必要字段传给 DSH 已有的 LLM 适配器，不接触凭据文件。
