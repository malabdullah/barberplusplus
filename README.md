# Barber++

Barber++ is a bilingual shop-booking and management product with a React/Vite
website, shared Supabase backend, and separate native iOS and Android customer
applications. Customers, managers, barbers, agents, Admin and Super Admin have
different permissions; the native apps do not implement every staff website role.

**New maintainer or replacement agent: start with [the handoff guide](docs/handoff.md).**
Read [AGENTS.md](AGENTS.md) before acting. [PRD.md](PRD.md) distinguishes recorded
production features, Test-only pilots, planned work and retired functionality.
The [documentation index](docs/README.md) separates maintained instructions from
historical contracts and release preparation records.

## Environments

| Environment | Frontend/backend | Use |
|---|---|---|
| Hosted Test — default | https://barber-test.alabdullah-cs.workers.dev; isolated Supabase project `qvkucvcjmojjbphlzlks` | Synthetic accounts/data, controlled inbox, approved sandbox integrations |
| Production | Dokploy frontend and a separate self-hosted Supabase backend | Real customer service; separate release authorization |
| Local Test — explicit owner request only | Owned local Docker/Supabase/Vite profile | Never start, reset or substitute for hosted Test by default |

There is no permanent staging environment or semantic-tag promotion dependency.
A push or successful build is not proof of a Test deployment. A main merge can
start production delivery: inspect the workflow and authorization before merging.

## Read before development

1. [Handoff and current-state verification](docs/handoff.md).
2. [Working instructions](AGENTS.md) and [product requirements/status](PRD.md).
3. [Architecture and contract map](docs/architecture.md).
4. [Hosted Test](docs/cloud-test.md), [environments](docs/environments.md),
   [releases](docs/deployment-runbook.md) and [recovery](docs/backup-restore.md).
5. [PR documentation policy](docs/documentation-policy.md).

Use the Node version pinned by `package.json` and CI. `npm ci` installs locked
dependencies; `npm run check` runs the maintained local checks and frontend build.
Commands, credentials and targets vary by checkout: read the scripts before use.
The [handoff guide](docs/handoff.md) explains safe intake before running anything.
Do not start `npm run dev`, `preview`, `local:setup` or `local:start` merely to
read the project. Local builds/unit checks remain appropriate to authorized work.

Application code lives in `src/`; migrations and Functions are in `supabase/`;
hosted Test support is in `ops/cloud-test/`; production release tooling is in
`ops/release/`. Website tokens/translations live in `src/styles/index.css` and
`src/i18n/`. Native code/design instructions belong to their separate repositories.

## Testing and portability

Run affected checks and hosted Test verification for ordinary changes. The
[full regression plan](docs/testing/full-regression.md) runs **only on an explicit
owner request**; creating a plan, opening a PR or reading this guide does not run
it. Existing required PR CI is distinct from that manual campaign.

[Portable workflow instructions](docs/agent-portability.md) and versioned skill
copies let a new agent follow delivery/testing rules without this computer's
personal skill installation. No chat history is needed for the documented rules;
operational access still requires the owner/coordinator's approved private handoff.
Never commit credentials, customer data, private release inventories or raw sessions.

## Repositories

- Website/shared backend: [barberplusplus](https://github.com/malabdullah/barberplusplus).
- iOS customer app: [barberplusplus-ios](https://github.com/malabdullah/barberplusplus-ios) — private, requires owner-granted access.
- Android customer app: [barberplusplus-android](https://github.com/malabdullah/barberplusplus-android) — private, requires owner-granted access.

Native work and cross-platform requests go through Apps Manager. Do not infer
native activation or app-store availability from a website or backend deployment.

## License

MIT. See repository licensing and asset ownership before redistributing assets.
