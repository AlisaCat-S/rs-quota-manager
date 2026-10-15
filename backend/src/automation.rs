//! 全局与逐号自动选择，关闭优先并保留旧设置的读取兼容

use crate::{
    host::{load, save},
    model::{AccountState, Settings, is_free},
};
use gateway_plugin_sdk::{
    ErrorCode, PluginFault, call::host::AuthRuntimeAccount, client::HostClient,
};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

#[derive(Default, Serialize, Deserialize)]
pub struct Selection {
    pub default_enabled: Option<bool>,
    pub accounts: BTreeMap<String, bool>,
}

pub fn enabled(
    settings: &Settings,
    selection: &Selection,
    account: &AuthRuntimeAccount,
    state: &AccountState,
) -> bool {
    settings.automatic
        && account.enabled
        && account.provider_id == "openai"
        && account.authentication_kind == "oauth"
        && !is_free(account.plan_type.as_deref())
        && selection
            .accounts
            .get(&account.account_id)
            .copied()
            .or(selection.default_enabled)
            .unwrap_or(state.automatic)
}

fn check_version(current: Option<u64>, expected: Option<u64>) -> Result<(), PluginFault> {
    if current != expected {
        return Err(PluginFault::new(
            ErrorCode::Conflict,
            "自动设置已更新，请刷新后重试",
        ));
    }
    Ok(())
}

pub async fn save_settings(
    host: &HostClient,
    value: &Settings,
    expected: Option<u64>,
    select_all: bool,
) -> Result<u64, PluginFault> {
    let (current, version) = load::<Settings>(host, "settings").await?;
    check_version(version, expected)?;
    if select_all || current.automatic != value.automatic {
        let (_, selection_version) = load::<Selection>(host, "automation").await?;
        let selection = Selection {
            default_enabled: Some(value.automatic),
            accounts: BTreeMap::new(),
        };
        if !value.automatic {
            // 先关闭执行门，再清选择；第二次写入失败也不能继续消费
            let version = save(host, "settings", value, version).await?;
            save(host, "automation", &selection, selection_version).await?;
            return Ok(version);
        }
        // 开启前先写完整选择，不能先放开执行门
        save(host, "automation", &selection, selection_version).await?;
    }
    save(host, "settings", value, version).await
}

pub async fn select_account(
    host: &HostClient,
    account_id: &str,
    value: bool,
    expected: Option<u64>,
) -> Result<(Settings, Option<u64>), PluginFault> {
    let (mut settings, version) = load::<Settings>(host, "settings").await?;
    check_version(version, expected)?;
    let (mut selection, selection_version) = load::<Selection>(host, "automation").await?;
    if !settings.automatic {
        selection = Selection {
            default_enabled: Some(false),
            accounts: BTreeMap::new(),
        };
    }
    selection.accounts.insert(account_id.to_owned(), value);
    save(host, "automation", &selection, selection_version).await?;
    if value && !settings.automatic {
        settings.automatic = true;
        let version = save(host, "settings", &settings, version).await?;
        return Ok((settings, Some(version)));
    }
    Ok((settings, version))
}
