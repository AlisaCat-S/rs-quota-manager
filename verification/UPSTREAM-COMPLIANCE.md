# 上游规范审查

## 当前源码 v0.2.0

SDK 已对齐 RS v3.30.2，进程协议升级为 v5、management 升级为 v2，清单与页面桥保持 v2。UI 升级至 v0.6.0，并通过公开 `ZConfigProvider` / `zhHans` 保留中文控件。差异分析、原生自动重置冲突处理和验证证据见 [SDK 适配记录](../docs/SDK-UPGRADE-v0.2.0.md)。

### 周预估金额

管理页通过现有 `host.http.dispatch` 调用宿主相对路径 `GET /api/admin/accounts/quota-forecast?accountId=…`。RS v3.30.2 的 [查询实现](https://github.com/zyycn/codex-proxy-rs/blob/v3.30.2/backend/crates/gateway-admin/src/use_case/accounts/mod.rs) 使用 `refresh: false` 的额度观测和本地配对用量历史；[响应契约](https://github.com/zyycn/codex-proxy-rs/blob/v3.30.2/backend/crates/gateway-api/src/admin/accounts/wire.rs) 提供周/月预估。插件展示 `period: weekly` 的 `estimatedUsdDisplay`，保留金额原值用于导出，不自行按 Token 数或周期比例换算。页面与导出只展示周预估金额。

预估随账号快照读取、手动更新和消费结果回读更新，不写入插件私有状态。单个账号查询失败或响应账号不匹配时单独提示，保留账号列表、额度和卡片操作；无金额时显示“暂无预估”，零金额正常显示。预估不参与自动消费判断，SDK、宿主兼容范围和状态 schema 均不变。

2026-10-24 本地验证通过：Rustfmt、严格 Clippy、3 项 Rust 测试、34 项模拟宿主协议场景、12 项前端契约用例、9 项浏览器回归及生产构建。覆盖列顺序、金额实时更新、零值、只有 Token 而没有金额、预估失败、CSV、深浅主题和窄屏；截图见 `docs/screenshots/overview.png` 与 `verification/ui-artifacts/`。未进行真实宿主安装、线上切换或真实卡片消费。本次为新增展示功能，发布与网站更新需单独安排。

## 历史审查 v0.1.3–v0.1.4

审查范围：personal.quota-manager 0.1.2 -> 0.1.3。

公开发布 v0.1.4 继续沿用上述修正，并使用公开 ZCard 指标卡与 ZTag 会员标签，配色和样式取自共享组件。

## 依据

- [RS Issue #278](https://github.com/zyycn/codex-proxy-rs/issues/278)：自定义业务采用插件；UI 库用于组件和主题一致性；plugins 仓库提供可运行示例。不要求把示例集合安装为运行时依赖。
- RS v3.26.2，提交 `ae5eaa46b447548571e6c46d69bd27d454adb785` 的 `.agents/skills/cpr-plugin-dev`、公开 SDK 及宿主桥契约。
- [UI v0.4.1 安装说明](https://github.com/zyycn/codex-proxy-ui/blob/v0.4.1/playground/guide/installation.md)，当前源码参考 `1496e21637e7e80e87c7f75387e27ced5029187a`。
- [plugins/workbench](https://github.com/zyycn/codex-proxy-plugins/tree/c1e1d5398990097f3987d595e5b3ea737ec2b66e/examples/workbench)，提交 `c1e1d5398990097f3987d595e5b3ea737ec2b66e` 的 README、api/host.ts、api/request.ts、validation.ts、api/schemas 与 api/modules。

## 已有复用和保留项

- 原版已真实依赖 `@codex-proxy/ui`，不是只模仿外观；ZTable、ZPagination、ZSwitch、ZButton、ZIconButton、ZInput、ZInputNumber、ZSelect、ZPopover、ZCheckbox、ZDialog 均为公开组件。
- 保留 Vue SFC + TypeScript、官方 UI Vite 插件和 Tailwind 4 入口；打包静态资源，不加载 CDN 运行时代码。
- 后端通过公开 `PluginSession` / `PluginBuilder` 注册 management v1、maintenance v1，清单及进程协议为 v2；私有状态和原生账号维护通过宿主能力完成，不访问宿主数据库、内部 Rust 模块或账号凭据。
- 安装页主题由宿主注入；仅本地预览调用 UI 公开主题 API。
- 会员标识、额度条和摘要是业务呈现；上游没有对应的额度/重置卡组件，不强行复制或导入宿主内部业务组件。

## 修正项

| 原状态 | 修正 | 位置 |
| --- | --- | --- |
| UI 使用 Git 标签源码依赖 | 切到官方预编译 v0.4.1 tgz，核对官方 SHA-256，锁定 integrity | frontend/package.json、pnpm-lock.yaml |
| 卡片选择为原生自写 radio | 使用公开 ZRadio，保留键盘导航、焦点和禁用状态 | frontend/src/App.vue |
| 插件自定深浅主题兜底色 | 删除自有 HEX 兜底与深色规则，字体/颜色取宿主 token，根背景透明 | frontend/src/style.css |
| API 混在一个泛型强制转换文件 | 按示例分离 host、request、modules、schemas，返回 unknown 后逐字段解码 | frontend/src/api/ |
| 响应仅 JSON.parse 后断言类型 | 校验布尔、数组、非负整数、可空字段、未决操作和记录，处理无效 JSON、非 JSON、错误形状 | frontend/src/api/ |
| Blob 下载导航受隔离策略阻止 | 使用 ZDialog + ZTextarea 展示 CSV，复制/全选，不增加 sandbox 权限 | frontend/src/ExportDialog.vue、format.ts |
| 示例适配来源缺少说明 | 加入来源提交、改动说明和 Apache-2.0 许可，随包提供 | LICENSES/ |

## 不变的业务边界

Free 排除、完整邮箱显示、会员筛选、分页/页容量、内联检测设置、全局关闭同步逐号关闭、手动消费确认、持久幂等请求、原账号启用及分组配置均保留。
不把示例的模型调用、密钥处理或其他无关权限引入本插件，不修改宿主服务或 Nginx。

## 验证

新增前端测试：`node verification/frontend-test.mjs`。公开验证说明见 [docs/VERIFICATION.md](../docs/VERIFICATION.md)。
本地预览不能代替真实 sandbox 安装验收；真实自动启用和消费不用于线上测试。
