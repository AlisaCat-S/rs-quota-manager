# v0.3.6：适配 RS v3.44.0 SDK 与 UI v0.9.1

SDK、Cargo 锁文件与官方打包工具固定到 RS v3.44.0，宿主范围扩展为 `>=3.33.0, <3.45.0`。现有业务接口未发生破坏性变化，不增加代理功能或迁移插件状态；配套 UI 更新到 v0.9.1。

## 上游版本与比较范围

2026-11-11 通过 GitHub Releases API 核对最新正式版，并比较 [RS v3.43.0 → v3.44.0](https://github.com/zyycn/codex-proxy-rs/compare/v3.43.0...v3.44.0)：

| 稳定版 | 发布时间（UTC） | 完整提交 |
| --- | --- | --- |
| [v3.43.1](https://github.com/zyycn/codex-proxy-rs/releases/tag/v3.43.1) | 2026-11-08 10:55:16 | `197e9e517a300fcdd105d960bacaa7600c3c9747` |
| [v3.44.0](https://github.com/zyycn/codex-proxy-rs/releases/tag/v3.44.0) | 2026-11-09 04:32:52 | `c622f085748f812936a7371fcc85d1621fa72ca8` |

配套 [UI v0.9.1](https://github.com/zyycn/codex-proxy-ui/releases/tag/v0.9.1) 发布于 2026-11-09 04:13:29 UTC，提交 `46ade64479009ab9bc7cb1c8ec6d143fbd0a3b6c`，与 RS v3.44.0 的 UI 子模块一致。采用官方编译 tgz，由 pnpm 锁文件固定 integrity；不跟随未发布 main。SDK crate 仍为 0.1.0，最低 Rust 仍为 1.99.1，Rust、Vue、Vite 及无关依赖不升级。

## 差异与适配决定

| 上游变化 | 本插件的适配 |
| --- | --- |
| SDK 新增 `HostClient::list_proxies(ProxyListRequest)` / `host.proxies.list`，按页返回代理 ID、名称和启用状态，不暴露地址或凭据 | 插件没有选择代理的业务需求，不调用该接口，不新增配置、凭据读取或旧宿主版本前提。协议回归断言不发出新代理回调。 |
| SDK 新增 `HostClient::proxy_http(ProxyHttpRequest, body)` / `host.http.proxy`；发送时解析当前代理，代理不存在、禁用或连接失败时不回退直连 | 重置卡与周预估继续使用原有 `dispatch_http` / `host.http.dispatch` 访问宿主管理相对路径，由宿主处理账号认证和出口。不能改用不注入账号认证的代理 HTTP；保持 12 秒期限、正文上限和消费不自动重放规则。 |
| RS v3.43.1 重新授权为另一 OAuth 身份时更新邮箱、套餐与上游身份，隔离旧会话并重新查询额度，保留本地名称和调度设置 | 现有 `host.auth.list` / `get_runtime` 继续提供当前邮箱和 `plan_type`；插件按真实套餐而非本地名称排除 Free，消费前刷新后再次核对。已有套餐变化与未决 UUID 恢复回归继续覆盖这些插件边界，不读取 Token 或干预重新授权。 |
| RS v3.43.1 / v3.44.0 修正额度归属：生图端点可按 `active-limit` 将通用额度头归入图片计量项，常规模型请求仍归入 Codex | SDK `QuotaFacts` 未变。插件继续只识别唯一 `codex` 604800 秒窗口，不自行解析额度头。新增规则与进程回归：图片周限耗尽不能触发消费，图片余量不能掩盖 Codex 耗尽，也不能解除等待恢复。原始额度头的正确归属由宿主修复，旧宿主仍需自身升级。 |
| 账号连接测试的错误事件新增 `proxyHint`，区分代理配置、连接和隧道故障 | 插件不调用连接测试，也不解码这些事件；不把新诊断误用于重置卡结果。既有 409 / 429、未知结果和会话中断仍保留原卡与原 UUID，等待显式确认。 |
| UI v0.9.1 移除柔光材质隐含的尺寸覆盖，删除 `ThemePreset.customization`；材质只影响高光、渐变与阴影 | 升级官方发行包。插件未使用被删除的字段，生产页继续接收宿主 token，预览继续使用公开 `createTheme`。新增生产页回归，验证明暗两种模式下默认 / 柔光材质的默认圆角及显式字号、控件高度和卡片圆角保持独立，检查实际卡片尺寸。 |
| 柔光默认控件 / 卡片圆角变为 8px / 18px，侧栏保持直角 | 接受上游默认值，不硬编码旧柔光圆角。保留 `themePrefix: 'cp'`、中文语言包与旧宿主浮层阴影；旧宿主显式注入的圆角继续优先。 |

原始依据：[SDK 差异](https://github.com/zyycn/codex-proxy-rs/compare/v3.43.0...v3.44.0)、[代理 HTTP 与目录合同](https://github.com/zyycn/codex-proxy-rs/blob/v3.44.0/backend/crates/gateway-plugin/sdk/docs/capabilities.md)、[额度头分类](https://github.com/zyycn/codex-proxy-rs/blob/v3.44.0/backend/crates/gateway-protocol/src/openai/events.rs)、[生图 / Codex 隔离回归](https://github.com/zyycn/codex-proxy-rs/blob/v3.44.0/backend/crates/providers/openai/tests/provider/contract/mod.rs)、[重新授权实现](https://github.com/zyycn/codex-proxy-rs/blob/v3.44.0/backend/crates/providers/openai/src/credential/oauth.rs)、[UI 差异](https://github.com/zyycn/codex-proxy-ui/compare/v0.9.0...v0.9.1)。

逐路径比较确认：SDK 仅新增代理合同和客户端方法及其测试 / 文档；会话、帧、auth / quota / state / management / maintenance 合同未变。官方 CLI、宿主兼容声明、页面桥、重置卡接口、宿主原生重置卡自动化和周预估合同未变。RPC v7、清单 v2、management v2、maintenance v1、页面桥 v2 不变。

## 修改范围与数据保留

- 同步 SDK rev、Cargo 锁文件、工作流 `SDK_REV` 与官方打包工具；前端仅更新 UI 及其锁文件条目。
- 增加 v3.43.1 / v3.44.0 发布标签的原始宿主合同快照，保留 v3.33–v3.43 兼容检查，继续拒绝 RPC v5/v6、预发行和 v3.45.0。
- 后端、前端和清单源码基线统一为 0.3.6；更新发布说明、测试断言和第三方来源。兼容范围变化按新版本构建发布，不覆盖已发布制品。
- 插件 ID `personal.quota-manager`、命名空间 `quota-manager`、schemaVersion 1、设置键、历史、原卡与未决 UUID 保持不变；不修改账号启用状态、分组、自动开关或宿主运行设置。

## 验证与交付

Windows 本地，Rust 1.99.1、Node 24.19.0、pnpm 12.14.0：

- Rustfmt、严格 Clippy、debug 构建和 10 项 Rust 测试通过，合同快照覆盖至 v3.44.0。
- 42 项真实 SDK 插件进程 / 模拟宿主协议场景通过，包括图片额度隔离、旧宿主 RPC、挂起 / 恢复、取消 / 超时、Free / API Key 隔离、409 / 429 不重放和重启后原 UUID 恢复。
- 冻结锁文件安装、类型检查、生产构建、12 项前端契约测试、15 项浏览器回归和 4 项发布脚本测试通过。
- 生产页覆盖旧版前缀、旧语义 token、新版柔光材质和显式尺寸配置。已检查桌面、选卡、深色窄屏及自定义柔光截图，位于 `verification/ui-artifacts/`；测试未发起外部请求。

Linux 双架构构建、目标协议回归与官方 CLI 打包由推送 main 触发的现有 [工作流](https://github.com/AlisaCat-S/rs-quota-manager/actions/workflows/release.yml) 执行。

不执行真实宿主安装、网站部署或真实卡片消费。安装新包时保留原实例、私有状态和回退包，切换后读回设置与运行状态。
