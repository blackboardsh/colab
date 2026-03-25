# Implementation Plan — phenotype-config (colab)

## Phase 1: Core Types and Traits (Done)

| Task | Description | Depends On | Status |
|------|-------------|------------|--------|
| P1.1 | Define ConfigEntry, FeatureFlag, SecretEntry, VersionInfo types | — | Done |
| P1.2 | Define store traits (ConfigStore, FlagStore, SecretStore) | P1.1 | Done |
| P1.3 | Cargo workspace with pheno-core crate | — | Done |

## Phase 2: Storage Layer (Done)

| Task | Description | Depends On | Status |
|------|-------------|------------|--------|
| P2.1 | SQLite backend with rusqlite in pheno-db | P1.2 | Done |
| P2.2 | Auto-migration on startup | P2.1 | Done |
| P2.3 | Audit trail table and CRUD operations | P2.1 | Done |
| P2.4 | Point-in-time restore | P2.3 | Done |

## Phase 3: Cryptography (Done)

| Task | Description | Depends On | Status |
|------|-------------|------------|--------|
| P3.1 | AES-256-GCM encryption in pheno-crypto | P1.1 | Done |
| P3.2 | Key derivation from password/env var | P3.1 | Done |
| P3.3 | Encrypt/decrypt integration with secret store | P3.1, P2.1 | Done |

## Phase 4: CLI and TUI (Done)

| Task | Description | Depends On | Status |
|------|-------------|------------|--------|
| P4.1 | phenoctl binary with clap subcommands | P2.1, P3.1 | Done |
| P4.2 | Config, flags, secrets, version subcommands | P4.1 | Done |
| P4.3 | Ratatui TUI mode | P4.1 | Done |
