# v0.3.3：同步 RS v3.38.1 SDK

源码从 0.3.2 升至 0.3.3。SDK、Cargo 锁文件与官方打包工具固定同一稳定版提交，宿主范围扩展为 `>=3.33.0, <3.39.0`，保留 v3.33–v3.37 的使用条件。公开接口不变，业务代码无需改写，无状态迁移。

## 以最新稳定发布为准

核对日期：2026-11-02（Asia/Tokyo）。通过 GitHub Releases API 查询最新稳定版，再解引用本地抓取的 Git 标签；不跟随未发布的 main。

- [RS v3.38.1](https://github.com/zyycn/codex-proxy-rs/releases/tag/v3.38.1)：2026-11-01 16:19:55 UTC 发布，提交 `e0b7a841ca074f17e11dad73f39a159c75cb2fb1`。
- 中间版 [v3.38.0](https://github.com/zyycn/codex-proxy-rs/releases/tag/v3.38.0)：同日 15:43:32 UTC 发布，提交 `6f138c8256ee94cf0e96029baee0033bb1943fa6`。
- 比较范围：[RS v3.37.2 → v3.38.1](https://github.com/zyycn/codex-proxy-rs/compare/v3.37.2...v3.38.1)，包含上述两个版本。
- [UI 最新稳定版仍为 v0.8.0](https://github.com/zyycn/codex-proxy-ui/releases/tag/v0.8.0)，本项目已经使用，因此保持前端依赖及 pnpm 锁文件不变。Rust 最低版本仍为 1.99.1，SDK crate 仍为 0.1.0，依靠完整 Git 提交区分源码。

## 差异与适配结论

| 上游变化 | 本插件处理 |
| --- | --- |
| SDK 的私有模块 `client::read` 重命名为 `client::pending_read`，实现原样保留，内部引用同步调整 | 公开导出、`PluginSession`、`PluginBuilder`、`HostClient`、HTTP 流及 auth / quota / state 数据合同未变。本插件只使用公开入口，直接同步固定提交，不添加兼容包装层。 |
| 宿主 runtime 将流实现收进 `rpc`，整理 generation、deprecation 和私有状态 schema 校验模块 | 未改插件 wire 合同。RPC 仍为 v7，清单 v2、management v2、maintenance v1 不变。私有状态 schema 的离线校验、排序与摘要算法保持原样，不变更插件 schemaVersion。 |
| CPR Link 升至 v2：能力块可独立省略，预算由固定 daily / weekly 改为命名 `usage.data.windows`，允许其他周期及缺失观测 | 这是互联 HTTP 协议，与插件 RPC 无关。本插件不直接解析 `/cpr/link`，继续读取宿主投影后的 `QuotaFacts`。预算窗口 `peer:budget:*`、池内 `peer:*` 不是 `codex` 通用周限；API Key 仍不允许卡片操作。补测试覆盖周、月、自定义周期、池内额度及未知字段，避免把缺失值当成耗尽或恢复。 |
| 互联识别结果持久化，手动刷新等待查询完成并可重新探测不支持互联的连接 | 不引入互联刷新请求或额外权限。页面快照和周预估继续只读本地观测；主动额度与卡片刷新仍限于适用的 OAuth 账号。 |
| v3.38.1 将有效模型目录资格与账号模型政策统一用于 OAuth、API Key 和 xAI 的原生 Responses 调度；模型拒绝可形成账号 / 模型冷却 | 本插件没有模型目录或推理贡献，不选推理账号，也不调用 Responses。不把模型资格、冷却或预算耗尽当作 OAuth 周限耗尽。 |
| 原生重置卡后台任务重命名为 `reset_credit_worker`，排程函数移动至账号用例 | 重置卡管理路由、输入与结果未变，原生自动策略和本插件策略仍相互独立。409 / 429 和不确定结果仍保留原卡与原 UUID，不自动重放消费。 |
| 出站新增移除 `sentry-trace`、`baggage` 及 WebSocket metadata 副本；租约批读取与 Cookie 版本冲突日志调整 | 属于宿主推理链路；插件不透传推理头、不读写凭据或租约，无需新增中间件。 |

依据：[SDK 私有模块及公开导出](https://github.com/zyycn/codex-proxy-rs/blob/v3.38.1/backend/crates/gateway-plugin/sdk/src/client/mod.rs)、[互联协议](https://github.com/zyycn/codex-proxy-rs/blob/v3.38.1/docs/api.md#cpr-互联只读协议)、[额度投影](https://github.com/zyycn/codex-proxy-rs/blob/v3.38.1/backend/crates/gateway-admin/src/use_case/peer_link/upstream/projection.rs)、[状态 schema](https://github.com/zyycn/codex-proxy-rs/blob/v3.38.1/backend/crates/gateway-plugin/runtime/src/package/state_schema.rs)、[重置卡用例](https://github.com/zyycn/codex-proxy-rs/blob/v3.38.1/backend/crates/gateway-admin/src/use_case/accounts/reset_credit_automation.rs)。

逐路径比较还确认：官方 `backend/apps/plugin-cli`、页面桥 `frontend/src/views/plugins`、SDK `src/call`、账号管理 wire / 路由、周预估模型及账号主用例在本次范围内均无改动。因此继续使用现有打包参数、`themePrefix: 'cp'`、桥 v2、重置卡 GET / POST 与本地周金额预估，不改前端调用合同。

## 修改范围与数据保留

- 更新 SDK rev、Cargo 锁文件和发布工作流 `SDK_REV`，防止构建与打包来源错位；其他 Rust 依赖不升级。
- 清单允许 v3.38.x，并从两个已发布标签保存原始 `plugin-host-compatibility.json` 快照。兼容测试仍检查 v3.33 起的旧快照、所用能力版本及实际编译 SDK 的协议常量；继续排除 RPC v5/v6、预发行和 v3.39.0。
- 同步后端、前端包元数据、清单源码版本、发布说明及发布脚本断言。宿主范围变化需要新制品，按独立发布处理。
- 插件 ID `personal.quota-manager`、命名空间 `quota-manager`、schemaVersion 1、设置键、历史、原卡及未决 UUID 全部不变；不重置开关、不改账号启用状态或分组。没有新增宿主能力、模型或密钥前提。

## 验证与交付

Windows 本地，Rust 1.99.1、Node 24.19.0、pnpm 12.14.0：

- Rustfmt、严格 Clippy、debug 构建、9 项 Rust 测试通过，含两个新版本合同快照与 CPR Link v2 窗口隔离回归。
- 41 项真实 SDK 插件进程 / 模拟宿主场景通过，含挂起 / 恢复授权、取消 / 超时、API Key 隔离、409 / 429、会话中断和原卡 UUID 恢复。
- 冻结锁文件安装、前端类型检查、生产构建、12 项前端契约测试、13 项浏览器回归及 4 项发布脚本测试通过。
- 浏览器覆盖中文分页、筛选、选卡、CSV、窄容器及生产构建中新旧主题注入与明暗切换；截图位于 `verification/ui-artifacts/`。

提交并推送 main 后，现有工作流用本次固定 SDK 构建 Linux x86_64 / ARM64、运行目标协议测试并以同提交官方 CLI 打包，全部通过后发布新 Release，不覆盖旧标签与制品。结果以 [Actions](https://github.com/AlisaCat-S/rs-quota-manager/actions/workflows/release.yml) 为准。

本次未执行真实宿主安装、网站部署或真实卡片消费。安装新包时保留原实例、私有状态和回退制品，读回设置及运行状态；不以真实消费验证升级。
