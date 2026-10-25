//! 固定上游宿主声明，防止 SDK 升级无意提高既有管理与维护入口的要求。

use gateway_plugin_sdk::{MANIFEST_VERSION, Manifest, PROTOCOL_VERSION};
use serde_json::{Value, json};

fn assert_host_compatible(version: &str, declaration: &[u8]) {
    let host: Value = serde_json::from_slice(declaration).unwrap();
    let manifest = Manifest::from_author_slice(include_bytes!("../../plugin.json")).unwrap();
    assert!(
        manifest
            .engines
            .codex_proxy_rs
            .matches(&version.parse().unwrap()),
        "host {version} must remain in the supported range"
    );
    assert!(
        host["manifest_schema_versions"]
            .as_array()
            .unwrap()
            .contains(&json!(MANIFEST_VERSION))
    );
    assert!(
        host["protocol_versions"]
            .as_array()
            .unwrap()
            .contains(&json!(PROTOCOL_VERSION))
    );
    for (capability, contribution) in &manifest.contributes {
        let supported = host["capabilities"]
            .as_array()
            .unwrap()
            .iter()
            .find(|entry| entry["capability"] == capability.identifier())
            .unwrap();
        assert!(
            supported["versions"]
                .as_array()
                .unwrap()
                .contains(&json!(contribution.version)),
            "host {version} does not support {capability:?} v{}",
            contribution.version
        );
    }
}

#[test]
fn existing_v3_30_2_host_remains_compatible() {
    assert_host_compatible("3.30.2", include_bytes!("fixtures/host-v3.30.2.json"));
}

#[test]
fn latest_v3_31_1_host_is_compatible() {
    assert_host_compatible("3.31.1", include_bytes!("fixtures/host-v3.31.1.json"));
}

#[test]
fn host_range_excludes_unverified_contract_generations() {
    let manifest = Manifest::from_author_slice(include_bytes!("../../plugin.json")).unwrap();
    for version in ["3.30.1", "3.32.0"] {
        assert!(
            !manifest
                .engines
                .codex_proxy_rs
                .matches(&version.parse().unwrap())
        );
    }
}
