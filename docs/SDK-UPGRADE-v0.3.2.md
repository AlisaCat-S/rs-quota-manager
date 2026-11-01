# v0.3.2：适配 RS v3.37.2 SDK 与 UI v0.8.0

源码从 0.3.1 升至 0.3.2。SDK、锁文件和官方打包工具固定同一稳定版提交；宿主范围扩展为 `>=3.33.0, <3.38.0`，继续支持原有 v3.33 / v3.34 用户。没有 RPC 升级或插件状态迁移。

## 版本与比较范围

核对日期：2026-11-01（Asia/Tokyo）。使用 GitHub Releases API 核实最新稳定版，并解引用 Git 标签；不以搜索缓存或未发布 main 判断版本。

- [RS v3.37.2](https://github.com/zyycn/codex-proxy-rs/releases/tag/v3.37.2)：2026-10-31 19:53 UTC 发布，源码提交 `641f43b3030b1c68961e05d525e58ec6f4264a15`。
- 基线：[RS v3.34.0 → v3.37.2](https://github.com/zyycn/codex-proxy-rs/compare/v3.34.0...v3.37.2)，包括中间的 v3.35.0、v3.35.1、v3.36.0、v3.37.0、v3.37.1。
- 配套 [UI v0.8.0](https://github.com/zyycn/codex-proxy-ui/releases/tag/v0.8.0)：2026-10-31 17:33 UTC 发布，源码提交 `d6100447010715c1203e67a4195fc6d875ff6249`。对比 [UI v0.7.0 → v0.8.0](https://github.com/zyycn/codex-proxy-ui/compare/v0.7.0...v0.8.0)，使用官方预编译 tgz，不把源码示例作为运行时依赖。
- SDK crate 仍为 0.1.0，最低 Rust 仍为 1.99.1，因此必须用完整 Git 提交识别。Rust、Vue、Vite 和无关直接依赖不升级；pnpm 锁文件只随 UI 及其所需依赖更新。

## 差异决定具体改法

| 上游差异 | 本插件适配与保留条件 |
| --- | --- |
| UI 默认 CSS 变量、DOM 和 utility 从 `cp` 改为 `z`，没有旧命名别名 | 使用官方 `CodexProxyUI({ themePrefix: 'cp' })`，由插件同时重写库内 CSS、配置 JS 变量前缀并输出 `codex-proxy-ui-theme-prefix` 元数据。组件 DOM / utility 仍使用新版 `z`，本项目没有旧组件类名选择器需要迁移。保留现有业务 CSS 的 `--cp-*`，不手写变量映射层。 |
| RS v3.37 主题桥从完整 `--cp-*` 变量名改传语义 Token，并按页面元数据决定注入前缀 | 新桥读取 `cp` 元数据，旧桥继续写固定 `--cp-*`，同一生产构建可使用两种桥。宿主桥版本仍为 2。生产页面只接收宿主主题；不调用主题生成器、不用默认配色覆盖宿主。 |
| UI 删除 `resolveTheme`、`applyResolvedTheme` 及大写公开默认常量，改用 `createTheme(options)`、`applyTheme`，主题字段 `name` 改为 `scheme` | 本地预览改为 `applyTheme(root, createTheme({ scheme }))`；保持仅在 DEV 且没有宿主桥时初始化。根级中文 locale 保留；新增生产构建测试防止仅预览通过而实际安装后失去颜色。 |
| SDK 删除模型目录 v1；`.model_catalog(...)` 改收 `ModelCatalogRegistrationV2`；新增 `ModelPresentation.reasoning_summary`，默认 false | 本插件未声明模型目录或上游适配器，不调用这些作者入口；management v2、maintenance v1 不变。不引入目录、模型或 Key 前提。 |
| SDK `RuntimeSettings` / `ReplaceRuntimeSettings` 将 `account_auto_freeze_*` 替换为 `account_error_protection`；`UpstreamFailure` 新增可选 `error_type` | 本插件不读取或替换宿主运行设置，也不产生适配器失败事件。插件自己的 `Settings` 存于私有状态，与宿主类型无关，不迁移或重置自动开关。 |
| Chat Completions 在 HTTP 挂载保留 Chat 视图，request / attempt 挂载使用规范化 Responses 视图 | 本插件不贡献推理中间件，受管 HTTP 只调用账号管理相对路径。无需增加 `/v1/chat/completions` 匹配、转换请求或改变消费重试策略。 |
| CPR 互联为 API Key 账号增加上游套餐、额度和预算观测；账号可编辑名称，管理 API 增加信息字段 | SDK 所用 `AuthRuntimeAccount`、`QuotaFacts` 未变。账号展示仍优先完整邮箱，无邮箱回退名称，搜索和导出保留名称。不能根据互联套餐或周额度将 API Key 账号当作 OAuth；新增真实插件进程场景验证这些账号可展示，但不能启用自动使用、查询卡片或消费。 |
| 宿主账号额度 / 预估内部增加互联查询路径；账号管理响应增补来源、金额和保护规则 | 对照账号 API 与用例，重置卡 GET / POST、`accountId` / `creditId` / `redeemRequestId` 和周预估的 `estimatedUsd` / `estimatedUsdDisplay` 合同不变。仍以 `refresh: false` 的宿主本地观测读预估，不读写宿主数据库或启用互联分享。 |

原始依据：[UI 前缀配置](https://github.com/zyycn/codex-proxy-ui/blob/v0.8.0/src/vite.ts)、[主题 API](https://github.com/zyycn/codex-proxy-ui/blob/v0.8.0/playground/guide/theme.md)、[新宿主主题桥](https://github.com/zyycn/codex-proxy-rs/blob/v3.37.2/frontend/src/views/plugins/management/bridge-runtime.ts)、[元数据注入顺序](https://github.com/zyycn/codex-proxy-rs/blob/v3.37.2/frontend/src/views/plugins/management/frame.ts)、[SDK 设置类型](https://github.com/zyycn/codex-proxy-rs/blob/v3.37.2/backend/crates/gateway-plugin/sdk/src/call/services/settings.rs)、[目录类型](https://github.com/zyycn/codex-proxy-rs/blob/v3.37.2/backend/crates/gateway-plugin/sdk/src/call/catalog.rs)、[账号 wire](https://github.com/zyycn/codex-proxy-rs/blob/v3.37.2/backend/crates/gateway-api/src/admin/accounts/wire.rs)与[账号用例](https://github.com/zyycn/codex-proxy-rs/blob/v3.37.2/backend/crates/gateway-admin/src/use_case/accounts/mod.rs)。

## 没有改变的业务合同

比较 SDK 帧、会话、HostClient、auth / quota / state / HTTP 与 management / maintenance 类型，以及官方 CLI，所用合同未变。RPC 仍为 v7，清单 v2、management v2、maintenance v1、页面桥 v2；只扩大经比较的宿主范围，不混淆模型目录版本与进程协议版本。

- 保留插件 ID `personal.quota-manager`、命名空间 `quota-manager`、schemaVersion 1、设置键、历史及未决操作；没有状态迁移。
- 新实例自动使用默认关闭，已有设置保持；不修改账号启用、分组、宿主保护规则或原生自动使用配置。
- Free 排除、停用账号保护、OAuth 资格、消费前复核、每批最多一个账号访问上游、预算与串行入口不变。
- 管理 POST 的 429 / 409、未知结果与会话中断仍保留原卡和原 UUID，不自动重发。只有显式“确认原操作”才能继续。

新增六份中间版至最新版的原始宿主兼容声明快照，连同原有 v3.33 / v3.34 快照校验实际编译 SDK 的协议常量、清单范围和能力版本。RPC v5/v6、预发行与 v3.38.0 继续排除。

## 本地验证与交付

Windows，Rust 1.99.1、Node 24.19.0、pnpm 12.14.0：

- Rustfmt、严格 Clippy、debug 构建和 8 项 Rust 测试通过。
- 41 项真实 SDK 插件进程 / 模拟宿主场景通过，包括 API Key 消费隔离、挂起/恢复授权、取消/超时、原卡 UUID 恢复及 429 不重放。
- 冻结锁文件安装、类型检查、生产构建和 12 项前端契约测试通过。
- 13 项浏览器回归通过，包括中文分页、筛选、选卡确认、CSV、四位页码、220px 容器，以及直接加载生产构建模拟新旧主题桥和明暗切换。检查桌面、选卡、深色和 390px 截图，位于 `verification/ui-artifacts/`。
- 4 项发布脚本测试通过，SDK、锁文件与打包工具同提交，源码版本、宿主范围与发行说明一致。

SDK 兼容范围和配套 UI 改变，按独立发布处理。提交并推送 main 后，现有工作流执行 Linux 双架构构建、目标协议测试和同提交官方 CLI 打包，全部通过后公开 Release；以 [Actions 记录](https://github.com/AlisaCat-S/rs-quota-manager/actions/workflows/release.yml)为准，不覆盖旧标签或制品。

本次没有真实宿主安装、网站切换或真实卡片消费。安装验收时使用新包，保留原实例、私有状态和回退制品，核对页面、设置及运行状态；不以真实消费测试升级。
