# Third-Party Notices

## codex-proxy-plugins

Source: https://github.com/zyycn/codex-proxy-plugins/tree/c1e1d5398990097f3987d595e5b3ea737ec2b66e/examples/workbench

License: Apache-2.0. The upstream license is included in Apache-2.0.txt.
The bridge guard, request handling and runtime validation organization in
frontend/src/api are adapted from the workbench example, with quota-specific
routes, models, query handling, validation and Chinese messages.
This repository is an example collection, not a runtime dependency.

## codex-proxy-ui

Source: https://github.com/zyycn/codex-proxy-ui/tree/v0.9.1

License: Apache-2.0. The upstream package includes its LICENSE.
The plugin imports the official v0.9.1 compiled release via public package
exports. Its components and styles are bundled without copying component
implementations. Shared theme tokens come from the host; local preview alone
initializes the public theme utilities. ZConfigProvider and the public zhHans
locale preserve the Chinese interface after the upstream default changed to English.
The public Vite themePrefix option preserves the cp CSS-variable namespace for
older hosts and advertises it to the semantic-token bridge in RS v3.37.
The new popover-shadow token falls back to the old box-shadow token when the
host does not supply it; modern host tokens still take precedence.

Package integrity is pinned in frontend/pnpm-lock.yaml.
