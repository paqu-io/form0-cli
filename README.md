# form0-cli

[![NPM Version](https://img.shields.io/npm/v/form0)](https://www.npmjs.com/package/form0)
[![NPM Downloads](https://img.shields.io/npm/dt/form0)](https://www.npmjs.com/package/form0)

Interactive CLI tools for form0-powered forms. Build, validate, and test form schemas with an intuitive command-line interface.

## Installation

Install form0-cli globally to use it from anywhere:

```bash
npm install -g form0-cli
```

Or use it directly with npx:

```bash
npx form0-cli
```

## Quick Start

### Interactive Mode (Recommended)

Simply run `form0` to enter the interactive environment:

```bash
form0
```

This will:
- Auto-detect existing form schemas in your directory
- Offer to initialize a new project if no schema is found
- Provide tab completion and command history
- Give you access to all form0 tools in one place

### Initialize a New Project

Create a new form0 project with sample schema:

```console
# In interactive mode
form0> init

# Or as standalone command
form0 init my-form-project
```

This creates:
- `form.schema.json` - Sample form schema
- `test.js` - Basic test script
- `README.md` - Project documentation

### Load and Preview Forms

```bash
# In interactive mode
form0> load form.schema.json
form0> preview

# Or as standalone command
form0 preview form.schema.json
```

## Interactive Commands

Once in interactive mode (`form0`), you can use these commands:

### Schema Management
- `init [dir]` - Initialize new form0 project
- `load <file>` - Load a form schema file
- `preview` - Show form structure with field details
- `validate` - Validate current schema
- `reload` - Reload current schema file

### Engine Operations
- `run [--values <input>]` - Execute form engine with optional test values
- `watch [--auto-run] [--auto-validate]` - Watch schema for changes
- `values` - Show stored test values
- `fields` - Show valid field names from schema

### Session Management
- `status` - Show current session status
- `clear` - Clear screen
- `clear values` - Clear stored test values
- `help` - Show all available commands
- `exit` - Exit interactive mode

## Standalone Commands

You can also use form0-cli commands directly:

```bash
# Initialize project
form0 init my-project

# Validate schema
form0 validate form.schema.json

# Preview form structure
form0 preview form.schema.json

# Run engine with test values
form0 run form.schema.json --values '{"name": "Alice", "age": 25}'
form0 run form.schema.json --values test-values.json

# Watch for changes
form0 watch form.schema.json --auto-run --auto-validate
```

## Working with Values

Form0-cli supports multiple ways to provide test values:

### JSON String
```bash
form0> run --values {"first_name": "Alice", "age": 25}
```

### JSON File
```bash
form0> run --values values.json
```

### YAML File
```bash
form0> run --values test-data.yaml
```

### Value Validation
All values are automatically validated against your schema's field names. Invalid fields are filtered out with helpful warnings.

## Features

- **🚀 Interactive Environment** - Tab completion, command history, smart initialization
- **📋 Schema Validation** - Real-time validation with detailed error messages  
- **👀 File Watching** - Auto-reload schemas and re-run engines on changes
- **🔧 Value Management** - Store and reuse test values across sessions
- **🎯 Smart Filtering** - Automatic validation of field names against schema
- **📊 Rich Output** - Color-coded, structured display of form data
- **⚡ Fast Workflow** - Seamless switching between development tasks

## Examples

### Basic Workflow
```bash
# Start interactive mode
form0

# Initialize new project (if needed)
form0> init

# Load schema and preview
form0> load form.schema.json
form0> preview

# Test with values
form0> run --values {"first_name": "Alice", "age": 25}

# Watch for changes during development
form0> watch --auto-run --auto-validate
```

### Development Workflow
```bash
# Watch schema file and auto-run engine on changes
form0 watch form.schema.json --auto-run --values test-data.json

# In another terminal, edit your schema
# The engine will automatically re-run when you save
```

## Requirements

- Node.js 16+ 
- npm or yarn

## Related Packages

- [form0-core](https://www.npmjs.com/package/form0-core) - Core form engine
- [form0-react](https://www.npmjs.com/package/form0-react) - React components
- [form0-react-native](https://www.npmjs.com/package/form0-react-native) - React Native components

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit issues and pull requests.
