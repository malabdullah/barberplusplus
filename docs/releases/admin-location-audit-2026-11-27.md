# Admin location audit fix · production · 27 November 2026

Creating or deleting a governorate or area uses a numeric location ID. The audit service previously sent it to a UUID field and could lose the event. The website now writes that ID in audit metadata and reads it back in the audit views. The correction applies to new events.

| Verification | Evidence |
|---|---|
| Production source | `dd9ba1617f9872259fdf3932f52d38bb62531f30`, [release PR 188](https://github.com/malabdullah/barberplusplus/pull/188) |
| Signed build | [Workflow 45993257003, attempt 1](https://github.com/malabdullah/barberplusplus/actions/runs/45993257003) · [manifest and ordered migration hashes](https://github.com/malabdullah/barberplusplus/releases/tag/build-45993257003-1) |
| Frontend image | `ghcr.io/malabdullah/barberplusplus@sha256:2a3921a39a9639929d1e12efa0acc9099b5ad8f1f1bde2cf606c39d63aa0545d` |
| Backend archive SHA-256 | `818f7650271ebc86c6bee181c263eab224ff5770e4fe21fc5bef9e0c01ac74ff`. The release diff changed only the website Admin audit service. |
| Public production verification | HTTPS health returned OK, the runtime reported the release commit, and the served main JavaScript matched the checked build byte for byte. SHA-256 `c4d4ce178fa81810437116ea2c8fde87155da2f07376492d71e6bfe56541c07c`. |
| Functional verification | On hosted Test the same Admin created and deleted a disposable location. Both events carried the correct actor and matching location ID. Production verification was read-only. [Regression closure](../testing/runs/20261127T051710Z-all-roles/README.md) |
