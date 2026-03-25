# Architecture Decision Records — phenotype-config (colab)

## ADR-001 | Rust Workspace with Crate Decomposition | Adopted

**Status:** Adopted

**Context:** The SDK needs clear separation between core types, storage, cryptography, and CLI concerns to allow independent evolution and testing.

**Decision:** Use a Cargo workspace with four crates: `pheno-core` (types and traits), `pheno-db` (SQLite storage), `pheno-crypto` (AES-256-GCM encryption), and `pheno-cli` (CLI binary).

**Consequences:**
- Each crate compiles and tests independently
- Core traits define storage interface without coupling to SQLite
- Crypto crate can be swapped or upgraded without touching storage logic

---

## ADR-002 | SQLite for Local-First Storage | Adopted

**Status:** Adopted

**Context:** Configuration data must persist locally without requiring a network database, supporting single-user developer workflows.

**Decision:** Use SQLite via `rusqlite` with auto-migration on startup. Database file stored at `<repo>/.phenotype/config.db`.

**Consequences:**
- Zero infrastructure dependency; single file database
- Auto-migration ensures schema stays current across versions
- Audit trail stored in same database for transactional consistency

---

## ADR-003 | AES-256-GCM for Secrets Encryption | Adopted

**Status:** Adopted

**Context:** Secret values must be encrypted at rest in the local SQLite database.

**Decision:** Use AES-256-GCM via the `aes-gcm` crate with key derivation from a master password or environment variable.

**Consequences:**
- Authenticated encryption prevents tampering
- Standard algorithm with well-audited Rust implementation
- Key management responsibility falls on the user (password or env var)

---

## ADR-004 | Clap CLI with Ratatui TUI | Adopted

**Status:** Adopted

**Context:** Developers need both scriptable CLI commands and an interactive visual interface for managing configuration.

**Decision:** Use `clap` for CLI argument parsing (`phenoctl` subcommands) and `ratatui` for the optional TUI mode.

**Consequences:**
- CLI supports automation and scripting in CI/CD pipelines
- TUI provides discoverable interface for interactive workflows
- Both interfaces share the same core service layer
