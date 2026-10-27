# v0.3.1：同步 RS v3.34.0 SDK，保留 v3.33 兼容

SDK 与官方打包工具一起更新到最新稳定宿主 RS v3.34.0，源码版本从 0.3.0 升至 0.3.1。此次没有 RPC 升级或状态迁移；兼容范围扩展为 `>=3.33.0, <3.35.0`，保留已有 v3.33.x 用户的使用条件。

## 固定稳定版，不混用 main

核对日期：2026-10-27（Asia/Tokyo）。

- 最新稳定宿主：[RS v3.34.0](https://github.com/zyycn/codex-proxy-rs/releases/tag/v3.34.0)，发布于 2026-10-27 09:04 UTC。标签解引用后的源码提交为 `47d30474af7c3e1fab433f2d4a70430fae548ff2`；Cargo、锁文件和发布工作流均固定到该提交。
- 基线为 v3.33.0 / `8c8618aa0f841638262262e3338c115bc075f125`，逐文件比较 [v3.33.0 → v3.34.0](https://github.com/zyycn/codex-proxy-rs/compare/v3.33.0...v3.34.0)。
- 核对时 main 为 `86a27bed9493feb3096baac86ac246463d794411`，**与稳定版 SDK 有差异**：移除模型目录 v1 类型与方法，`.model_catalog(...)` 改收 v2，宿主仅声明目录 v2。此次使用已发布 v3.34.0 的 v1/v2 并存合同，不把未发布改动当作稳定版要求。依据见 [稳定版与 main 对比](https://github.com/zyycn/codex-proxy-rs/compare/v3.34.0...86a27bed9493feb3096baac86ac246463d794411)。
- SDK crate 仍为 0.1.0，Rust 最低版本仍为 1.99.1；因此用完整 Git 提交识别 SDK。UI 最新稳定版仍是 [v0.7.0](https://github.com/zyycn/codex-proxy-ui/releases/tag/v0.7.0)，前端依赖及锁文件不变。

## 差异与适配决策

| 上游变化 | 对本插件的影响与处理 |
| --- | --- |
| 新增 `ModelCatalogRegistrationV2`、`AdaptedModel`、`ModelPresentation` 和 `MODEL_CATALOG_REGISTER_V2`；宿主目录能力由 `[1]` 变为 `[1, 2]` | 本插件只声明 management v2、maintenance v1，不贡献模型目录或适配器。无需注册新能力、提供模型或增加 Key 前提；原管理入口不变。 |
| 插件宿主范围或能力版本不匹配时，不再自动启动；管理员风险确认只对本次启动生效 | 旧包的 `<3.34.0` 会阻止其在新宿主自动启动。根据实际所用合同未变的比较结果，将新包范围扩大到 `<3.35.0`，并保留最低 v3.33.0；发布说明要求安装新包，不以风险确认替代适配。 |
| 一次受管 `inference` HTTP 429 可在严格条件下提供账号迁移重放依据 | 这是上游适配器推理路径，不适用于本插件的 `host.http.dispatch` 管理 POST。保持消费异常后的未决状态，不增加自动重试；新增 429 场景，验证后台巡检与新消费均不能重发，显式确认复用原卡与原 UUID。 |
| 宿主 RPC 流结束、会话失败时先撤销回调与封存发送观测，再通知结果，修复资源撤销竞态 | 修复位于宿主 runtime，不在插件 SDK 会话中。新 SDK 继续处理本插件的会话；新增实际进程 EOF 场景：持久化并发出消费后断开宿主输入，重启仍阻止另一张卡，确认时只复用原操作。宿主侧修复需由 RS v3.34.0 提供。 |
| 管理端搜索改为字面量匹配，账号搜索范围统一为名称和邮箱；调整管理端布局、额度颜色和模型目录 | 本插件账号分页不传搜索词，页面仍在本地按原账号 ID、名称、邮箱筛选，不缩减既有搜索范围。没有复制宿主内部组件；UI v0.7.0 保持，浏览器回归检查页面、选卡、CSV 和窄屏。 |
| 更新 Zstd Rust 安全封装、修复 Windows 数据库备份编译 | 本插件不依赖这些宿主模块，Cargo 锁文件只改变 SDK 来源和本插件源码版本，不连带升级无关依赖。 |

原始依据：[目录类型](https://github.com/zyycn/codex-proxy-rs/blob/v3.34.0/backend/crates/gateway-plugin/sdk/src/call/catalog.rs)、[能力版本](https://github.com/zyycn/codex-proxy-rs/blob/v3.34.0/backend/crates/gateway-plugin/runtime/plugin-host-compatibility.json)、[清单和启动条件](https://github.com/zyycn/codex-proxy-rs/blob/v3.34.0/backend/crates/gateway-plugin/sdk/docs/manifest.md)、[有限重放条件](https://github.com/zyycn/codex-proxy-rs/blob/v3.34.0/backend/crates/gateway-plugin/sdk/docs/upstream-adapters.md)、[RPC 撤销顺序](https://github.com/zyycn/codex-proxy-rs/blob/v3.34.0/backend/crates/gateway-plugin/runtime/src/rpc/calls.rs)。

## 原有合同与状态继续使用

逐文件比较确认，SDK 帧编解码、PluginSession 调度、HostClient、management / maintenance、账号和额度事实、私有状态及受管 HTTP 合同未变；[官方 CLI](https://github.com/zyycn/codex-proxy-rs/tree/v3.34.0/backend/apps/plugin-cli)、[账号 wire 类型](https://github.com/zyycn/codex-proxy-rs/blob/v3.34.0/backend/crates/gateway-api/src/admin/accounts/wire.rs)、[账号 use case](https://github.com/zyycn/codex-proxy-rs/tree/v3.34.0/backend/crates/gateway-admin/src/use_case/accounts)和[管理页宿主桥](https://github.com/zyycn/codex-proxy-rs/tree/v3.34.0/frontend/src/views/plugins/management)也没有变更。

- 仍为 manifest v2、RPC v7、management v2、maintenance v1、浏览器桥 v2。不把模型目录版本或宿主版本当作 RPC 版本。
- 继续使用 `host.auth.list/get_runtime`、`host.data.quota.get`、`host.quota_observations.refresh`、`host.state.get/put` 和 `host.http.dispatch`；重置卡的 `accountId` / `creditId` / `redeemRequestId`、周预估的 `estimatedUsd` / `estimatedUsdDisplay` 语义不变。
- 插件 ID `personal.quota-manager`、命名空间 `quota-manager`、schemaVersion 1、设置键、历史记录、已持久化的卡和 UUID 不变。新实例自动使用默认关闭，已有设置不重置。
- 保留 Free 排除、停用账号保护、消费前复核、剩余预算、串行入口、每批最多一个账号访问上游，以及不确定结果暂停消费的规则。

新增 v3.34.0 原始宿主合同快照，与 v3.33.0 一起校验实际编译 SDK 的协议常量、清单范围和本插件声明的能力版本；旧 v5/v6 宿主继续拒绝，预发行和 v3.35.0 不纳入范围。

## 验证和发布状态

本机 Windows，Rust 1.99.1、Node 24.19.0、pnpm 12.14.0：

- Rustfmt、严格 Clippy、debug 构建及 7 项 Rust 测试通过。
- 40 项真实 SDK 插件进程 / 模拟宿主场景通过，包括新增的管理 POST 429 不重放、会话 EOF 与重启确认；原挂起/恢复、回调回收、取消/超时、自动规则及持久化恢复全部通过。
- 前端冻结锁文件安装、类型检查、生产构建、12 项前端契约测试和 11 项浏览器回归通过。实际检查桌面、选卡弹窗、深色与窄屏截图，位于 `verification/ui-artifacts/`。
- 4 项发布脚本测试通过，检查 SDK、锁文件与打包工具同提交，以及源码版本、兼容范围和发行说明映射。命令与自动发布流程见 README。

SDK 兼容范围变化按独立发布处理。推送 main 后，现有自动发布工作流执行 Linux 双架构构建、目标二进制测试和官方 CLI 打包，全部通过后公开 Release；结果以 [Actions 构建记录](https://github.com/AlisaCat-S/rs-quota-manager/actions/workflows/release.yml)为准。本次未进行真实宿主安装、网站切换或真实卡片消费；目标宿主安装验收需核对页面、设置和运行状态，保留回退制品。
