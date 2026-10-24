//! 隔离管理页面的路由、账号分页与设置保存

use crate::{
    automation::{self, Selection},
    engine, forecast,
    host::{fault, load, now, save},
    model::*,
};
use gateway_plugin_sdk::{
    ErrorCode, PluginFault,
    call::{data::QuotaFactsQuery, management::*},
    client::{TypedCall, TypedReply},
};
use serde::Deserialize;
use serde_json::{Value, json};

pub fn registration() -> ManagementRegistration {
    let route = |method: &str, path: &str| ManagementRoute {
        method: method.into(),
        path: path.into(),
        request_content_types: if method == "GET" {
            vec![]
        } else {
            vec!["application/json".into()]
        },
        response_content_types: vec!["application/json".into()],
    };
    ManagementRegistration {
        routes: vec![
            route("GET", "api/accounts"),
            route("GET", "api/settings"),
            route("POST", "api/settings"),
            route("POST", "api/automatic"),
            route("POST", "api/policy"),
            route("POST", "api/refresh"),
            route("POST", "api/consume"),
            route("POST", "api/retry"),
        ],
        resources: ["web/index.html", "web/app.js", "web/app.css"]
            .into_iter()
            .map(|p| ManagementResource {
                path: p.into(),
                public: false,
            })
            .collect(),
        pages: vec![ManagementPage {
            id: "quota-manager".into(),
            title: "周限与重置卡".into(),
            description: Some("账号额度与重置记录".into()),
            entry: "web/index.html".into(),
            icon: None,
        }],
        callbacks: vec![],
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AccountRequest {
    account_id: String,
    #[serde(default)]
    credit_id: Option<String>,
    #[serde(default)]
    request_id: Option<String>,
    #[serde(default)]
    automatic: Option<bool>,
    #[serde(default)]
    expected_version: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AutomaticRequest {
    enabled: bool,
    expected_version: Option<u64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SettingsRequest {
    value: Settings,
    expected_version: Option<u64>,
}

async fn handle_inner(call: TypedCall<ManagementRequest>) -> Result<Value, PluginFault> {
    let host = &call.host;
    if call.request.method == "GET" {
        if !call.payload.is_empty() {
            return Err(fault("查询不能包含正文"));
        }
        if call.request.path == "api/settings" {
            let (settings, version) = load::<Settings>(host, "settings").await?;
            let (scan, _) = load::<Scan>(host, "scan").await?;
            return Ok(json!({"value":settings,"version":version,"scan":scan}));
        }
        if call.request.path == "api/accounts" {
            let (settings, _) = load::<Settings>(host, "settings").await?;
            let (selection, _) = load::<Selection>(host, "automation").await?;
            let pairs: Vec<_> =
                url::form_urlencoded::parse(call.request.query.trim_start_matches('?').as_bytes())
                    .into_owned()
                    .collect();
            if pairs.len() > 1 || pairs.iter().any(|(k, v)| k != "cursor" || v.len() > 128) {
                return Err(fault("分页参数无效"));
            }
            let cursor = pairs.first().map(|(_, v)| v.clone());
            let page = engine::accounts_page(host, None, cursor.as_deref(), 30).await?;
            let mut rows = vec![];
            let mut excluded_pending = vec![];
            for account in page.accounts {
                let (mut state, _) =
                    load::<AccountState>(host, &engine::key(&account.account_id)).await?;
                state.automatic = automation::enabled(&settings, &selection, &account, &state);
                let account_view = json!({"account_id":account.account_id,"provider_id":account.provider_id,"name":account.name,"email":account.email,"enabled":account.enabled,"authentication_kind":account.authentication_kind,"plan_type":account.plan_type});
                if is_free(account.plan_type.as_deref()) {
                    if state.pending.is_some() {
                        excluded_pending
                            .push(json!({"account":account_view,"quota":null,"state":state,"forecast":null,"forecastError":null}));
                    }
                    continue;
                }
                let quota = host
                    .quota_facts(QuotaFactsQuery {
                        account_id: account.account_id.clone(),
                    })
                    .await
                    .ok();
                let (forecast, forecast_error) = forecast::read(host, &account.account_id).await;
                rows.push(json!({"account":account_view,"quota":quota,"state":state,"forecast":forecast,"forecastError":forecast_error}));
            }
            return Ok(
                json!({"accounts":rows,"excludedPending":excluded_pending,"nextCursor":page.next_cursor,"generatedAtMs":now()}),
            );
        }
        return Err(fault("路由不存在"));
    }
    if call.request.method != "POST" || call.payload.len() > 8192 {
        return Err(fault("请求无效"));
    }
    if call.request.path == "api/settings" {
        let request: SettingsRequest =
            serde_json::from_slice(&call.payload).map_err(|_| fault("设置格式无效"))?;
        if !request.value.valid() {
            return Err(fault("检测周期或批次数量超出范围"));
        }
        let version =
            automation::save_settings(host, &request.value, request.expected_version, false)
                .await?;
        return Ok(json!({"value":request.value,"version":version}));
    }
    if call.request.path == "api/automatic" {
        let request: AutomaticRequest =
            serde_json::from_slice(&call.payload).map_err(|_| fault("自动开关参数无效"))?;
        let (mut settings, _) = load::<Settings>(host, "settings").await?;
        settings.automatic = request.enabled;
        let version =
            automation::save_settings(host, &settings, request.expected_version, true).await?;
        return Ok(json!({"value":settings,"version":version}));
    }
    let request: AccountRequest =
        serde_json::from_slice(&call.payload).map_err(|_| fault("账号操作参数无效"))?;
    if request.account_id.len() > 128
        || request.account_id.is_empty()
        || request.account_id.chars().any(char::is_control)
    {
        return Err(fault("账号 ID 无效"));
    }
    let id = &request.account_id;
    match call.request.path.as_str() {
        "api/policy" => {
            let account = engine::detail(host, id).await?;
            engine::require_non_free(&account)?;
            if !account.enabled
                || account.provider_id != "openai"
                || account.authentication_kind != "oauth"
            {
                return Err(fault("该账号当前不能自动使用重置卡"));
            }
            let (settings, version) = automation::select_account(
                host,
                id,
                request
                    .automatic
                    .ok_or_else(|| fault("未指定自动使用开关"))?,
                request.expected_version,
            )
            .await?;
            let (mut state, _) = load::<AccountState>(host, &engine::key(id)).await?;
            let (selection, _) = load::<Selection>(host, "automation").await?;
            state.automatic = automation::enabled(&settings, &selection, &account, &state);
            Ok(json!({"state":state,"value":settings,"version":version}))
        }
        "api/refresh" => {
            let (mut state, version) = load::<AccountState>(host, &engine::key(id)).await?;
            let account = engine::detail(host, id).await?;
            engine::require_non_free(&account)?;
            if account.provider_id != "openai" || account.authentication_kind != "oauth" {
                return Err(fault("该账号不支持重置卡"));
            }
            let quota = host
                .refresh_account_quota(QuotaFactsQuery {
                    account_id: id.into(),
                })
                .await
                .ok();
            if let Some(q) = &quota {
                state.note_recovery(q);
            }
            let refreshed = engine::refresh_cards(host, id, &mut state).await;
            save(host, &engine::key(id), &state, version).await?;
            refreshed?;
            let quota = host
                .quota_facts(QuotaFactsQuery {
                    account_id: id.into(),
                })
                .await
                .ok();
            let (settings, _) = load::<Settings>(host, "settings").await?;
            let (selection, _) = load::<Selection>(host, "automation").await?;
            state.automatic = automation::enabled(&settings, &selection, &account, &state);
            let (forecast, forecast_error) = forecast::read(host, id).await;
            Ok(
                json!({"state":state,"quota":quota,"forecast":forecast,"forecastError":forecast_error}),
            )
        }
        "api/consume" | "api/retry" => {
            if call.request.path == "api/retry" && request.request_id.is_none() {
                return Err(fault("缺少原操作标识"));
            }
            if call.request.path == "api/consume" && request.request_id.is_some() {
                return Err(fault("新操作不能复用确认路由"));
            }
            let mut state = engine::consume(
                host,
                id,
                request.credit_id.as_deref(),
                request.request_id.as_deref(),
                false,
            )
            .await?;
            let account = engine::detail(host, id).await?;
            let (settings, _) = load::<Settings>(host, "settings").await?;
            let (selection, _) = load::<Selection>(host, "automation").await?;
            state.automatic = automation::enabled(&settings, &selection, &account, &state);
            let quota = host
                .quota_facts(QuotaFactsQuery {
                    account_id: id.into(),
                })
                .await
                .ok();
            let (forecast, forecast_error) = forecast::read(host, id).await;
            Ok(
                json!({"state":state,"quota":quota,"forecast":forecast,"forecastError":forecast_error}),
            )
        }
        _ => Err(fault("路由不存在")),
    }
}

pub async fn handle(
    call: TypedCall<ManagementRequest>,
) -> Result<TypedReply<ManagementResponse>, PluginFault> {
    let (status, value) = match handle_inner(call).await {
        Ok(value) => (200, value),
        Err(error) => (
            if error.code == ErrorCode::Conflict {
                409
            } else {
                400
            },
            json!({"error":{"message":error.message}}),
        ),
    };
    Ok(TypedReply::new(ManagementResponse {
        status,
        content_type: "application/json".into(),
        headers: vec![],
    })
    .with_payload(serde_json::to_vec(&value).map_err(|_| fault("响应编码失败"))?))
}
