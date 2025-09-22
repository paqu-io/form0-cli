# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Code Formatting
- **Format code**: `npm run format` - Format all files with Prettier
- **Check formatting**: `npm run format:check` - Check if files are properly formatted

### Localization
- **Upload translations**: `npm run localazy:upload` - Upload source strings to Localazy
- **Download translations**: `npm run localazy:download` - Download translated strings

### Testing
The project uses a custom test runner approach instead of traditional test frameworks:
- **Run tests**: `form0 test [dir]` - Executes test.js files in project directories
- Tests are typically named `test.js` and use the form0-core engine for validation

## form0 Ecosystem
This project, `form0-cli`, is a command-line interface (CLI) tool for `form0-core`, a form engine. It allows developers to create, validate, test, and preview form schemas from the command line. The CLI can be used in two modes: as a set of standalone commands or as an interactive shell.

`form0-core` serves as the core engine for:

- **form0-cli**: Command-line tools that use the core engine for form schema validation, testing, and development workflows
- **form0-react**: React components and hooks that wrap the core engine to provide seamless integration with React applications
- **form0-react-native**: React Native components that leverage the core engine for mobile form experiences

### Role in reform SaaS
`form0-core` is the underlying engine that powers **reform**, a commercial SaaS product. While form0 is open-source and framework-agnostic, reform builds upon this foundation to provide a complete form management solution with additional enterprise features, hosting, and support.

## Architecture Overview
form0-cli's architecture follows a modular command pattern with an interactive shell environment.

### Key Components
**CLI Entry Point** (`bin/form0.js`):
- Uses Commander.js for command parsing
- Auto-detects interactive mode when no arguments provided
- Loads global configuration on startup

**Interactive Environment** (`src/commands/interactive.js`):
- Orchestrates SchemaManager, EngineRunner, and FileWatcher
- Provides tab completion and command history
- Supports real-time schema reloading

**Core Managers**:
- **SchemaManager** (`src/commands/interactive/managers/schema-manager.js`) - Schema loading and validation
- **EngineRunner** (`src/commands/interactive/runners/engine-runner.js`) - Form engine execution
- **FileWatcher** (`src/commands/interactive/file-watcher.js`) - Auto-reload functionality
- **ServerManager** (`src/commands/interactive/managers/server-manager.js`) - Development server management

**Development Server** (`src/server/express-server.js`):
- Express.js server with live form preview
- WebSocket support for real-time updates
- Static file serving for form renderer
- API endpoints for schema validation and engine execution

### Configuration System
- **Global config**: Stored in `~/.form0-cli/config.json`
- **Settings**: Theme (dark/light), locale (auto/en/es/fr/it)
- **Theme system**: Dynamic terminal color schemes
- **i18n**: Multi-language support with auto-detection

### Connector System
The CLI includes a connector system that allows form submissions to be persisted to external data stores beyond just console output:

- **Connector Management** (`src/commands/connector.js`) - CLI command for installing and configuring connectors
- **ConnectorManager** (`src/commands/interactive/managers/connector-manager.js`) - Manages connector lifecycle in interactive mode
- **Connector Configuration** - Stores connector configs in `~/.form0-cli/connectors/` directory
- **Supported Connectors**:
  - **form0-connector-pg**: PostgreSQL database connector for storing form records
  - Future connectors planned: Google Sheets (form0-connector-gsheet), etc.

When a connector is configured and active, form submissions are automatically sent to the configured data store in addition to displaying the JSON output in the browser console.

### Form Schema Workflow
1. **Initialize**: `form0 init [dir]` creates sample schema and test files
2. **Load**: Schema files are loaded and validated using form0-core
3. **Preview**: Tree-structured display with color-coded field types
4. **Execute**: Engine runs with optional test values (JSON/YAML)
5. **Watch**: Auto-reload and re-execute on file changes

### Dependencies
- **form0-core**: Core form engine (peer dependency)
- **commander**: CLI argument parsing
- **express**: Development server
- **chokidar**: File watching
- **ws**: WebSocket support
- **chalk**: Terminal colors
- **yaml**: YAML file parsing

### Interactive Commands
The interactive shell supports these commands:
- Schema: `init`, `load`, `preview`, `validate`, `reload`
- Engine: `run`, `watch`, `values`, `fields`
- Server: `serve`, `stop-serve`
- Connector: `connector` - Install and configure data persistence connectors
- Session: `status`, `clear`, `help`, `exit`

