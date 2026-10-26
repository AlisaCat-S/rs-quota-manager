# v0.3.0：适配 RS v3.33.0 / RPC v7

对应宿主 **RS v3.33.0**，源码版本由 0.2.1 升至 0.3.0。此次为进程协议破坏性升级，兼容范围改为 `>=3.33.0, <3.34.0`；原账号设置、卡片记录及未决消费状态无需迁移。

## 固定来源

核对日期：2026-10-26（Asia/Tokyo）。

- 最新稳定宿主：[RS v3.33.0](https://github.com/zyycn/codex-proxy-rs/releases/tag/v3.33.0)，发布于 2026-10-26 10:56 UTC。SDK 与官方 `cpr-plugin` 打包工具一起固定到标签提交 `8c8618aa0f841638262262e3338c115bc075f125`。
- 核对时上游 main 为 `1db8b0e319431717611e3e30ae1a2d3b371de86a`，其 SDK、打包 CLI 和宿主兼容声明与 v3.33.0 没有差异。
- SDK crate 仍为 0.1.0，使用完整 Git 提交识别版本；Rust 最低版本仍为 1.99.1。
- UI 最新稳定版为 [v0.7.0](https://github.com/zyycn/codex-proxy-ui/releases/tag/v0.7.0)，使用官方预编译 tgz，pnpm 锁定依赖及 integrity；要求 Node 24+ / Vue 3.5+。

## 跨过 v6，再适配 v7

用户提示的宿主变更为 v6 → v7；本插件旧基线实际仍是 RS v3.31.1 / RPC v5。因此对比 [v3.31.1 → v3.33.0](https://github.com/zyycn/codex-proxy-rs/compare/v3.31.1...v3.33.0)，同时核对了中间的 v3.32.0 / RPC v6 合同。

| 上游差异 | 本插件的适配与判断 |
| --- | --- |
| RPC v5 → v6：`Ready.call_budgets` 声明各阶段预算，移除统一 120 秒截断；维护默认从 30 秒变为 120 秒 | 继续使用官方 `PluginSession`，由 SDK 发送空声明 `{}` 并采用协议默认值。当前串行、有界巡检无需增加预算。模拟宿主改用 registration 5 秒、management / maintenance 120 秒，不再对所有阶段发送 60 秒。 |
| 新增 `HostClient.remaining_budget()`，普通回调和恢复排队计入父调用预算；只有挂起且全部驻留回调为 `next` 时暂停预算 | 巡检原先从账号分页完成后自行计时，会漏算前置读取；现在直接读取 SDK 共享剩余预算，低于 18 秒时结束账号循环并保存游标。网络请求原有 12 秒期限不变，不为 SDK 升级延长消费超时。 |
| RPC v6 → v7：`Suspend`、`Resume`、`Resumed`，按调用严格递增 epoch；授权前不得继续驱动父处理 | 生产会话全部由新 SDK 实现，不手写协议或在业务层添加另一个调度器。测试宿主维护运行/挂起/恢复状态，只在显式发送 `Resumed` 后允许后续业务回调。 |
| `CallbackConsumed { id, parent_id }` 回收驻留结果；接收结果不等于消费结果，取消与迟到授权可交错 | 由 SDK 的回调 future 生命周期处理。测试验证授权被扣留时结果仍驻留，恢复后才回收；取消和超时后回收父调用资源，迟到授权不能重新打开调用。消费请求不因调度恢复而重试。 |
| 默认回调容量由 64 改为 320、最大 512，覆盖全部驻留回调 | 继续采用 `SessionConfig::default()`；管理与维护仍共用一把业务锁、每批最多一个账号访问上游，不增加业务并发。 |
| 新增客户端认证、账号/模型授权、完整额度事实和按指定账号代理发 HTTP 的 SDK 接口 | 本插件不执行模型、不验证客户端 Key、不获取凭据；保留原账号运行信息和额度事实查询，不要求用户为已有管理功能新增 Key 或授权。 |
| 管理页桥新增模型接口和公开类型，版本仍为 2 | 本插件只使用原 `request`、主题和 ArrayBuffer 响应；保留浏览器桥版本检查 2，不将其改成 RPC 版本 7。 |
| UI v0.6.1 → v0.7.0：表单校验/validator 合同变化，弹窗焦点、表格内边距和文字裁切修复 | 本插件不使用 `ZForm` 校验或自定义 validator，无需迁移校验调用。升级官方包及许可来源，通过浏览器检查实际表格、中文分页、弹窗、CSV、深浅主题和窄屏。 |

原始依据：[SDK 通信及预算](https://github.com/zyycn/codex-proxy-rs/blob/v3.33.0/backend/crates/gateway-plugin/sdk/README.md#通信边界)、[RPC 消息](https://github.com/zyycn/codex-proxy-rs/blob/v3.33.0/backend/crates/gateway-plugin/sdk/src/message.rs)、[协作式调度](https://github.com/zyycn/codex-proxy-rs/blob/v3.33.0/backend/crates/gateway-plugin/sdk/src/client/session/scheduling.rs)、[回调生命周期](https://github.com/zyycn/codex-proxy-rs/blob/v3.33.0/backend/crates/gateway-plugin/sdk/src/client/session/registry.rs)、[浏览器桥](https://github.com/zyycn/codex-proxy-rs/blob/v3.33.0/frontend/src/views/plugins/management/bridge-contract.ts)。

## 原有业务合同与状态保留

对比固定提交，帧编解码、management 和 maintenance 类型、账号运行信息、私有状态结构及本插件使用的受管 HTTP dispatch wire 类型保持适用。帧仍使用 12 字节大端长度头、独立 `request_context_bytes` / `data_bytes` 前缀和原始二进制正文；新增调度控制帧没有载荷。

- `host.auth.list` / `host.auth.get_runtime`、`host.data.quota.get` / `host.quota_observations.refresh`、`host.state.get/put`、`host.http.dispatch` 及受管正文读取方式沿用原合同。
- 账号管理 [wire 类型](https://github.com/zyycn/codex-proxy-rs/blob/v3.33.0/backend/crates/gateway-api/src/admin/accounts/wire.rs)和 [use case](https://github.com/zyycn/codex-proxy-rs/tree/v3.33.0/backend/crates/gateway-admin/src/use_case/accounts) 在此次固定提交间没有差异；保留 reset-credits 的 `accountId` / `creditId` / `redeemRequestId` 以及周预估 `estimatedUsd` / `estimatedUsdDisplay` 的语义。
- management v2、maintenance v1、manifest v2、8 条管理路由和页面资源不变。
- 插件 ID `personal.quota-manager`、状态命名空间 `quota-manager`、schemaVersion 1、设置键、原卡和持久 UUID 不变。
- 新实例自动使用仍默认关闭；保留已有设置。Free 排除、停用账号保护、消费前复核、HTTP 409 / 不确定结果保护、重启后确认原操作均沿用原逻辑。

## 兼容声明与打包必须同时更新

[v3.33.0 宿主声明](https://github.com/zyycn/codex-proxy-rs/blob/v3.33.0/backend/crates/gateway-plugin/runtime/plugin-host-compatibility.json)仅支持 RPC v7；[v3.32.0](https://github.com/zyycn/codex-proxy-rs/blob/v3.32.0/backend/crates/gateway-plugin/runtime/plugin-host-compatibility.json)仅支持 v6，旧 v3.30.2 / v3.31.1 快照仅支持 v5。本次保留旧快照作为拒绝测试，并新增 v3.32.0 / v3.33.0 原始声明，检查实际编译的 SDK 常量、清单和能力版本。

作者清单不手填 `package.protocolVersion`。发布工作流从同一固定提交构建官方 CLI，由其写入包清单 RPC v7 和制品摘要。仅放宽 engines 或修改旧包版本无效。自动发布仍生成 UTC 时间版本，不覆盖历史标签或制品；发布说明同步标识源码基线、对应宿主及兼容范围。

## 本地验证结果

环境：Windows，Rust 1.99.1、Node 24.19.0、pnpm 12.14.0，命令见 README。

- Rustfmt、严格 Clippy、debug 构建通过；6 项 Rust 测试通过，覆盖业务规则和 v7/旧宿主合同。
- 38 项真实 SDK 插件进程 / 模拟宿主场景通过，新增 v7 恢复授权、驻留结果消费、取消/迟到授权、普通回调恢复等待超时、维护前置查询计时；旧协议拒绝、设置冲突、自动规则、未决消费和持久状态重启恢复均通过。
- 12 项前端桥与响应契约、前端类型检查、生产构建通过。
- 11 项浏览器回归通过，覆盖中文控件、分页/筛选、选卡确认、CSV、预估零值/失败、深浅主题、390px 页面、10000 个模拟账号的四位页码及 220px 分页容器。已检查实际截图，位于 `verification/ui-artifacts/`。
- 4 项发布脚本测试通过，核对 SDK/打包器同提交、源码版本与发布说明的宿主映射及 UTC 版本生成。

本机没有执行 Linux 两架构构建；推送 main 后由现有工作流构建并以模拟宿主测试各目标二进制，ARM64 使用 QEMU，再用固定 CLI 打包。真实 RS v3.33.0 安装和线上切换未执行；网站更新前由部署方在目标宿主核对安装、页面、设置和运行状态，不以真实消费测试升级。
