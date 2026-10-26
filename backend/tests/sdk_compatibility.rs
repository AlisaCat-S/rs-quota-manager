//! 固定宿主合同，验证 RPC v7 的兼容范围并拒绝旧协议宿主。

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
fn latest_v3_33_0_host_is_compatible() {
    assert_eq!(PROTOCOL_VERSION, 7);
    assert_host_compatible("3.33.0", include_bytes!("fixtures/host-v3.33.0.json"));
}

#[test]
fn old_rpc_hosts_are_incompatible() {
    let manifest = Manifest::from_author_slice(include_bytes!("../../plugin.json")).unwrap();
    for (version, declaration) in [
        (
            "3.30.2",
            include_bytes!("fixtures/host-v3.30.2.json").as_slice(),
        ),
        (
            "3.31.1",
            include_bytes!("fixtures/host-v3.31.1.json").as_slice(),
        ),
        (
            "3.32.0",
            include_bytes!("fixtures/host-v3.32.0.json").as_slice(),
        ),
    ] {
        let host: Value = serde_json::from_slice(declaration).unwrap();
        assert!(
            !host["protocol_versions"]
                .as_array()
                .unwrap()
                .contains(&json!(PROTOCOL_VERSION))
        );
        assert!(
            !manifest
                .engines
                .codex_proxy_rs
                .matches(&version.parse().unwrap())
        );
    }
}

#[test]
fn host_range_excludes_unverified_contract_generations() {
    let manifest = Manifest::from_author_slice(include_bytes!("../../plugin.json")).unwrap();
    for version in ["3.33.0-rc.1", "3.34.0"] {
        assert!(
            !manifest
                .engines
                .codex_proxy_rs
                .matches(&version.parse().unwrap())
        );
    }
}
