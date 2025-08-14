# Project Overview

This project is a command-line interface (CLI) tool for `form0`, a form engine. It allows developers to create, validate, test, and preview form schemas from the command line. The CLI can be used in two modes: as a set of standalone commands or as an interactive shell.

## Key Technologies

*   **Node.js**: The runtime environment for the CLI.
*   **Commander.js**: A library for building command-line interfaces.
*   **Express.js**: A web framework used for the live preview server.
*   **form0-core**: The core form engine.

## Architecture

The project is structured as follows:

*   `bin/form0.js`: The main entry point for the CLI. It defines all the available commands and their arguments.
*   `src/commands/`: This directory contains the implementation of each command.
    *   `interactive.js`: Orchestrates the interactive mode.
    *   Other files in this directory implement the standalone commands (`init`, `validate`, `preview`, etc.).
*   `src/server/`: This directory contains the implementation of the Express server for the live preview.
*   `src/utils/`: This directory contains utility functions used by the commands and the server.

# Building and Running

## Installation

To install the CLI globally, run:

```bash
npm install -g .
```

## Running the CLI

The CLI can be run in two ways:

1.  **Standalone commands**:

    ```bash
    form0 <command> [options]
    ```

    For example, to validate a schema, run:

    ```bash
    form0 validate my-schema.json
    ```

2.  **Interactive mode**:

    ```bash
    form0
    ```

    This will start an interactive shell where you can run all the available commands.

## Development

To run the CLI in development mode, you can use `npm link` to create a symbolic link to the global `node_modules` directory:

```bash
npm link
```

Then, you can run the CLI from any directory using the `form0` command.

## Scripts

The `package.json` file contains the following scripts:

*   `npm run format`: Formats the code using Prettier.
*   `npm run format:check`: Checks the code formatting.
*   `npm run generate-localazy-config`: Generates a configuration file for Localazy, a localization management platform.
*   `npm run localazy:upload`: Uploads the localization files to Localazy.
*   `npm run localazy:download`: Downloads the localization files from Localazy.

# Development Conventions

## Coding Style

The project uses Prettier for code formatting. The configuration is defined in the `.prettierrc` file.

## Testing

The project does not have a dedicated test suite. However, the `test` command can be used to run a `test.js` file in a specified directory.

## Contribution Guidelines

The `README.md` file states that contributions are welcome and that issues and pull requests can be submitted on GitHub.
