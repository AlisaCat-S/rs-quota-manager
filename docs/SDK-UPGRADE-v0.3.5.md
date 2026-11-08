# v0.3.5：适配 RS v3.43.0 SDK 与 UI v0.9.0

SDK、Cargo 锁文件与官方打包工具固定到同一稳定版提交，宿主范围扩展为 `>=3.33.0, <3.44.0`。保留 RS v3.33–v3.42 的业务入口与私有状态；UI 升级后补齐旧宿主的浮层阴影兼容。

## 上游版本与比较范围

2026-11-08 核对 GitHub 最新正式 Release，比较 [RS v3.39.1 → v3.43.0](https://github.com/zyycn/codex-proxy-rs/compare/v3.39.1...v3.43.0)，不跟随未发布 main：

| 稳定版 | 发布时间（UTC） | 完整提交 |
| --- | --- | --- |
| v3.40.0 | 2026-11-04 11:53:20 | `789609dd53663b323e43567d2476f7f83b6b77a1` |
| v3.41.0 | 2026-11-05 04:39:47 | `9039cef3d87ae86ae9422b17c5d4dae1a5247dfa` |
| v3.41.1 | 2026-11-05 14:18:55 | `0c07aac1d607398dda957f843197bc8b10f8c181` |
| v3.41.2 | 2026-11-06 04:37:03 | `ba3baddbda7293d1d76ea066dd5e42298618c15a` |
| v3.42.0 | 2026-11-06 18:10:28 | `7cee4309473949115610288fb7f29b3346e470c2` |
| v3.42.1 | 2026-11-07 07:14:30 | `e0a3dc20dd907071fc78f81cfba9a58f00a27521` |
| [v3.43.0](https://github.com/zyycn/codex-proxy-rs/releases/tag/v3.43.0) | 2026-11-07 19:38:32 | `402bc37fbb5c83378cc83cec89e9fa251e4a99c1` |

配套 [UI 最新稳定版 v0.9.0](https://github.com/zyycn/codex-proxy-ui/releases/tag/v0.9.0) 发布于 2026-11-07 19:12:43 UTC，使用官方编译 tgz，并由 pnpm 锁文件固定 integrity。SDK crate 仍为 0.1.0，最低 Rust 仍为 1.99.1；Rust、Vue、Vite 及无关依赖不升级。

## 差异与适配决定

| 上游变化 | 本插件的适配 |
| --- | --- |
| SDK `RuntimeSettings` / `ReplaceRuntimeSettings` 删除 `concurrency_wait_timeout_seconds`，改为必填 `key_queue_timeout_seconds`、`account_queue_timeout_seconds` 和 `switch_account_on_queue_failure`；转换实现同步变化 | 全部调用已核对：插件设置经 `host.state` 保存，不读写宿主运行设置，也不构造这些类型。无需迁移插件 `Settings`，不为旧宿主增加必填配置。新宿主的推理排队和换号不改变卡片 HTTP 请求的 12 秒期限及不自动重放规则。 |
| SDK 新增 `scan_usage_records`、`query_usage_statistics`、`UsageReader`，以及 `UsageErrorKind::Cancelled` / `Timeout` | 新接口通过固定快照分批交付，只有 `complete` 才表示完成，提前结束须关闭读取。本插件继续调用本地 `quota-forecast`，不自行扫描用量或重算周金额，因此不引入新回调、存储读取或旧宿主版本前提。 |
| 宿主模型目录优先使用账号范围的插件模型画像；账号模型用量的 `lastUsedAt` 可为 null，请求健康无样本时返回 null | 本插件不贡献模型目录、不读模型用量或请求健康。SDK 的 `AuthRuntimeAccount`、`QuotaFacts` 未变，现有账号列表和未知额度处理保持不变。周预估模型仅重排初始化代码，响应合同与计算含义不变。 |
| 宿主新增逐账号 `autoUseQuotaCredits` / `quota_credits` 能力，按显式开关允许使用额度点数；CPR 上游信息增加并发与 RPM | 额度点数不是重置卡。插件不修改账号或点数开关，不把点数、池容量或互联预算当成卡片或 OAuth 周限；继续仅对符合条件的 OpenAI OAuth 非 Free 账号操作重置卡。已有 API Key 隔离、409 / 429、重启恢复回归继续通过。 |
| 页面桥 v2 新增 `openExternal(url)`，要求用户点击、绝对 HTTPS、无用户名密码，并由宿主确认 | 页面没有外链功能，不增加按钮或要求旧宿主实现新方法。现有 `request`、主题事件和页面资源合同未变。 |
| UI v0.9.0 新增柔光材质、主题场景和卡片 `card-bg-image`；选择框 / Popover 从通用阴影改用 `popover-shadow` | 升至官方 v0.9.0，保留 `themePrefix: 'cp'`、`zhHans` 和公开组件入口。生产页仍由宿主注入主题；新增一条 CSS 变量映射，旧宿主缺少 `popover-shadow` 时使用原 `box-shadow`，新宿主内联 token 优先。新增卡片背景图缺失时按浏览器默认无背景图处理。 |
| UI 同时改进浮层定位与动画，移除部分重复 title，新增侧栏等组件 | 复用上游修正，保留当前页面结构和显式中文提示，不引入侧栏或本地主题设置。浏览器回归覆盖分页、筛选、选卡和窄屏。 |

原始依据：[SDK 运行设置](https://github.com/zyycn/codex-proxy-rs/blob/v3.43.0/backend/crates/gateway-plugin/sdk/src/call/services/settings.rs)、[用量读取合同](https://github.com/zyycn/codex-proxy-rs/blob/v3.43.0/backend/crates/gateway-plugin/sdk/docs/usage-data.md)、[账号字段](https://github.com/zyycn/codex-proxy-rs/blob/v3.43.0/backend/crates/gateway-api/src/admin/accounts/wire.rs)、[账号用例](https://github.com/zyycn/codex-proxy-rs/blob/v3.43.0/backend/crates/gateway-admin/src/use_case/accounts/mod.rs)、[页面桥](https://github.com/zyycn/codex-proxy-rs/blob/v3.43.0/frontend/src/views/plugins/management/bridge-contract.ts)、[UI 组件和主题差异](https://github.com/zyycn/codex-proxy-ui/compare/v0.8.0...v0.9.0)。

逐路径比较确认：SDK 会话、帧、auth / quota / state / management / maintenance 合同和宿主兼容声明未变；官方 CLI 只有 README 文案变化。重置卡 GET / POST、幂等请求、原生重置卡自动化及周预估路由未变。RPC v7、清单 v2、management v2、maintenance v1、页面桥 v2 不变。

## 修改范围与数据保留

- SDK rev、Cargo 锁文件和工作流 `SDK_REV` 同步；前端仅更新 UI 及其锁文件条目。
- 新增七份发布标签原始宿主合同快照，连同既有快照检查实际编译 SDK 的协议常量和贡献能力；继续拒绝 RPC v5/v6、预发行和 v3.44.0。
- 后端、前端、插件清单的源码基线统一为 0.3.5，更新发布说明和断言。扩大兼容范围并更新 UI，按独立新版本构建发布，不覆盖旧制品。
- 保留插件 ID `personal.quota-manager`、命名空间 `quota-manager`、schemaVersion 1、设置键、历史与未决 UUID；无状态迁移，不改账号启用状态、分组或自动开关。

## 验证与交付

Windows 本地，Rust 1.99.1、Node 24.19.0、pnpm 12.14.0：

- Rustfmt、严格 Clippy、debug 构建、9 项 Rust 测试通过，合同快照覆盖至 v3.43.0。
- 41 项真实 SDK 插件进程 / 模拟宿主协议场景通过，覆盖挂起 / 恢复、取消 / 超时、账号隔离、消费不自动重放及持久原卡 UUID 恢复。
- 冻结锁文件安装、类型检查、生产构建、12 项前端契约测试、14 项浏览器回归和 4 项发布脚本测试通过。
- 生产页面覆盖旧版前缀、旧版语义 token 和 v3.43 柔光材质，验证明暗切换、浮层实际阴影、卡片背景图及无外部请求。已检查桌面、选卡、深色窄屏与柔光截图，位于 `verification/ui-artifacts/`。

推送 main 后由现有工作流验证并构建 Linux x86_64 / ARM64、运行目标协议测试，再以同提交官方 CLI 打包；全部成功后发布新 Release，以 [Actions 记录](https://github.com/AlisaCat-S/rs-quota-manager/actions/workflows/release.yml) 为准。

未执行真实宿主安装、网站部署或真实卡片消费。安装新包时保留原实例、私有状态和回退包，切换后读回设置与运行状态。
