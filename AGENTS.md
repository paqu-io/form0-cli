# Project Overview

This project, `form0-cli`, is a command-line interface (CLI) tool for `form0-core`, a form engine. It allows developers to create, validate, test, and preview form schemas from the command line. The CLI can be used in two modes: as a set of standalone commands or as an interactive shell.

## Role in the form0 Ecosystem

`form0-core` serves as the core engine for:

- **form0-cli**: Command-line tools that use the core engine for form schema validation, testing, and development workflows
- **form0-react**: React components and hooks that wrap the core engine to provide seamless integration with React applications
- **form0-react-native**: React Native components that leverage the core engine for mobile form experiences

## Role in reform SaaS

`form0-core` is the underlying engine that powers **reform**, a commercial SaaS product. While form0 is open-source and framework-agnostic, reform builds upon this foundation to provide a complete form management solution with additional enterprise features, hosting, and support.

## Key Features

- **Schema workflows**: init, validate, test, and live preview from the CLI.  
- **Interactive mode**: run commands in a shell-like experience.  
- **Live preview server**: Express-based server to preview forms locally.  
- **i18n workflow**: Localazy-backed extraction/upload/download of strings.  
- **Utility helpers**: shared utilities used by commands and preview server.

## Project Structure & Module Organization

- **Entry point**: `bin/form0.js` registers the `form0` CLI and routes subcommands.  
- **Commands**: `src/commands/` (e.g., `interactive.js`, `init`, `validate`, `preview`, `test`).  
- **Server**: `src/server/` (Express + WebSocket) with `static/` assets for preview.  
- **Utilities**: `src/utils/` shared helpers; **Locales** under `src/locales/`.  
- **Templates**: starter form templates under `src/form0-forms/`.  
- **Scripts**: `scripts/` (e.g., Localazy config generator). Root also includes `.env*`, Prettier config, and `localazy.json`.

## Build, Test, and Development Commands

- **Install deps**: `npm ci`  
- **Format (write)**: `npm run format`  
- **Format (check)**: `npm run format:check`  
- **Localazy sync**: `npm run generate-localazy-config`, `npm run localazy:upload`, `npm run localazy:download`  
- **Run CLI locally**: `node bin/form0.js <command>` (e.g., `node bin/form0.js serve form.schema.json`)  
- **Global dev link** (optional): `npm link` then use `form0 <command>`  
- **Examples**:  
  - Validate a schema: `form0 validate my-schema.json`  
  - Start interactive shell: `form0`

## Coding Style & Naming Conventions

- **Modules**: ESM only (`type: module`), use `import`/`export`.  
- **Files**: kebab-case for JS files (e.g., `value-validation.js`).  
- **Prettier**: 2 spaces, single quotes, semicolons, trailing commas (ES5), print width 100. Run the formatter before commits.

## Testing Guidelines

- **CLI test runner**: `form0 test [dir]` executes `test.js` in the target directory (defaults to `.`).  
- **Test project layout**: keep a `form.schema.json` and a `test.js`. A template is available at `src/utils/test-template.js`.  
- **Determinism**: keep tests deterministic; print meaningful outputs (validation results, engine state).

## Commit & Pull Request Guidelines

- **Commits**: Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:` …).  
- **PRs**: include purpose, linked issues, validation steps (commands + expected output), and any notes that affect locales or the preview server.

## Security & Configuration Tips

- **User config**: lives at `~/.form0-cli/config.json` (e.g., theme, locale) and is managed automatically by the CLI.  
- **Secrets**: do not commit credentials; keep machine-specific values in `.env.local`.  
- **Locales**: edit strings under `src/locales/` and use Localazy commands to sync.  
- **Dev note**: `form0-core` may be referenced via a local file path during development; ensure the sibling module exists or adjust dependency accordingly.

## Language Policy

- JavaScript (ESM) in this repo. If you want types, prefer lightweight JSDoc in code instead of adding a TS build step.
