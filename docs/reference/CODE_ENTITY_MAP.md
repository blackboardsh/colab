# Code Entity Map — phenotype-config (colab)

## Forward Map (Code -> Requirements)

| Entity | Type | FRs |
|--------|------|-----|
| `pheno-core/` | Core types and traits | FR-CFG-001, FR-FLG-002, FR-FLG-004, FR-VER-001, FR-DB-003 |
| `pheno-db/` | SQLite storage backend | FR-CFG-001..004, FR-FLG-001, FR-FLG-003, FR-DB-001..003 |
| `pheno-crypto/` | AES-256-GCM encryption | FR-SEC-001..002 |
| `pheno-cli/` | CLI binary (phenoctl) | FR-CLI-001..003, FR-SEC-003, FR-VER-002 |

## Reverse Map (Requirements -> Code)

| FR ID | Code Entities |
|-------|---------------|
| FR-CFG-001..004 | `pheno-core/` (types), `pheno-db/` (persistence, audit, restore) |
| FR-FLG-001..004 | `pheno-core/` (trait, evaluation), `pheno-db/` (persistence), `pheno-cli/` (commands) |
| FR-SEC-001..003 | `pheno-crypto/` (encryption), `pheno-cli/` (set/get commands) |
| FR-VER-001..002 | `pheno-core/` (VersionInfo type), `pheno-db/` (storage), `pheno-cli/` (show command) |
| FR-CLI-001..003 | `pheno-cli/` (clap, ratatui, subcommands) |
| FR-DB-001..003 | `pheno-db/` (SQLite, migration, CRUD) |
