# v0.3.4：同步 RS v3.39.1 SDK

SDK、Cargo 锁文件与官方打包工具固定到同一稳定版提交，宿主范围扩展为 `>=3.33.0, <3.40.0`。本插件所用合同未变，保留 v3.33–v3.38 兼容；无需改写业务调用或迁移私有状态。

## 核对稳定发布及源码差异

核对日期：2026-11-04（Asia/Tokyo）。通过 GitHub Releases API 确认最新稳定版，再抓取、解引用标签；不跟随未发布的 main。比较范围为 [v3.38.1 → v3.39.1](https://github.com/zyycn/codex-proxy-rs/compare/v3.38.1...v3.39.1)，包括：

| 稳定版 | 发布时间（UTC） | 完整提交 |
| --- | --- | --- |
| [v3.38.2](https://github.com/zyycn/codex-proxy-rs/releases/tag/v3.38.2) | 2026-11-02 05:55:24 | `7a32c6cec206939d6ecf97ea5d29fc1fdbeec3cf` |
| [v3.39.0](https://github.com/zyycn/codex-proxy-rs/releases/tag/v3.39.0) | 2026-11-02 12:11:41 | `96e8443ede051abdd8f0bac69462a7cfe2945633` |
| [v3.39.1](https://github.com/zyycn/codex-proxy-rs/releases/tag/v3.39.1) | 2026-11-03 04:07:31 | `12c32fcdecb29da4e44a21bb33fbbf2aaf6a166d` |

[UI 最新稳定版仍为 v0.8.0](https://github.com/zyycn/codex-proxy-ui/releases/tag/v0.8.0)，现有依赖及 pnpm 锁文件保持不变。SDK crate 版本仍为 0.1.0，以完整 Git 提交区分源码；Rust 最低版本仍为 1.99.1。

## 差异决定适配范围

| 上游变化 | 本插件的适配结论 |
| --- | --- |
| v3.38.2 为 SDK `RuntimeSettings`、`ReplaceRuntimeSettings` 新增必填 `max_retry_after_seconds: u32`，转换实现同步保留该字段 | 字段没有反序列化缺省值，使用新类型读取旧宿主运行设置会缺字段失败。已检查全部后端调用：插件的设置保存在 `host.state`，不调用宿主运行设置服务，也不构造这两个类型。因此不增加默认值包装、不调用整份运行设置替换，保持旧宿主使用条件。 |
| 推理重试新增 `maxRetryAfterSeconds`，默认 240 秒；超过上限时按既有策略安全换号或返回错误，不截短服务器建议 | 不把该设置套到 `host.http.dispatch` 管理请求。插件消费遇到 409 / 429、超时或中断时仍保留原卡与原 UUID，必须显式确认原操作；现有真实 SDK 进程回归覆盖此边界。 |
| v3.39.0 的宿主实例 `secrets` 改为逐字段补丁：字符串替换、`null` 清除、遗漏保留，空对象不再清除全部；跨版本以目标快照为基础 | 插件清单没有敏感配置，页面只调用自身 management 路由，不创建或配置宿主实例。不发送 `secrets`，也不为兼容而重写用户配置或密钥。 |
| 宿主新增 Windows x86_64 / ARM64 发行与在线更新、对应的官方插件平台识别 | 不等于本插件已有 Windows 安装包。保持现有 Linux x86_64 / ARM64、glibc >= 2.28 的构建目标、入口及打包参数，不扩展发行平台。 |
| CPR 账号池套餐分布可从已保存额度快照补全；用量诊断新增 `accountUpstreamPeer` 展示字段 | 插件不读账号池汇总或用量诊断，仍读取 `AuthRuntimeAccount` 与 `QuotaFacts`。不从显示标识推断套餐或周限，API Key 与 OAuth 卡片操作隔离保持不变。 |
| v3.39.1 修复全量请求的 turn-state 回传、保留客户端 trace / fedramp 头并使用账号安装身份；同时修复配置快照竞争与代理删除锁释放 | 均属宿主推理、配置或存储实现。本插件不转发推理请求、不持有账号凭据或代理事务，无需新增中间件、重试或权限。 |

依据：[SDK 运行设置类型](https://github.com/zyycn/codex-proxy-rs/blob/v3.39.1/backend/crates/gateway-plugin/sdk/src/call/services/settings.rs)、[重试等待合同](https://github.com/zyycn/codex-proxy-rs/blob/v3.39.1/docs/api.md#容量拒绝与重试)、[实例配置更新实现](https://github.com/zyycn/codex-proxy-rs/blob/v3.39.1/backend/crates/gateway-admin/src/use_case/plugins/instances/mutations.rs)、[平台识别](https://github.com/zyycn/codex-proxy-rs/blob/v3.39.1/backend/crates/gateway-admin/src/use_case/plugins/official.rs)、[CPR 套餐投影](https://github.com/zyycn/codex-proxy-rs/blob/v3.39.1/backend/crates/gateway-admin/src/use_case/peer_link/projection.rs)。

逐路径比较确认：SDK 仅上述运行设置文件变化；会话客户端、公开 auth / quota / state / management 数据、宿主 RPC 合同、重置卡与周预估路由及用例、页面桥、官方 `backend/apps/plugin-cli` 均未变化。RPC v7、清单 v2、management v2、maintenance v1、页面桥 v2 和 `themePrefix: 'cp'` 保持不变。

## 实际修改与数据保留

- 同步 SDK rev、Cargo 锁文件和工作流 `SDK_REV`，构建与打包固定同一来源，其他 Rust 依赖不升级。
- 从三个发布标签保存原始 `plugin-host-compatibility.json` 快照并加入兼容测试；继续检查旧快照及实际编译 SDK 常量，排除 RPC v5/v6、预发行和 v3.40.0。
- 后端、前端包元数据和清单源码基线统一为 0.3.4，同步发布脚本断言及说明。宿主范围扩大需要重新构建的新制品，沿用现有自动发布流程。
- 插件 ID `personal.quota-manager`、命名空间 `quota-manager`、schemaVersion 1、设置键、历史及未决 UUID 全部保留，不改账号启用状态、分组或自动开关。

## 验证与交付

Windows 本地，Rust 1.99.1、Node 24.19.0、pnpm 12.14.0：

- Rustfmt、严格 Clippy、debug 构建、9 项 Rust 测试通过；兼容快照覆盖至 v3.39.1。
- 41 项真实 SDK 插件进程 / 模拟宿主场景通过，涵盖挂起 / 恢复、取消 / 超时、账号隔离、409 / 429 不自动重放、会话中断及持久原卡 UUID 恢复。
- 冻结锁文件安装、前端类型检查、生产构建、12 项前端契约测试、13 项浏览器回归及 4 项发布脚本测试通过；已检查桌面、选卡与深色窄屏截图，位于 `verification/ui-artifacts/`。

推送 main 后，现有工作流验证发布脚本、构建 Linux 双架构并运行目标协议测试，以同提交官方 CLI 打包，全部通过后创建新 Release；以 [Actions 记录](https://github.com/AlisaCat-S/rs-quota-manager/actions/workflows/release.yml) 为准。不覆盖旧标签或附件。

本次未执行真实宿主安装、网站部署或真实卡片消费。安装新制品时保留原实例、私有状态和回退包，切换后读回设置与运行状态。
