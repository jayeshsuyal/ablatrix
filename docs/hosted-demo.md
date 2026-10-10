# Restricted hosted demo

This deployment runs one app and one revision worker against one persistent SQLite directory. It is an invited, shared workspace: invited users see the same demo products, answers, and reviews. Hosted generation and revision use the synthetic provider. They make no paid model calls and do not establish answer-quality improvement.

The container binds port 4180 on the host's loopback interface. Access configuration and a gateway that supplies verified identity are also required; exposing the port alone does not provide the complete hosted workflow. Keep the demo data separate from local experiments and live-call ledgers.

## Invite users through the identity gateway

This package is **prepared for deployment; no public host, domain, or login provider is provisioned by the repository**. Cloudflare Access is the documented gateway example. It handles sign-in and forwards its assertion; Ablatrix independently verifies the signed JWT using `jose`, the exact issuer and application audience, expiration, and a configured subject allowlist. Merely supplying an identity header does not grant access. See Cloudflare's [JWT validation guidance](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

1. Configure an Access application for your HTTPS demo domain and restrict its login policy to invited users. Connect a private tunnel or reverse proxy to host loopback port 4180. Preserve the public `Host` header. Do not expose the origin port directly to the internet.
2. Copy `deploy/access.example.json` to ignored `deploy/access.json`. Replace the public origin, Access team issuer, application AUD, and certificate endpoint. Configure each member's stable subject from their verified identity-provider session. Roles come from this server-side file, never a browser field, email header, or JWT role claim.
3. Mount the config read-only as shown in Compose. Restart after membership changes. Removing someone from this file revokes their application access on that restart even if their gateway token has not expired.
4. Start the single container, sign in through the public HTTPS URL, and open `/ask`. Check the signed-in name and role in the banner. The container's TCP health probe checks process availability; the protected `/api/health` requires authentication.

| Role | Actions in the shared demo |
| --- | --- |
| Viewer | Inspect saved products, answers, sources, review history, and available exports |
| Reviewer | Viewer access plus source-checked answer decisions and comparison judgments |
| Operator | Reviewer access plus create products, generate synthetic answers, queue synthetic corrections, and load the comparison fixture |

Ablatrix attributes every hosted review and correction to a stable ID derived from the verified issuer and subject. Reviewers still explicitly check sources; authentication does not certify correctness. These roles apply to one shared invited workspace, not separate tenant workspaces. The configured Cloudflare sign-out link ends the gateway session.

Hosted mode fixes the provider to offline templates and source selection to the first five saved chunks. It is a workflow rehearsal, not the live hybrid retriever or a model benchmark. `mode: live`, legacy experiment routes, web investigation, and telemetry export are unavailable even if live environment flags are inherited. Existing explicitly enabled local Sapiom workflows remain separate. Paid hosted operation requires another reviewed execution slice.

## Rehearse one complete workflow

Use a fresh demo volume and an operator account:

1. In `/ask`, save a product titled **Synthetic travel bottle** with two sources: **Fixture manual** — “This synthetic travel bottle holds 600 ml. Hand wash the cap and body.”; **Fixture lid instructions** — “This synthetic bottle has a screw cap. Keep the bottle upright when carrying it.”
2. Ask **How much does the bottle hold, and how should I wash it?** and choose **Generate synthetic answer**. The answer and retrieval display synthetic labels; no model or embedding service is called.
3. Follow the saved answer into `/review`. Explain a concrete flaw, such as **Include the lid instructions and distinguish capacity from care advice**, and request a correction as the operator. The bounded background worker creates a separate immutable version; a reviewer can inspect another record while it runs.
4. Compare the original and revision with their frozen sources. A reviewer or operator selects the sources they actually checked and records accept or needs information. This records a human decision on synthetic output; it is excluded from live quality claims.
5. Export the workspace review history. Stop and restart the service, then verify the same answer/version/job identities and decision remain. Follow the backup/restore procedure below on this complete workspace.
6. Optionally open `/compare`, load the separate synthetic paired example as operator, and review its four anonymous answers as reviewer. Report and export stay unavailable until those judgments are complete. This packet is a separate controlled fixture, not a measured experiment on the bottle correction.

The template revision illustrates the asynchronous workflow by including more supplied context. It does not interpret arbitrary critique or demonstrate model learning. The local live provider remains the path for an independently authorized model-backed experiment.

## Runtime and storage

- The Docker base is pinned by digest. Build with `docker compose -f compose.demo.yaml build --build-arg BUILD_COMMIT="$(git rev-parse HEAD)" demo`. Configure the access file expected by that Compose file before starting the app.
- Start with `docker compose -f compose.demo.yaml up -d demo`.
- The `demo-data` volume is mounted at `/data`; `ABLATRIX_DATA_DIR` identifies this entire storage boundary. Databases, synthetic receipts, and the `demo.json` identity marker survive container replacement.
- Use the image entrypoint for the app and maintenance commands. It acquires an exclusive kernel `flock` on `/data/.runtime.lock`. A second app or maintenance command exits with code 75 while that directory is in use. App and maintenance startup verify both the inherited descriptor's identity and its actual exclusive lock; a separately opened descriptor naming the same inode cannot bypass an active owner.
- After acquiring that lock, the entrypoint removes only the two legacy PID lock files, `ablatrix.sqlite.lock` and `feedback-loop.sqlite.lock`. A stale container PID cannot prevent restart. The shared runtime lock remains held until the child exits, including while it handles a forwarded termination signal.
- Linux with util-linux `flock` and Node 24 is the supported runtime. Keep one replica. The lock and SQLite files require a local filesystem with working file locks; this is not a multi-host shared-volume deployment.

