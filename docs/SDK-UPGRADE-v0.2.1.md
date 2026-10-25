# v0.2.1：同步 RS v3.31.1 SDK，保留 v3.30.2 支持

升级后继续使用原有账号列表、设置、周预估金额与重置卡入口，无需迁移插件状态。宿主范围由 `>=3.30.2, <3.31.0` 扩展为 `>=3.30.2, <3.32.0`。本次只交付源码与本地构建验证，未发布或切换网站。

## 固定最新稳定版，不跟踪浮动分支

核对日期：2026-10-25（Asia/Tokyo）。

- 宿主最新稳定版：[RS v3.31.1](https://github.com/zyycn/codex-proxy-rs/releases/tag/v3.31.1)，发布于 2026-10-24 20:52 UTC。SDK 与官方打包 CLI 一起固定到提交 `06e1d8f0ac33d8633198d837c4f9017ad466f358`。
- UI 最新稳定版：[v0.6.1](https://github.com/zyycn/codex-proxy-ui/releases/tag/v0.6.1)，使用官方预编译 tgz，pnpm 锁定 integrity。
- 核对时 RS main 为 `84c0db26135dae694a5f5ac608ed6c04df049234`，比标签多两个提交，仅涉及 CI、开发文档和宿主页面文案，没有 SDK 差异。
- SDK crate 版本仍为 `0.1.0`，用固定提交而非 crate 版本识别此次升级；Rust 最低版本仍为 1.99.1，UI 仍要求 Node 24+ / Vue 3.5+。

## 哪些差异需要适配

对比 [v3.30.2 → v3.31.1](https://github.com/zyycn/codex-proxy-rs/compare/v3.30.2...v3.31.1)，逐项核对 SDK 类型、宿主实现及本插件调用点：

| 上游变化 | 对本插件的影响与处理 |
| --- | --- |
| `middleware` v5 → v6，新增 `Stage::Outbound`、`OutboundCall` / `OutboundRequest` / `OutboundNext` | 本插件只声明 management 和 maintenance，不添加中间件能力或模型出站改写。`host.http.dispatch` 虽复用 HTTP 类型，但不是 middleware 能力注册，无需改成 v6。 |
| `MiddlewareNextRequest.settings` 区分省略和显式 `null`；只有省略保留原设置 | 本插件没有 `next.settings` 调用；不改写已有业务设置，也不引入空值替换。 |
| `upstream_adapter` v4 → v5，声明增加必填 `account_ids`，选择推迟到账号范围可判定时 | 本插件不注册上游适配器，不构造该声明。不能因为 SDK 新增此字段而向 quota-manager 的清单或账号查询添加前置条件。 |
| 删除 `ResponseObservation.upstream_response_model` 和 `RequestCompleted.response_model` | 本插件不订阅模型观察，也不读取这两个字段；周预估金额仍来自宿主本地用量查询，与响应模型字段无关。 |
| v3.31.1 移除 v3.31.0 曾引入的 `provider_parameters` / `installation_id` 专用构造入口，身份策略回归 request / attempt / outbound | 本插件从未使用这些入口，不生成或改写上游身份；私有状态中的消费 UUID 不属于 installation ID，继续原样持久化和复用。 |
| UI v0.6.0 → v0.6.1：排序箭头对比、长页码宽度、按容器空间收缩分页 | 更新官方发行包、锁文件与许可来源。保留公开组件导入和 `zhHans`。验证页码 1000 不裁切、账号切片正确、过窄容器隐藏页容量后仍可翻页，恢复宽度后页容量选择框重新出现。 |

依据：[SDK 能力版本](https://github.com/zyycn/codex-proxy-rs/blob/v3.31.1/backend/crates/gateway-plugin/sdk/src/capability.rs)、[中间件合同](https://github.com/zyycn/codex-proxy-rs/blob/v3.31.1/backend/crates/gateway-plugin/sdk/docs/capabilities.md)、[上游适配器声明](https://github.com/zyycn/codex-proxy-rs/blob/v3.31.1/backend/crates/gateway-plugin/sdk/src/call/upstream_adapter/mod.rs)。

## 原有管理和消费合同保持适用

本插件实际使用的下列源码在两个固定提交之间没有差异：

- RPC 消息、帧编解码和会话：`sdk/src/message.rs`、`sdk/src/client/frame.rs`、`sdk/src/client/session/`；进程协议仍为 v5。
- management 请求、注册和页面资源、maintenance 入口：管理能力 v2、维护能力 v1，8 条路由及页面资源不变。
- `host.auth.list`、`host.auth.get_runtime`、`host.data.quota.get`、`host.quota_observations.refresh`、`host.state.get/put`、`host.http.dispatch` 的请求和返回类型；乐观锁、字节请求头及受管响应正文读取方式不变。
- `gateway-api/src/admin/accounts/` 与 `gateway-admin/src/use_case/accounts/`：重置卡查询和消费、周预估查询的实现与 wire 合同不变。保留 `accountId`、`creditId`、`redeemRequestId` 以及 `estimatedUsd` / `estimatedUsdDisplay` 的含义。
- `frontend/src/views/plugins/management/` 的公开页面桥，版本仍为 2；不将 RPC 版本号用于浏览器桥。
- `backend/apps/plugin-cli/src/` 的打包实现；构建来源仍与 SDK 固定在同一提交，自动发布流程已同步。

原始依据：[SDK 清单与协议](https://github.com/zyycn/codex-proxy-rs/blob/v3.31.1/backend/crates/gateway-plugin/sdk/docs/manifest.md)、[账号 wire 合同](https://github.com/zyycn/codex-proxy-rs/blob/v3.31.1/backend/crates/gateway-api/src/admin/accounts/wire.rs)、[宿主页面桥](https://github.com/zyycn/codex-proxy-rs/blob/v3.31.1/frontend/src/views/plugins/management/bridge-contract.ts)。

自动消费仍默认关闭；Free 排除、停用账号保护、消费前复核、HTTP 409 和不确定结果保留原卡与原 UUID、重启后确认原操作均由原业务逻辑执行，不因依赖升级改写。

## 为什么保留旧宿主下限

[v3.30.2](https://github.com/zyycn/codex-proxy-rs/blob/v3.30.2/backend/crates/gateway-plugin/runtime/plugin-host-compatibility.json) 与 [v3.31.1](https://github.com/zyycn/codex-proxy-rs/blob/v3.31.1/backend/crates/gateway-plugin/runtime/plugin-host-compatibility.json) 的宿主声明都支持 manifest v2、RPC v5、management v2、maintenance v1。变化只涉及本插件未声明的能力，因此无需迫使 v3.30.2 用户先升级宿主。

`backend/tests/fixtures/host-v3.30.2.json` 和 `host-v3.31.1.json` 分别保存上述固定标签的原始宿主声明。`backend/tests/sdk_compatibility.rs` 将实际编译的 SDK 常量和作者清单与两份声明逐项核对，并检查兼容范围排除 v3.30.1 和 v3.32.0。协议回归另行运行真实的新 SDK 插件进程。

源码基线升为 0.2.1：这是保持现有合同的依赖升级和宿主范围扩展，不是 v0.2.0 那样的 RPC 破坏性升级。插件 ID `personal.quota-manager`、状态命名空间 `quota-manager`、schemaVersion 1、设置键、未决消费记录与 UUID 均不变。自动发布仍使用 UTC 时间版本号，不覆盖历史标签或 Release 制品。

## 本地验证结果

环境：Windows，本机 Rust 1.99.1、Node 24.21.0、pnpm 12.14.0。命令见 README。

- Rustfmt、严格 Clippy、debug 构建通过；6 项 Rust 测试通过（3 项业务规则、3 项宿主兼容）。
- 34 项真实 SDK 进程 / 模拟宿主协议场景通过，涵盖 RPC 大快照、旧协议拒绝、状态冲突、默认关闭、自动选择、消费未决和持久状态重启恢复。
- 12 项前端桥与响应契约用例、类型检查和生产构建通过。
- 11 项浏览器回归通过：中文控件、筛选、选卡确认、CSV、预估零值与查询失败、浅深主题、390px 页面，以及模拟 10000 个账号的四位页码和 220px 分页容器；已检查实际截图，位于 `verification/ui-artifacts/`。
- 3 项发布脚本测试通过，新增检查后端依赖与官方打包 CLI 的 SDK 固定提交一致。

没有执行 Linux 两架构制品构建、真实宿主安装或线上切换。本次源码发布应走现有双架构工作流；网站切换前还需在目标宿主完成安装、页面加载、设置与运行状态读回，真实自动使用保持关闭。真实卡片消费不作为升级测试。