### Development Server Features
- Live form preview at `http://localhost:3030`
- Real-time schema updates via WebSocket
- API endpoints for engine state and record creation
- Static asset serving from project directories
- UUID generation for media fields and records

### Value Handling
- Supports JSON strings, .json files, and .yaml/.yml files
- Automatic field name validation against schema
- Value persistence across interactive sessions
- Smart filtering of invalid fields with warnings

### File Structure Patterns
- Commands in `src/commands/` with dedicated interactive subdirectory
- Utilities in `src/utils/` for reusable functionality
- Server components in `src/server/` for development environment
- Form templates in `src/form0-forms/` for project initialization
- Localization files in `src/locales/` for i18n support

---

<!-- END UPDATABLE SECTIONS - /check-docs command updates sections above this line -->

## MCP Memory

**TL;DR**: Log engineering decisions as one-line facts. Search before proposing changes, write after making decisions.

Use the MCP Memory server as an ENGINEERING KNOWLEDGE LOG (not source code).

### When to read (and show your work)
- Before proposing or changing implementation in the current scope:
  1) search memory for that scope,
  2) print a one-line banner:
     🔎 Memory[<scope>] hits=<n>, last=<YYYY-MM-DD>, note: partial store
  3) if hits exist, show a 3–6 bullet "Prior decisions & constraints" digest (one-liners).

### When to write
- After we converge on a choice, finish a spike/fix, capture a trade-off, or log a blocking TODO/open question.
- De-dupe first (search by scope + similar text). If superseded, add a new DECISION and mark the older via OUTCOME [deprecated] with a ref.

### What to store (one-line facts, examples)
- **DECISION**: [DECISION] [scope:form0-cli] [date:2025-01-22] Use Commander.js for CLI argument parsing over custom implementation [refs:package.json]
- **CONSTRAINT**: [CONSTRAINT] [scope:form0-cli] [date:2025-01-22] Development server runs on port 3030 by default [refs:src/server/express-server.js]
- **APPROACH**: [APPROACH] [scope:form0-cli] [date:2025-01-22] Interactive mode auto-detects when no CLI arguments provided [refs:bin/form0.js]
- **RATIONALE**: [RATIONALE] [scope:form0-cli] [date:2025-01-22] WebSocket enables real-time schema updates without page refresh
- **OUTCOME**: [OUTCOME] [scope:form0-cli] [date:2025-01-22] Connector system successfully abstracts data persistence layer
- **TODO**: [TODO] [scope:form0-cli] [date:2025-01-22] Add Google Sheets connector (form0-connector-gsheet)
- **OPEN_QUESTION**: [OPEN_QUESTION] [scope:form0-cli] [date:2025-01-22] Should file watching include nested subdirectories by default?

### Format
```
[TAG] [scope:<repo|package|feature>] [date:YYYY-MM-DD] <concise statement> [refs:<issue|PR|commit|doc>] [prov:<session|author>]
```
Keep atomic and short (<200 chars). No secrets; no large code/logs (link via refs).

### Common Pitfalls
- Don't log implementation details (log decisions instead)
- Don't duplicate information already in ADRs/README
- Search first to avoid duplicates
- Focus on "why" not "what" for decisions

### Incompletness and backfill
- memory.json may be incomplete. Treat it as a working set, not the source of truth.
- If you infer a stable fact (e.g., from ADRs/README/code) that's missing, propose adding a matching one-line note (DECISION/CONSTRAINT/APPROACH).
- When a suggestion might conflict with unstored history, say: "Memory may be incomplete; verify with ADR/docs" and offer to backfill.

### Scoping and entities
- Default scope = current repo or top-level folder; narrow to package/feature if obvious (e.g., form0-core, form0-react).
- Attach observations to Entities like Project, Package/Service, Feature, DecisionTopic. Use active relations when useful.

### Provenance (optional)
- If available, add lightweight provenance in the note's bracket, e.g. [prov:session=<id>] or [prov:author=claude-code].
- Do NOT rely on provenance for retrieval/ranking; it's for traceability only and can be omitted.

### Hygiene
- ISO dates; single-line bullets; avoid duplicates.
- Prefer updating facts over adding near-duplicates.
