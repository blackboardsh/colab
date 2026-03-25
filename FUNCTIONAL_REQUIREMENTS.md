# Functional Requirements — phenotype-config (colab)

## FR-CFG: Configuration Management

| ID | Requirement |
|----|-------------|
| FR-CFG-001 | System SHALL persist config entries as key-value pairs in SQLite |
| FR-CFG-002 | System SHALL support set, get, list, and delete operations on config entries |
| FR-CFG-003 | System SHALL record an audit trail entry for every config mutation |
| FR-CFG-004 | System SHALL support point-in-time restore of config state |

## FR-FLG: Feature Flags

| ID | Requirement |
|----|-------------|
| FR-FLG-001 | System SHALL support create, enable, disable, and delete operations on feature flags |
| FR-FLG-002 | System SHALL provide `is_enabled(name)` evaluation returning bool |
| FR-FLG-003 | System SHALL persist flag state with description metadata |
| FR-FLG-004 | System SHALL return default value (false) for unknown flag names |

## FR-SEC: Secrets Management

| ID | Requirement |
|----|-------------|
| FR-SEC-001 | System SHALL encrypt secret values using AES-256-GCM before storage |
| FR-SEC-002 | System SHALL derive encryption key from master password or environment variable |
| FR-SEC-003 | System SHALL support set and get operations on encrypted secrets |

## FR-VER: Version Tracking

| ID | Requirement |
|----|-------------|
| FR-VER-001 | System SHALL store and display version and rollout state metadata |
| FR-VER-002 | System SHALL provide `version show` command for inspection |

## FR-CLI: CLI and TUI

| ID | Requirement |
|----|-------------|
| FR-CLI-001 | System SHALL provide `phenoctl` binary with clap-based subcommands |
| FR-CLI-002 | System SHALL provide `phenoctl tui` launching ratatui interactive interface |
| FR-CLI-003 | System SHALL support config, flags, secrets, and version subcommand groups |

## FR-DB: Storage Layer

| ID | Requirement |
|----|-------------|
| FR-DB-001 | System SHALL use SQLite with auto-migration on startup |
| FR-DB-002 | System SHALL store database at `<repo>/.phenotype/config.db` by default |
| FR-DB-003 | System SHALL provide CRUD operations via store traits defined in pheno-core |
