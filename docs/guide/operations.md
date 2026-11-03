# Pruning, retention and active modes

The [API entry-point map](../reference/README.md#supported-package-imports) links the command loader
under `adonisjs-masquerade/commands` and Lucid store lifecycle and schema exports under the optional
`adonisjs-masquerade/stores/lucid` entry point.

Masquerade does not start a background worker. Schedule `masquerade:prune` with the host
application's existing scheduler so expired modes and retained audit events are processed over
time.

## What one pass does

Run the Ace command with an optional `--batch-size` number:

```sh
node ace masquerade:prune --batch-size=100
```

The default batch size is `100`; the accepted range is `1` through `1000`. If omitted, the command
uses the default. The batch size limits each kind of work in one invocation: at most that many
expired-mode candidates are examined, and, when event retention is configured, at most that many
old events are deleted. A pass does not keep fetching batches until all eligible work is gone.
Concurrent changes can also make an expiry candidate ineligible before it is updated.

Expired modes are checked during every pass, regardless of event-retention mode. The command
re-reads each candidate and uses a conditional transition, so it will not clear a newer mode. A
business request still enforces expiry when it admits a request; pruning is housekeeping, not the
expiry boundary.

## Schedule recurring work

For example, a host using cron could run a pass every 15 minutes:

```text
*/15 * * * * cd /srv/my-app && /usr/bin/node ace masquerade:prune --batch-size=100
```

This is an example only. Adjust the working directory, Node path, cadence and batch size for the
deployment. Use the host's scheduler to prevent overlapping runs, or choose an interval longer than
the command's normal run time. Start with a modest batch, then adjust based on the database's
available capacity, write load, number of expired modes and event volume. A larger batch can reduce
the time needed to catch up while increasing work per invocation; a shorter interval gives the
store more frequent opportunities to make progress.

The command writes a log line such as `Expired 12 mode(s); deleted 100 event(s).` Use those counts
to follow work completed by each run. If event deletions repeatedly reach the configured batch
size, or expiry work stays near the limit, review the host's database for eligible work and consider
increasing capacity or running passes more often. The package does not expose a backlog query or
backlog metric; any database monitoring or alerting is host-owned.

## Event retention and store scope

Configure one of these retention modes:

- `retention: { days: n }` deletes audit events older than `n` days, subject to the per-pass batch
  limit.
- `retention: 'host-managed'` leaves event deletion to the host. Pruning still expires due modes.

One retention setting applies to all validated namespaces visible through the supplied store. The
prune command is global to that store; it does not restrict cleanup to the authority namespace in
the current Masquerade configuration. Give identity domains that need different event-retention
policies separately scoped stores.

Idle owner rows are retained, including rows for owners with no active mode. They preserve the
revision and nonce needed to keep earlier context tokens stale; pruning never deletes them.

## Erase an owner's mode row

Owner erasure is a host-operated SQL task, not a package API. To remove a retired account
incarnation's mode row, bind the namespace, actor ID and incarnation as query parameters:

```sql
DELETE FROM masquerade_modes
WHERE authority_namespace = ?
  AND actor_id = ?
  AND actor_incarnation = ?;
```

The `?` markers are placeholders, not values to replace in the SQL string. Bind the three values
through the database driver's parameter API; placeholder syntax differs by driver. Before execution,
verify the table, column and parameter syntax against the installed schema and database. Apply the
host's event-retention or erasure policy to matching audit events separately. Do not delete idle
owner rows as routine pruning.

## See and end active modes

`masquerade:status` lists the active modes visible through the configured store: namespace,
operator ID and incarnation, target, access level and deadline. The start reason stays in the
audit ledger and is not printed.

```sh
node ace masquerade:status --limit=50
```

`masquerade:stop` ends a mode from the server, for example after a mistaken start or when an
operator account may be compromised:

```sh
node ace masquerade:stop --actor=42
node ace masquerade:stop --all
```

- `--actor` ends that operator's mode in the configured namespace. The incarnation comes from the
  authority (`incarnation: 'id'` uses the ID). For a deleted or reused account, pass
  `--incarnation` with the value `masquerade:status` prints.
- `--all` asks for confirmation; pass `--force` in scripts. It processes active modes in batches
  until none are left or a batch makes no progress.
- Each stop re-reads the row and uses a conditional transition, and writes one `invalidated`
  event with the outcome code `operator_stopped`. If the operator stops the mode at the same time,
  one transition wins and one event is written. A mode already past its deadline is recorded as
  `expired`, as prune records it, and is not counted as stopped. Security stamps are not read.
- The operator's next request sees no active mode and must use the new context token. The command
  does not sign anyone out; to revoke the operator's sessions, advance their security stamp and
  use the host's own session controls.
