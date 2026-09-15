# form0-cli

[![NPM Version](https://img.shields.io/npm/v/form0-cli)](https://www.npmjs.com/package/form0-cli)
[![NPM Downloads](https://img.shields.io/npm/dm/form0-cli)](https://www.npmjs.com/package/form0-cli)
[![CI](https://github.com/paqu-io/form0-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/paqu-io/form0-cli/actions/workflows/ci.yml)
![NPM License](https://img.shields.io/npm/l/form0-cli)
[![Docs](https://img.shields.io/badge/docs-docs.form0.dev-2563eb)](https://docs.form0.dev)
[![Website](https://img.shields.io/badge/site-form0.dev-0f172a)](https://form0.dev)
![NPM Last Update](https://img.shields.io/npm/last-update/form0-cli)
[![Socket](https://socket.dev/api/badge/npm/package/form0-cli)](https://socket.dev/npm/package/form0-cli)

> [!NOTE]
> form0 is in active development and is available to use today. Its schema format and core
> concepts are stable in practice, but releases before 1.0 may include breaking changes. Pin your
> versions and review the release notes when upgrading. A formally stable release is coming.

`form0-cli` is the canonical entry point for the [form0 open-source ecosystem](https://form0.dev).
It is an interactive command-line toolkit for creating projects and building, validating,
previewing, testing, and serving form schemas locally.

## 📦 Installation

Install the CLI globally to get the `form0` command:

```bash
npm install -g form0-cli
```

Or run without a global install:

```bash
npx form0-cli
```

Requires Node.js 22.19.0 or newer.

## 🚀 Quickstart

1. Start the interactive shell:

   ```bash
   form0
   ```

1. Initialize a standard project:
   - Run `init`
   - Choose **Standard project**
   - Let the CLI auto-load your schema (if it is the only schema in the project root)

1. Start the dev server:

   ```ansi
   form0> serve
   ```

1. Open the live preview at `http://localhost:3030` (or the port printed in the terminal).

What you get in a Standard project:

- `form.schema.json` with a starter form
- `form0.config.js` for CLI settings
- `test.js` for local engine checks
- `supporting-images/` for field assets
- `package.json` and `README.md` scaffolding

## Edit your first schema

This workflow assumes the dev server is running (`serve`) and the live preview is open.

1. Enter schema edit mode:

   ```ansi
   form0(server)> schema edit
   ```

   > Editor required: set `EDITOR` or `VISUAL` (for example, `export EDITOR=code`).

1. Preview the schema:

   ```ansi
   form0(server,schema)> preview
   ```

1. Add a NumericField after a field by row id:

   ```ansi
   form0(server,schema)> add NumericField after <id>
   ```

   Example template:

   ```json
   {
     "data_name": "quantity",
     "label": "Quantity",
     "min": 1,
     "max": 100,
     "format": "integer"
   }
   ```

1. Add a CalculatedField after the new field:

   ```ansi
   form0(server,schema)> add CalculatedField after <new-id>
   ```

   Example template:

   ```json
   {
     "data_name": "total",
     "label": "Total",
     "display": { "style": "numeric" },
     "calculate": "$quantity * 2"
   }
   ```

1. Save and close your editor. The schema is saved and validated automatically.

1. Exit schema edit mode:

   ```ansi
   form0(server,schema)> q
   ```

   Stop the dev server:

   ```ansi
   form0(server)> serve stop
   ```

## Command reference summary

## AI authoring (preview)

Start directly with `form0 ai [schema]`, or enter `ai` from the interactive shell. AI composes with
the live server, so `serve` followed by `ai` produces a `form0(server,ai)>` prompt and broadcasts
validated drafts to the browser without saving them.

The selected provider receives the complete form schema and installed form0 authoring catalog.
Every change is a transient semantic mutation batch: inspect it with `/preview` or `/diff`, then use
`/apply` or `/discard`. Writes require explicit approval, are atomic, and are rejected if the schema
changed on disk. `/undo` stages the last saved version for approval.

Provider authentication and per-schema conversations are stored under `~/.form0-cli/ai/`, not in
projects or schemas. Pi exposes its provider catalog; the preview baseline covers OpenAI API keys and
Codex OAuth, Anthropic API keys and Claude OAuth, Gemini API keys, OpenRouter key/OAuth, and local
Ollama models. Environment credentials remain supported. Use `/providers`, `/login`, `/model`, and
`/privacy` inside AI mode. `/status` shows the selected provider and model, locally configured
authentication sources, draft state, schema path, cloud policy, and conversation persistence without
contacting a provider. Use `/model` without an argument to show the current model.

The selected model is part of the per-schema Pi conversation and is restored when AI mode is
re-entered. `/new` and `/clear` keep the current model for the new conversation. If that model is no
longer available or authenticated, the CLI shows Pi's fallback warning instead of silently changing
it.

While a request is running, the CLI displays `[AI] Thinking with <provider>/<model>…` and changes the
prompt to `form0(ai,busy)>` (or `form0(server,ai,busy)>`). Natural-language input entered while busy
is queued in order as follow-up requests; an empty Enter only redraws the prompt. `/help`, `/status`,
`/privacy`, and `/cancel` remain available. `/cancel` stops the active request and clears queued
follow-ups; other commands are unavailable until processing has finished.

`ai.allowCloud: false` on the form or any field blocks cloud models with no CLI override. Any
`requiresConsent: true` asks before the first cloud request and after switching cloud providers.
Otherwise provider selection counts as consent after the CLI states that the full schema is sent.

The agent may read relevant Markdown from `https://docs.form0.dev`, beginning at `llms.txt`; fetched
text is untrusted supplementary guidance and installed core catalogs win on conflicts. There is no
filesystem, shell, arbitrary web, extension, skill, MCP, image, or record-data access. Forms that do
not fit completely in the selected model context are refused rather than truncated. Calculations and
events are checked by form0-core before approval, but generated JavaScript still deserves review.

### Interactive shell (`form0`)

- `init [dir]` - Initialize a project (Standard/Web/Mobile)
- `load` / `load <file>` - Interactive load or load a specific schema file
- `preview` - Show the schema summary
- `validate` - Validate the current schema
- `run [--values <input>]` - Run the engine with optional values
- `watch [--auto-run] [--auto-validate]` - Watch schema changes
- `serve [--app] [--port] [--host]` - Start live preview; `--app` runs the app dev server from `form0.config.js`
- `schema edit` - Open the schema editor
- `ai` - Enter preview AI authoring mode
- `schema import <csv> [--force]` / `schema export [csv] [--force]` - Convert JSON ↔ CSV
- `schema convert formio <json> [options]` - **Preview:** Convert an exported Form.io form schema to form0
- `schema keys` - Generate missing field keys
- `test [dir]` - Run the test.js file in a project
- `connector <action>` - Manage connectors (install/configure/test/reload/status/remove/uninstall/list)
- `values` / `fields` - Show stored values or valid field names
- `reload` - Reload the current schema file
- `status` - Show the current session status
- `clear` / `clear values` - Clear screen or stored values
- `theme [name]` / `locale [name]` - View or change theme/locale
- `help` / `exit` - Help or quit

### Standalone commands

```bash
form0 init [dir]
form0 validate <schema>
form0 preview <schema>
form0 run <schema> --values <json|string|file>
form0 watch [schema] --auto-run --auto-validate
form0 serve [schema] --port 3030 --host localhost --app
form0 schema import <csv> [-o <json>] [-f]
form0 schema export [csv] [-i <json>] [-f]
form0 schema convert formio <json> [-o <json>] [--report <json>] [--dry-run] [--allow-lossy] [-f]
form0 test [dir]
form0 connector <action> [name]
form0 theme [name]
form0 locale [name]
form0 interactive   # or: form0 shell
form0 ai [schema]   # preview AI authoring
```

## Working with values

`form0-cli` accepts JSON strings or files for `--values`:

```bash
form0 run form.schema.json --values '{"name":"Alice","age":25}'
form0 run form.schema.json --values values.json
form0 run form.schema.json --values values.yaml
```

Invalid fields are filtered out with warnings based on the schema.

## ✅ Requirements

- Node.js 22.19.0+

## 📚 Documentation

- [CLI overview](https://docs.form0.dev/cli/overview)
- [Initialize a project](https://docs.form0.dev/cli/initialize-project)
- [Interactive shell](https://docs.form0.dev/cli/interactive-shell)
- [Command reference](https://docs.form0.dev/cli/command-reference)
- [Quickstart](https://docs.form0.dev/getting-started/quickstart)
- [Full documentation](https://docs.form0.dev)

## 🔒 Security

The preview server is a local development tool: it loads configured connector modules and executes
schema behavior. Use trusted projects and connectors. It binds to `localhost` by default; if you use
`--host` to expose it to another interface, only do so on a trusted network.

Do not report suspected vulnerabilities through public issues. See
[SECURITY.md](./SECURITY.md) for private reporting instructions.

## 🔗 Related repositories

- [form0-core](https://github.com/paqu-io/form0-core) - Core form engine
- [form0-react](https://github.com/paqu-io/form0-react) - React components
- [form0-react-native](https://github.com/paqu-io/form0-react-native) - React Native components

## 🤝 Support and contributing

See [SUPPORT.md](https://github.com/paqu-io/form0-cli/blob/main/SUPPORT.md) for help and
[CONTRIBUTING.md](https://github.com/paqu-io/form0-cli/blob/main/CONTRIBUTING.md) to contribute.

## 📄 License

[MIT](./LICENSE)
