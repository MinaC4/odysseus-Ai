# Personal workspace migration

These are owned Odysseus source modules, not links or iframes to the old dashboard.
The source pages and their dependencies were transferred without removing the
original Hephastos records or routes. React renders inside an isolated Shadow DOM
in the native Odysseus tool window; theme tokens and navigation come from Odysseus.

Build with `npm ci && npm run build`. The generated, route-split bundle lives in
`static/productivity` and is required in the application image. The package has
its own lockfile; React is not loaded into unrelated Odysseus panels.

Data belongs to `ProductivityRecord.owner` in the existing PVC-backed app database.
Records retain original IDs and JSON fields, including uploaded file contents.
The migration script takes a SQLite backup, compares two source captures, then
verifies a SHA-256 digest of the saved records. It does not delete source data.

`manage_productivity` reads bounded records or creates a durable edit proposal.
Only an authenticated human can approve it; approvals are owner-bound, single-use,
expire after 30 minutes and reject changes to the reviewed records. Record writes
and audit events commit in the same transaction.

Remote execution retains explicit code/version/target review and pinned SSH host
verification. It is human-admin-only, never available to the connected assistant.
Provision profiles through `ODYSSEUS_SCRIPT_DEVICES_FILE`, matching the old profile
fields (`id`, `name`, `host`, `port`, `username`, `privateKeyPath`, `knownHostsPath`).
Do not commit SSH credentials. No existing device profile has yet been copied or
executed by this migration.

The build-only Tailwind 3 dependency currently inherits the unpatched braces
stack-exhaustion advisory GHSA-vfj7-8cjw-p6xm. No development server is deployed;
build inputs are fixed trusted source paths. This is not a claim of a clean
full dependency scan. PostCSS and selector parsing were upgraded separately.

NOT YET VERIFIED: live data capture, all six production browser workflows,
reminder delivery across restarts, complete old/new capability parity and removal
of the original pages. Do not call this migration complete until those checks pass.