`docker compose stop` allows the app to drain before shutdown. If the stop deadline expires, the container can be killed. Existing durable receipts and recovery rules remain responsible for interrupted work; restart must not silently turn an uncertain attempt into a new provider dispatch.

## Back up the complete stopped workspace

Stop the app first. The backup command takes the same exclusive lock, so an app that is still running causes a clear failure instead of a partial snapshot.

```sh
mkdir -p backups
docker compose -f compose.demo.yaml stop demo
docker compose -f compose.demo.yaml run --rm --no-deps \
  -v "$PWD/backups:/backups" demo \
  node --import tsx scripts/demo-backup.ts backup \
  --destination /backups/demo-2026-10-09
docker compose -f compose.demo.yaml up -d demo
```

Choose a new destination name for each snapshot. The host backup directory must be writable by the container's `node` user (UID 1000); set suitable ownership on Linux. Store backups outside the data directory and copy them to durable storage according to your needs. The service does not schedule backups automatically.

Each snapshot is a directory containing `manifest.json` and `data/`. The command first copies every regular data file, including any remaining SQLite journals and WAL/SHM files, while omitting lock files. All app and worker connections must be closed: copying the ledgers together under one lock preserves their shared point in time. It then opens only the private copied databases for recovery and `PRAGMA integrity_check`, allowing SQLite to roll back a hot DELETE journal or checkpoint a WAL. The manifest hashes this normalized copy. Source ledgers and journals are never opened by maintenance SQLite checks or changed.

The manifest records file sizes and SHA-256 hashes, application and Node versions, SQLite schema hashes and `user_version`, and the optional `ABLATRIX_BUILD_COMMIT` revision. Hashes detect changes and corruption; they do not authenticate who created a backup. Treat snapshots as private workspace data. Keep access configuration and other operator secrets separately; they are not inside `/data` by default.

## Restore into an empty volume

Use a separate empty volume so the original workspace remains available. Do not merge restored ledgers into an existing workspace or replace one ledger independently of the others. Use the same application image/version initially; this tool does not migrate database schemas between releases.

```sh
docker volume create ablatrix-demo-restored
docker run --rm \
  -v ablatrix-demo-restored:/data \
  -v "$PWD/backups:/backups:ro" \
  ablatrix-demo:local \
  node --import tsx scripts/demo-backup.ts restore \
  --source /backups/demo-2026-10-09
```

The image initializes a new named volume with the `/data` ownership required by its `node` user. For a bind mount or an existing volume, arrange that ownership first. After successful restore, configure the app's data mount to use this restored volume, keep the original app stopped, and start a single app instance with the same access configuration. Check that saved answers, reviews, and pending work are present before accepting new activity.

Restore rejects a nonempty destination (apart from `.runtime.lock`), absolute/traversal paths, symbolic links, unexpected files, duplicate paths, hash mismatches, and failed SQLite integrity checks. It first verifies input hashes and validates and recovers databases in a private copy in the container's temporary directory, then installs that normalized copy into the empty target. Archive hashes describe the input snapshot; recovery may change physical SQLite files while preserving committed data. The temporary directory needs free space for the full snapshot; the Compose app's 32 MiB `/tmp` limit may require a larger maintenance-specific temporary mount for a large restore. The standalone restore command above uses the image's writable temporary directory.

Installation creates `.restore-in-progress` until all files have been copied and checked. If a process or host crashes during installation, this marker prevents app startup. Preserve the original snapshot, inspect the incomplete target, and restore into another empty volume. Do not remove the marker and start a partially restored workspace.

## Verification boundary

`server/demo-backup.test.ts` uses temporary data only. It checks all-ledger round trips, committed WAL recovery, hot DELETE-journal recovery without source changes, corrupt and unsafe snapshot rejection, and refusal to overwrite existing data. On Linux with `flock`, it also checks second-instance exclusion, forged descriptor rejection, actual lock acquisition, maintenance exclusion during termination/drain, forwarded signals, lock release, and child exit-code preservation. A skipped Linux test on macOS does not establish container behavior; run it inside the built image before release:

```sh
docker run --rm --entrypoint node ablatrix-demo:local \
  --import tsx --test server/demo-backup.test.ts
```

Run the complete container acceptance check from the repository root with Python 3 and Docker:

```sh
python3 scripts/verify-demo-container.py --image ablatrix-demo:local
# Add --context <your-local-context> if needed.
```

It creates and cleans up its own containers and volume, seeds a synthetic answer/revision/decision, checks competing-process and active-backup exclusion, kills and restarts the app, then backs up and restores into a fresh directory. It compares saved record identities and confirms exactly two synthetic receipts survive. The test does not touch existing demo volumes or call a model provider.

Passing these checks demonstrates the storage and runtime boundary. It does not mean an external host, identity gateway, DNS, or durable off-host backup destination has been provisioned.
