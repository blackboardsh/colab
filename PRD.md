# Product Requirements Document — phenotype-config (colab)

## E1: Configuration Management

### E1.1: Config CRUD
As a developer, I want to set, get, list, and delete configuration entries so that I can manage app settings locally.

**Acceptance Criteria:**
- `phenoctl config set <key> <value>` persists to SQLite
- `phenoctl config get <key>` retrieves current value
- `phenoctl config list` shows all entries with metadata
- `phenoctl config delete <key>` removes entry with audit trail

### E1.2: Point-in-Time Restore
As a developer, I want to restore configuration to a previous state so that I can recover from bad changes.

**Acceptance Criteria:**
- Audit trail records all mutations with timestamps
- Restore command rolls back to specified timestamp

---

## E2: Feature Flag Lifecycle

### E2.1: Flag CRUD
As a developer, I want to create, enable, disable, and delete feature flags so that I can control feature rollouts locally.

**Acceptance Criteria:**
- `phenoctl flags create <name> --description <desc>` creates flag
- `phenoctl flags enable/disable <name>` toggles state
- `phenoctl flags list` shows all flags with status

### E2.2: Flag Evaluation
As an application, I want to evaluate feature flags programmatically so that code paths can be gated.

**Acceptance Criteria:**
- Core trait provides `is_enabled(flag_name) -> bool`
- Default value returned for unknown flags

---

## E3: Secrets Management

### E3.1: Encrypted Secret Storage
As a developer, I want to store secrets with encryption so that sensitive values are protected at rest.

**Acceptance Criteria:**
- `phenoctl secrets set <key>` prompts for value and encrypts with AES-256-GCM
- `phenoctl secrets get <key>` decrypts and displays
- Encryption key derived from master password or environment variable

---

## E4: Version Tracking

### E4.1: Version Inspection
As a developer, I want to inspect version and rollout state so that I can verify deployment status.

**Acceptance Criteria:**
- `phenoctl version show` displays current version info
- Version info tracks rollout state metadata

---

## E5: Terminal UI

### E5.1: Interactive TUI
As a developer, I want a terminal UI for operational workflows so that I can manage config/flags/secrets visually.

**Acceptance Criteria:**
- `phenoctl tui` launches ratatui-based interface
- TUI provides navigation across config, flags, secrets, and versions
