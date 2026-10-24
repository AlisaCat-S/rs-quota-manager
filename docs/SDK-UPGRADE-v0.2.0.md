# v0.2.0：对齐 RS v3.30.2 SDK

对应 [Issue #2](https://github.com/AlisaCat-S/rs-quota-manager/issues/2)，核对日期为 2026-10-24。本次交付源码与验证，不创建标签、Release 或线上切换。源码版本从 0.1.5 升至 0.2.0，用于区分不能在旧宿主运行的协议升级。

## 升级目标与兼容范围

- 最新稳定宿主：[v3.30.2](https://github.com/zyycn/codex-proxy-rs/releases/tag/v3.30.2)，SDK 固定提交 `76291f448cdf1d1da2027da32b7c949deb998c7a`，不跟踪浮动分支。核对时上游 main 的 SDK 与该标签没有差异。
- UI：[v0.6.0](https://github.com/zyycn/codex-proxy-ui/releases/tag/v0.6.0) 的官方预编译 tgz，pnpm 锁定依赖及完整性。
- 宿主范围：`>=3.30.2, <3.31.0`，以本次核对版本为下限，不沿用旧版 `>=3.26.2, <3.28.0`。旧宿主需继续使用匹配的旧版插件。
- 插件 ID、私有状态命名空间 `quota-manager`、schemaVersion 1、设置键和已持久化 UUID 不变，无状态迁移。

## 会影响本插件的差异

| 合同 | 旧版 → 新版 | 适配与影响 |
| --- | --- | --- |
| SDK 来源 | RS v3.26.2 → v3.30.2；SDK 包版本仍是 0.1.0 | 以 Git 提交识别版本，同时更新 Cargo.lock，不能仅看 crate 版本号。 |
| Rust | 1.97.0 → 1.99.1 | 按新 SDK 的最低 Rust 版本更新 Cargo.toml 与构建说明。 |
| 进程 RPC | 2 → 5 | 使用新版 SDK 会话处理。Hello configuration、Call/Callback params、Result result 已移入载荷 JSON 前缀；测试宿主改为 `data_bytes` 和 `request_context_bytes` 分段封装。 |
| 入口快照 | 无 → `CallContext.request` | 快照在载荷前缀，头值使用 base64，可保留重复头与非 UTF-8 字节。协议测试增加超过 64 KiB 的快照，确认不挤占控制元数据。业务请求头仍沿用字节数组。 |
| 清单与能力 | manifest 2 不变；management 1 → 2；maintenance 1 不变 | 显式声明 management version 2。继续用 `PluginBuilder` 注册原有 8 条管理路由和维护入口，不手写生产协议适配层。 |
| 页面桥 | 2 → 2 | `request` 参数、ArrayBuffer 响应、主题事件均未改变；不把进程协议号误用于浏览器桥版本。 |
| UI | 0.4.1 → 0.6.0 | 新默认语言为英文；根级 `ZConfigProvider` 显式配置 `zhHans`。组件、Vite 插件、样式和主题继续走公开导出。新版有分页、表格与弹窗布局调整，增加浏览器回归测试。 |

原始依据：[SDK 通信边界](https://github.com/zyycn/codex-proxy-rs/blob/v3.30.2/backend/crates/gateway-plugin/sdk/README.md#通信边界)、[帧编解码](https://github.com/zyycn/codex-proxy-rs/blob/v3.30.2/backend/crates/gateway-plugin/sdk/src/client/frame.rs)、[宿主兼容声明](https://github.com/zyycn/codex-proxy-rs/blob/v3.30.2/backend/crates/gateway-plugin/runtime/plugin-host-compatibility.json)、[管理与页面桥](https://github.com/zyycn/codex-proxy-rs/blob/v3.30.2/backend/crates/gateway-plugin/sdk/docs/capabilities.md#管理页面公开入口与-cli)。

## 账号、额度与消费边界

核对 `host.auth.list`、`host.auth.get_runtime`、`host.data.quota.get`、`host.quota_observations.refresh`、`host.state.get/put` 及 `host.http.dispatch`：本插件使用的请求、结果及乐观锁字段仍适用。新版原始上游 HTTP 类型增加 HTTP 版本、尾部头并改用字节头值；本插件使用的是受管 `dispatch_http`，无需切换到原始上游接口。

[账号管理 wire 类型](https://github.com/zyycn/codex-proxy-rs/blob/v3.30.2/backend/crates/gateway-api/src/admin/accounts/wire.rs) 中，`GET/POST /api/admin/accounts/reset-credits` 的账号 ID、creditId、redeemRequestId、卡片字段和消费结果码保持适用。新增的管理端额度本地化字段不影响本插件使用的 `QuotaFacts` 毫秒时间和窗口数据。

新版增加宿主原生“临期重置卡自动使用”。[宿主消费入口](https://github.com/zyycn/codex-proxy-rs/blob/v3.30.2/backend/crates/gateway-admin/src/use_case/accounts/mod.rs) 会在原生操作未决时拒绝消费并返回冲突。本插件保留现有保守处理：HTTP 409 不作为已消费结果，不清除 pending，不改选其他卡；用户确认原操作时继续复用原 UUID。增加该场景的协议回归测试。

原生自动策略与本插件“周限耗尽时重置”不是同一个开关。本次不调用新增 `SetResetCreditAutomation`，也不迁移或关闭用户已有原生设置；同一账号建议只启用一种自动策略。Free 排除、停用账号不自动消费、手动确认、默认关闭自动使用、单入口串行及恢复观测规则均保留。

## 验证证据

本机 Rust 1.99.1、Node 24.19.0、pnpm 12.14.0：

- Rustfmt、严格 Clippy、3 项 Rust 规则测试、debug 构建通过。
- 31 项真实 SDK 进程协议场景通过：原有业务场景及 RPC v5 大快照、旧协议拒绝、management v1 拒绝、原生自动消费 HTTP 409；包含持久状态重启恢复与原 UUID 复用。
- 11 项前端桥接与响应契约测试通过。
- 前端类型检查与生产构建通过；浏览器回归覆盖中文分页、筛选、选卡与确认、CSV、深色和 390px 窄屏。执行命令见 README，截图位于 `verification/ui-artifacts/`。

协议场景全部使用模拟宿主，浏览器全部使用本地模拟数据。未执行真实消费、宿主安装或线上切换；发布前仍需用相同 SDK 提交的官方 CLI 打包，并在目标宿主验证安装和管理页加载。历史 Release 安装包不被此源码更新覆盖。
