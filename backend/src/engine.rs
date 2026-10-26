//! 账号卡片刷新、不可逆消费与有界后台巡检

use crate::{
    automation::{self, Selection},
    host::{account_path, admin, fault, load, now, save},
    model::*,
};
use gateway_plugin_sdk::{
    PluginFault,
    call::{
        data::QuotaFactsQuery,
        host::{AuthListResult, AuthRuntimeAccount},
    },
    client::HostClient,
};
use serde_json::{Value, json};

pub fn key(id: &str) -> String {
    format!("account/{id}")
}

pub async fn accounts_page(
    host: &HostClient,
    provider: Option<&str>,
    cursor: Option<&str>,
    limit: u16,
) -> Result<AuthListResult, PluginFault> {
    let reply = host
        .call(
            "host.auth.list",
            json!({}),
            serde_json::to_vec(&json!({"provider_id":provider,"cursor":cursor,"limit":limit}))
                .map_err(|_| fault("分页参数无效"))?,
        )
        .await
        .map_err(|e| e.into_plugin_fault())?;
    serde_json::from_slice(&reply.payload).map_err(|_| fault("账号列表无效"))
}

pub fn require_non_free(account: &AuthRuntimeAccount) -> Result<(), PluginFault> {
    if is_free(account.plan_type.as_deref()) {
        return Err(fault("RS 当前套餐为 Free，该账号不参与此插件"));
    }
    Ok(())
}

pub async fn detail(host: &HostClient, id: &str) -> Result<AuthRuntimeAccount, PluginFault> {
    let reply = host
        .call(
            "host.auth.get_runtime",
            json!({}),
            serde_json::to_vec(&json!({"account_id":id})).map_err(|_| fault("账号参数无效"))?,
        )
        .await
        .map_err(|e| e.into_plugin_fault())?;
    let value: AuthRuntimeAccount =
        serde_json::from_slice(&reply.payload).map_err(|_| fault("账号状态无效"))?;
    if value.account_id != id {
        return Err(fault("账号详情不匹配"));
    }
    Ok(value)
}

pub async fn refresh_cards(
    host: &HostClient,
    id: &str,
    state: &mut AccountState,
) -> Result<(), PluginFault> {
    state.cards_checked_at_ms = Some(now());
    match admin(host, "GET", &account_path("reset-credits", id), None).await {
        Ok(value) => {
            let cards = serde_json::from_value(value).map_err(|_| fault("重置卡响应无效"))?;
            state.cards = Some(cards);
            state.cards_observed_at_ms = Some(now());
            state.error = None;
            Ok(())
        }
        Err(error) => {
            state.error = Some("重置卡查询失败，保留上次快照".into());
            Err(error)
        }
    }
}

pub async fn consume(
    host: &HostClient,
    id: &str,
    requested_card: Option<&str>,
    retry_id: Option<&str>,
    automatic: bool,
) -> Result<AccountState, PluginFault> {
    let (mut state, mut version) = load::<AccountState>(host, &key(id)).await?;
    let operation = if let Some(pending) = &state.pending {
        if retry_id != Some(pending.request_id.as_str()) {
            return Err(fault("上次结果待确认，请继续确认原操作"));
        }
        pending.clone()
    } else {
        if retry_id.is_some() {
            return Err(fault("原操作已结束，请刷新账号记录"));
        }
        let account = detail(host, id).await?;
        require_non_free(&account)?;
        if account.provider_id != "openai" || account.authentication_kind != "oauth" {
            return Err(fault("该账号不支持主动额度重置卡"));
        }
        if automatic {
            let (settings, _) = load::<Settings>(host, "settings").await?;
            let (selection, _) = load::<Selection>(host, "automation").await?;
            if !automation::enabled(&settings, &selection, &account, &state)
                || state.awaiting_recovery
                || state.last_attempt_at_ms.is_some_and(|t| now() - t < 60000)
            {
                return Err(fault("自动重置条件已变化"));
            }
            let quota = host
                .refresh_account_quota(QuotaFactsQuery {
                    account_id: id.into(),
                })
                .await?;
            if !exhausted(&quota, now()) {
                return Err(fault("最新周限未耗尽，已跳过重置"));
            }
        }
        refresh_cards(host, id, &mut state).await?;
        // 上游刷新可能更新套餐，消费前再次以宿主当前套餐为准
        let current = detail(host, id).await?;
        require_non_free(&current)?;
        if automatic {
            let (settings, _) = load::<Settings>(host, "settings").await?;
            let (selection, _) = load::<Selection>(host, "automation").await?;
            if !automation::enabled(&settings, &selection, &current, &state) {
                return Err(fault("自动设置已变化，已跳过重置"));
            }
        }
        let cards = state
            .cards
            .as_ref()
            .ok_or_else(|| fault("尚无重置卡快照"))?;
        let credit_id = if automatic {
            Some(
                first_expiring_weekly_card(cards, now())
                    .ok_or_else(|| fault("没有可用于周限的有效重置卡"))?
                    .id
                    .clone(),
            )
        } else if let Some(id) = requested_card {
            if cards.available_count == 0
                || !cards
                    .credits
                    .iter()
                    .any(|c| c.id == id && c.available(now()))
            {
                return Err(fault("所选重置卡已不可用，请刷新后选择"));
            }
            Some(id.to_owned())
        } else {
            if cards.available_count == 0 || !cards.credits.is_empty() {
                return Err(fault("请选择具体重置卡"));
            }
            None
        };
        let pending = Pending {
            request_id: uuid::Uuid::new_v4().to_string(),
            credit_id,
            started_at_ms: now(),
            automatic,
        };
        state.pending = Some(pending.clone());
        state.last_attempt_at_ms = Some(now());
        // 必须先完成持久化，再消费；重启或取消后只允许复用这一个幂等键
        version = Some(save(host, &key(id), &state, version).await?);
        pending
    };
    let result = admin(
        host,
        "POST",
        "/api/admin/accounts/reset-credits",
        Some(json!({
            "accountId":id, "creditId":operation.credit_id, "redeemRequestId":operation.request_id
        })),
    )
    .await;
    match result {
        Ok(value)
            if value
                .get("code")
                .and_then(Value::as_str)
                .is_some_and(|code| {
                    matches!(
                        code,
                        "reset" | "already_redeemed" | "no_credit" | "nothing_to_reset"
                    )
                }) =>
        {
            let code = value["code"].as_str().unwrap_or_default().to_owned();
            let confirmed = code == "reset" || (code == "already_redeemed" && retry_id.is_some());
            state.pending = None;
            state.awaiting_recovery |= confirmed;
            state.last_attempt_at_ms = Some(now());
            state.error = if confirmed {
                None
            } else {
                Some(format!("上游未执行重置：{code}"))
            };
            if confirmed {
                if let Some(cards) = &mut state.cards {
                    cards.available_count = cards.available_count.saturating_sub(1);
                    if let Some(id) = &operation.credit_id {
                        cards.credits.retain(|c| &c.id != id);
                    }
                }
                state.cards_observed_at_ms = None;
            }
            state.history.insert(
                0,
                Event {
                    at_ms: now(),
                    request_id: operation.request_id,
                    credit_id: operation.credit_id,
                    automatic: operation.automatic,
                    code,
                },
            );
            state.history.truncate(20);
            // 成功事实先保存，回读失败不改变已确认的消费结果
            version = Some(save(host, &key(id), &state, version).await?);
            if confirmed {
                if let Ok(quota) = host
                    .refresh_account_quota(QuotaFactsQuery {
                        account_id: id.into(),
                    })
                    .await
                {
                    state.note_recovery(&quota);
                }
                let _ = refresh_cards(host, id, &mut state).await;
                save(host, &key(id), &state, version).await?;
            }
        }
        _ => {
            state.error = Some("消费结果待确认，自动使用已暂停".into());
            save(host, &key(id), &state, version).await?;
        }
    }
    Ok(state)
}

