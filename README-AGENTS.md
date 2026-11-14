# Masquerade: notes for coding agents

Use these notes to assess Masquerade and protect its guarantees. Human overview: [README](https://github.com/Kevinjohn/oss-adonisjs-masquerade#readme). Links work from `node_modules`.

## Fit check

- AdonisJS 7 on Node.js 24+ with SQLite or PostgreSQL; the host owns authentication, authorization,
  routes and user-facing error messages. Masquerade never creates a target login.

## Requirements

Core 7, Auth 10; Lucid 22.4.2+ for the Lucid store; Session 8.1+ for session auth. Optional: Bouncer 4,
Japa API client 3.2.1+ and Account Kit 0.3.4. Require `canMasquerade`; `canEdit` and `canUseRequest` are
optional.

## Install

```sh
pnpm add https://github.com/Kevinjohn/oss-adonisjs-masquerade/releases/download/v0.2.9/kevinjohn-adonisjs-masquerade-0.2.9.tgz
node ace configure @kevinjohn/adonisjs-masquerade --namespace=my_app --guard=web
```

## Integrate

Follow the [starter-kit recipe](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/docs/recipes/starter-kit.md)
for a new app: it lists every file to change, in order, with complete contents and a test. The
[recipe index](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/docs/recipes/index.md)
maps tasks to files. Read the [integration notes for agents](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/docs/guide/agents.md)
before editing an existing app.

## Capabilities

- Native sessions and opaque access tokens; Lucid store for SQLite and PostgreSQL.
- Account-wide time-limited modes, read-only by default, with explicit stop and audit events.

## Invariants: do not break these

1. Keep the operator authenticated; never log in as the target or issue target credentials.
2. Require `canMasquerade`; keep edits explicit, sensitive routes blocked and owner-bound context on unsafe requests.
3. Keep actor, effective user and audit fields distinct. Errors have stable codes and English messages.

## Testing an application

Use `@kevinjohn/adonisjs-masquerade/testing` and `@kevinjohn/adonisjs-masquerade/plugins/api_client`. See the [testing guide](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/docs/guide/testing.md).

## Source map

- `src/`: core service, policy, context token and errors; `auth/`, `http/`, `native/`: effective auth and controllers.
- `stores/`, `testing/`, `plugins/`: store and test support; `providers/`, `commands/`, `stubs/`: provider and configure templates.

## Further reading

- [Security model](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/docs/guide/security.md); [getting started](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/docs/guide/getting-started.md).
- [Technical contract](https://github.com/Kevinjohn/oss-adonisjs-masquerade/blob/main/docs/maintainers/design/spec-masquerade.md).

## Tested against

|                         | Every pull request | Weekly and before each release          |
| ----------------------- | ------------------ | --------------------------------------- |
| Node.js                 | 24                 | 24                                      |
| AdonisJS core           | locked version     | lowest supported (7.0.0) and latest 7.x |
| Lucid                   | locked version     | lowest supported and latest 22.x        |
| SQLite (better-sqlite3) | yes                | yes                                     |
| PostgreSQL 16           | yes                | yes                                     |
