//! 从宿主本地用量记录实时读取容量预估，不刷新远程额度

use crate::host::{account_path, admin};
use gateway_plugin_sdk::client::HostClient;
use serde::{Deserialize, Serialize};

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ForecastReport {
    pub account_id: String,
    pub generated_at: String,
    pub forecasts: Vec<Forecast>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Forecast {
    pub period: String,
    pub target_days: f64,
    pub extrapolated: bool,
    pub unavailable_reason: Option<String>,
    pub low_sample: bool,
    pub incomplete_cost: bool,
    pub estimated_usd: Option<f64>,
    pub estimated_usd_display: String,
}

pub async fn read(host: &HostClient, id: &str) -> (Option<ForecastReport>, Option<&'static str>) {
    let value = match admin(host, "GET", &account_path("quota-forecast", id), None).await {
        Ok(value) => value,
        Err(_) => return (None, Some("预估查询失败")),
    };
    match serde_json::from_value::<ForecastReport>(value) {
        Ok(report) if report.account_id == id => (Some(report), None),
        _ => (None, Some("预估响应无效")),
    }
}
