# form0-cli

[![NPM Version](https://img.shields.io/npm/v/form0-cli)](https://www.npmjs.com/package/form0-cli)
[![NPM Downloads](https://img.shields.io/npm/dt/form0-cli)](https://www.npmjs.com/package/form0-cli)
![NPM License](https://img.shields.io/npm/l/form0-cli)
[![Docs](https://img.shields.io/badge/docs-docs.form0.dev-2563eb)](https://docs.form0.dev)
[![Website](https://img.shields.io/badge/site-form0.dev-0f172a)](https://form0.dev)
![NPM Last Update](https://img.shields.io/npm/last-update/form0-cli)

> [!WARNING]
> form0 is in active, very early development. Do not use in production. Expect breaking
> changes and unstable behavior.

form0-cli is the interactive command-line toolkit for building, validating, previewing, and
serving schemas in the [form0 open-source ecosystem](https://form0.dev). It powers the local development workflow for form0 projects.

## 🗂️ Documentation

- Quickstart: https://docs.form0.dev/getting-started/quickstart
- Edit your first schema: https://docs.form0.dev/getting-started/schema-edit
- Full docs: https://docs.form0.dev

## ⚙️ Installation

Install the CLI globally to get the `form0` command:

```bash
npm install -g form0-cli
```

Or run without a global install:

```bash
npx form0-cli
```

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

## ✏️ Edit your first schema

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

### Interactive shell (`form0`)

- `init [dir]` - Initialize a project (Standard/Web/Mobile)
- `load` / `load <file>` - Interactive load or load a specific schema file
- `preview` - Show the schema summary
- `validate` - Validate the current schema
- `run [--values <input>]` - Run the engine with optional values
- `watch [--auto-run] [--auto-validate]` - Watch schema changes
- `serve [--app] [--port] [--host]` - Start live preview; `--app` runs the app dev server from `form0.config.js`
- `schema edit` - Open the schema editor
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
```

## Converting Form.io schemas

> **Preview feature:** Form.io conversion is under active development. Review the conversion
> report and validate the generated schema before using it. Behavior may change in future releases.

Convert a local exported Form.io form JSON file into a validated form0 schema:

```bash
form0 schema convert formio formio-form.json -o form.schema.json
form0 schema convert formio formio-form.json --dry-run --report conversion-report.json
```

Conversion is strict by default. Unsupported data components, custom validation, and calculations
outside the safe supported subset prevent schema output. Use `--allow-lossy` to explicitly permit
documented omissions and blank calculated-field placeholders. The converter reads form schemas
only; it does not fetch remote forms or convert submissions.

Form.io Wizard pages become drilldown Sections. Panels and Fieldsets become nested Sections, and
Collapsible components become drilldown Sections. Selectboxes member references such as
`data.features.fastMode` are translated to MultiChoice membership checks.

The interactive shell accepts the same options and automatically loads a successfully written
schema.

## Working with values

form0-cli accepts JSON strings or files for `--values`:

```bash
form0 run form.schema.json --values '{"name":"Alice","age":25}'
form0 run form.schema.json --values values.json
form0 run form.schema.json --values values.yaml
```

Invalid fields are filtered out with warnings based on the schema.

## Requirements

- Node.js 18+

## Related repositories

- [form0-core](https://github.com/paqu-io/form0-core) - Core form engine
- [form0-react](https://github.com/paqu-io/form0-react) - React components
- [form0-react-native](https://github.com/paqu-io/form0-react-native) - React Native components

## Contributing

Contributions are welcome! Please feel free to submit [issues](https://github.com/paqu-io/form0-cli/issues) and [pull requests](https://github.com/paqu-io/form0-cli/pulls).
