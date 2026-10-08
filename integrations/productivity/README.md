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

## Scroll regression and durable source knowledge (2026-10-09)

The fullscreen host previously had inline overflow:hidden; content exceeded its
576px viewport but wheel scrolling left scrollTop at zero. Its shared scroll
region is now overflow:auto, keyboard-focusable, and contains overscroll. The
isolated browser regression verifies wheel, PageDown, mobile viewport scrolling
and real dialog input/save. Run tests/e2e/productivity-scroll.cjs against an
isolated long-list fixture on 127.0.0.1:17001, never live user data.

Project dossiers are stored separately in owner-scoped SQLite records. A human
sync backs up the DB, reads existing Hephastos archive catalogs/documents through
the authenticated read-only bridge, and commits a capture audit. It does not
overwrite personal workspace records or the concurrently used memory.json.
Work context derives project references from this database. The assistant can
discover projects, inspect documents/architecture/dependencies and read exact
retained source files in line and character-offset pages. Exclusions, catalog
coverage, saved revision and dates remain explicit; saved source is never live
runtime evidence. Private-key material, classified files and detected sensitive
text are excluded/redacted; heuristic redaction is not a perfect secret scan.

Not every archive entry has source. Live inspection found saved repository
catalogs for Mal3aby, Eshtry-Mny and Boutique; other entries can be metadata-only.
Do not claim complete semantic understanding of every project or every file.
No repository code is executed, and assistant infrastructure privileges do not
change. Candidate images: backend112 and Odysseus hephastos-3; publish them only
after import, then run the updated activation script and review its capture report.
