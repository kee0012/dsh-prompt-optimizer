# dsh-prompt-optimizer 插件计划

> 由 DSH 插件开发助手（`dsh-plugin-studio`）流程生成并维护。
> 每阶段决策确定后勾选对应项，未通过不得进入下一阶段。

## 阶段 ①：需求捕获

- [x] 插件名：`dsh-prompt-optimizer`
- [x] 一句话目标：在 DSH 输入框底部工具栏（模型选择左侧）放一个 ✨ 按钮，一键用**当前会话所选模型**优化草稿并写回输入框。
- [x] 能力面清单：
  - HTTP 接口（服务端调用 `ctx.llm.stream()`）
  - 浏览器 UI（输入框右侧插槽按钮 + ▾ 设置弹出层）
  - 会话上下文读取（可选：最近 6 条消息）
- [x] 目标 profile：`desktop`（桌面版）；同一份代码也可装到 `web`

## 阶段 ②：形态与分发决策

- [x] 形态：`bundle-client`（Node half + 浏览器 client half）
- [x] 分发方式：git 源（`github:kee0012/dsh-prompt-optimizer`），本地目录 link 用于开发
- [x] 包管理器：pnpm（DSH 自带 11.7.0）

## 阶段 ③：配方装配

- [x] `src/index.js` 已生成（HTTP 路由 + `ctx.llm.stream()`）
- [x] `client/client.js` 已生成（ModuleLoader 包装的 client bundle）
- [x] `inject` 已覆盖所有服务：Node half `['webServer', 'llm', 'sessions']`；client half `['slots', 'modelDirectories']`
- [x] 冒烟功能就绪：`GET /dsh-prompt-optimizer/ping` 返回插件名 / 版本 / revision
- [x] 未手改 `lib/`（`lib/` 由 `scripts/build.mjs` 从 `src/`、`client/` 生成）

## 阶段 ④：本地验证

- [x] 语法检查：`node --check lib/index.js && node --check lib/client.js`
- [x] `pnpm run bundle`（= `node scripts/build.mjs`）通过
- [x] `pnpm run gates`（= `node scripts/gates/run.mjs`）通过
- [x] `python3 <skill>/scripts/verify_plugin.py .` 运行：**10/11 通过**，唯一未通过项是脚本对 TypeScript 模板的硬编码期望（见「与 skill 校验脚本的差异」）
- [x] 判源行为实测：`verify-origin.mjs` 加载真实 `apply()`，无 Origin / `dsh-app://app` / 同源 → 业务校验（400），恶意来源 → 403

## 阶段 ⑤：安装与浏览器冒烟

- [x] 安装成功（`dsh plugin --profile desktop add 'dsh-prompt-optimizer@link:D:/DSH/dshworkspace/dsh-prompt-optimizer/dsh-prompt-optimizer-v2'`）
- [x] 宿主重启后 `/dsh-prompt-optimizer/ping` 返回 `{"ok":true,"plugin":"dsh-prompt-optimizer","version":"0.3.0","revision":"v2-origin-fix"}`
- [x] 桌面版点击 ✨ 不再出现红色 `Cross-origin requests are not allowed`，模型正常返回并写回草稿

## 阶段 ⑥：发布

- [ ] git 仓库与 remote 就绪（基线仓库：`https://github.com/kee0012/dsh-prompt-optimizer.git`）
- [ ] README 使用真实安装 ref
- [ ] 构建产物（`lib/`）已入库
- [ ] 从目标 ref 重装验证通过

## 备注

### 本次（v2）修掉的问题

1. **桌面版必现 403（原始 bug）**：旧 `sameOrigin()` 要求 `Origin` 头必须与 `Host` 同源，否则 403 `Cross-origin requests are not allowed`。桌面壳用 `dsh-app://app` 承载 UI，其协议代理会**剥掉 Origin**，于是每个请求都被拒。实测矩阵：无 Origin → 403；`Origin: http://127.0.0.1:19387` → 进入业务校验（400）；`dsh-app://app` / `localhost:19387` / `null` → 403。
2. **判源策略改为 `originAllowed()`**：缺失 Origin（桌面正常情形）、`dsh-app://app`、同 Host 的浏览器请求放行；其它来源仍 403（保留对恶意页面的拦截）。
3. **新增诊断路由 `GET /dsh-prompt-optimizer/ping`**：用于确认宿主实际加载的是哪一版代码（宿主半边不热重载，重启后靠它验收）。
4. **客户端注入声明保持原样（6 项）**：曾试着移除 `@deepseek-ai/dsh-client-runtime`（它在 profile 的 `node_modules` 里找不到对应目录），但同一个 profile 里能正常工作的插件（`dsh-meme`、`dsh-skin-market`）同样声明了它 —— 说明它由 DSH 客户端加载器提供、而不是 profile 依赖，移除会有加载时序风险。因此**保持原样不动**。教训：不要只凭"node_modules 里没有这个目录"就删注入声明。
5. **补齐工程文件**：`lib/` 产物布局 + `scripts/build.mjs` + `scripts/gates/run.mjs` + `tsconfig.json` + `LICENSE` + 本计划文档。

### 与 skill 校验脚本的差异（verify_plugin.py）

`verify_plugin.py` 是 `dsh-plugin-studio` 给 **esbuild + TypeScript** 模板写的轻量校验器；本项目是**纯手写 JavaScript**（"构建"只是 `src/` → `lib/` 的拷贝，没有编译步骤），所以它的模板假设有三处需要区分处理：

| 校验项 | 脚本期望 | 本项目实际 | 处置 |
|---|---|---|---|
| `main` 字段 | 恰好 `lib/index.js` | 已对齐（去掉 `./` 前缀，与 `dsh-restart` 的写法一致；包解析真正走的是 `exports`） | 已改 |
| `scripts/build.mjs` 保持 React external | 文本里出现 `react`、`react/jsx-runtime`、`react-dom`、`react-dom/client` | build.mjs 已显式导出 `CLIENT_EXTERNALS` 常量并在注释里说明原因 | 已改 |
| 必需文件 | 存在 `src/index.ts`、`src/client/index.ts` | 源码是 `src/index.js`、`client/client.js`（无 TypeScript、无编译） | **如实记录为差异，不伪造 `.ts` 文件** |

最后一项由本项目自己的门禁等价覆盖：`scripts/gates/run.mjs` 的 18 项里包含"client bundle 未内联 React""ModuleLoader id 等于包名""host `inject` 覆盖所有 `ctx.*` 服务调用"等真正决定插件能否加载的契约，全部 PASS。

### 决策变更记录

- 曾尝试手工把 `node_modules/dsh-prompt-optimizer` 建成指向源码目录的 Junction：宿主重启时的 pnpm 收敛会把"不被 lockfile 认识"的链接当障碍清理，**并跟随链接删掉了源码目录内容**。改为用 `dsh plugin ... add '<name>@link:<path>'` 让 pnpm 正规建立 link 依赖（lockfile 记账后不再被清）。教训：不要把唯一源码目录作为手工 junction 的目标。