pub async fn reconcile(host: &HostClient) -> Result<(), PluginFault> {
    let (settings, _) = load::<Settings>(host, "settings").await?;
    let (selection, _) = load::<Selection>(host, "automation").await?;
    if !settings.valid() {
        return Err(fault("巡检设置无效"));
    }
    let (mut scan, scan_version) = load::<Scan>(host, "scan").await?;
    if scan.next_at_ms > now() {
        return Ok(());
    }
    let page = accounts_page(
        host,
        Some("openai"),
        scan.cursor.as_deref(),
        settings.batch_size,
    )
    .await?;
    let mut network_used = false;
    for account in &page.accounts {
        // 使用会话共享的剩余预算，包含前置查询、普通回调与恢复排队耗时。
        if host
            .remaining_budget()
            .is_some_and(|remaining| remaining < std::time::Duration::from_secs(18))
        {
            break;
        }
        scan.cursor = Some(account.account_id.clone());
        if is_free(account.plan_type.as_deref()) || account.authentication_kind != "oauth" {
            continue;
        }
        let (mut state, version) = load::<AccountState>(host, &key(&account.account_id)).await?;
        let quota = match host
            .quota_facts(QuotaFactsQuery {
                account_id: account.account_id.clone(),
            })
            .await
        {
            Ok(q) => q,
            Err(_) => continue,
        };
        state.note_recovery(&quota);
        let should_consume = automation::enabled(&settings, &selection, account, &state)
            && state.pending.is_none()
            && !state.awaiting_recovery
            && state.last_attempt_at_ms.is_none_or(|t| now() - t >= 60000)
            && account_weekly(&quota).is_some_and(|w| {
                w.used_percent.is_some_and(|p| p >= 100.0)
                    && w.reset_at_ms.is_some_and(|t| t > now())
            });
        let cards_due = state
            .cards_checked_at_ms
            .is_none_or(|t| now() - t >= (settings.cards_refresh_seconds * 1000) as i64);
        if !network_used && should_consume {
            save(host, &key(&account.account_id), &state, version).await?;
            network_used = true;
            if consume(host, &account.account_id, None, None, true)
                .await
                .is_err()
            {
                let (mut current, current_version) =
                    load::<AccountState>(host, &key(&account.account_id)).await?;
                current.error = Some("自动检查未完成或未满足重置条件".into());
                current.last_attempt_at_ms = Some(now());
                save(host, &key(&account.account_id), &current, current_version).await?;
            }
        } else {
            if !network_used
                && cards_due
                && account_weekly(&quota).is_some()
                && state.pending.is_none()
            {
                network_used = true;
                // 每批最多一个账号访问上游，停用账号也可只读查询，不改变其状态
                let _ = refresh_cards(host, &account.account_id, &mut state).await;
            }
            save(host, &key(&account.account_id), &state, version).await?;
        }
    }
    if page.accounts.is_empty()
        || (page.next_cursor.is_none()
            && scan.cursor == page.accounts.last().map(|v| v.account_id.clone()))
    {
        scan.cursor = None;
    }
    scan.checked_at_ms = Some(now());
    scan.next_at_ms = now() + (settings.check_interval_seconds * 1000) as i64;
    save(host, "scan", &scan, scan_version).await?;
    Ok(())
}
