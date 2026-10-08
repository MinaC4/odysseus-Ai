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

Verified initial production migration: 494 records to account admin with matching
source/destination digest; original data and SQLite backups retained. The next
candidate adds Quick Launcher (79 source links observed), full-viewport windows
and ten owner-scoped work facts, seeded once with a memory backup. Source data is
not automatically updated from the new workspace.

Candidate checks: 13 isolated integration tests, strict TypeScript/Vite build,
seven native tools at desktop/mobile sizes with fullscreen geometry checks and
no browser runtime errors. Production Launcher capture and rollout require the
image import and Hephastos scripts/activate-personal-workspace.sh. Still pending:
production CRUD acceptance, reminder delivery across restarts, configured SSH
devices and off-device recovery. Infrastructure remains deliberately read-only;
this is not unrestricted control of every Hephastos dashboard API.
