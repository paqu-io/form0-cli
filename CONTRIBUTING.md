# Contributing to form0

Thanks for taking the time. form0 is an open-source form ecosystem — an engine,
a CLI, framework bindings and connectors — released under the MIT License.

This guidance is shared across the public form0 repositories in the
[paqu-io](https://github.com/paqu-io) organisation. Repository-specific instructions take
precedence where they differ.

## Ways to help

You do not need to write code to be useful here.

- **Report a bug.** A form schema that reproduces the problem is worth more
  than a long description. See [Reporting a bug](#reporting-a-bug).
- **Improve the docs.** If something took you a second read to understand, that
  is a docs bug. [docs.form0.dev](https://docs.form0.dev)
- **Answer a question.** Someone hitting the same wall you already climbed will
  find your answer in the issue tracker later.
- **Send a pull request.** See [Making a change](#making-a-change).

## Which repository?

form0 is split across several packages. Filing in the right place saves a round
trip, but if you are unsure, open the issue anywhere — we will move it.

| Repository                                                                                              | What lives there                                         |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------- |
| [`form0-core`](https://github.com/paqu-io/form0-core)                                                   | The engine: calculations, conditions, validation, events |
| [`form0-cli`](https://github.com/paqu-io/form0-cli)                                                     | `form0` command, dev server, schema tooling              |
| [`form0-react`](https://github.com/paqu-io/form0-react)                                                 | React bindings                                           |
| [`form0-react-native`](https://github.com/paqu-io/form0-react-native)                                   | React Native bindings                                    |
| [`form0-connector-pg`](https://github.com/paqu-io/form0-connector-pg)                                   | PostgreSQL persistence                                   |
| [`form0-connector-sqlite`](https://github.com/paqu-io/form0-connector-sqlite)                           | SQLite persistence                                       |
| [`form0-web-tmpl-react-vite`](https://github.com/paqu-io/form0-web-tmpl-react-vite)                     | React and Vite starter                                   |
| [`form0-mobile-tmpl-react-native-expo`](https://github.com/paqu-io/form0-mobile-tmpl-react-native-expo) | React Native and Expo starter                            |

If behaviour is wrong when the schema is evaluated, it is almost always
`form0-core` — even when you noticed it through the CLI or a binding.

## Reporting a bug

Open an issue with:

1. **The smallest schema that reproduces it.** Trim fields until the problem
   disappears, then put the last version back.
2. **The values you fed in**, and what the engine produced.
3. **What you expected instead**, and why.
4. **Versions** — the package version and your Node version.

A reproducible schema usually turns a week of guessing into an afternoon of
fixing. It is the single most valuable thing you can attach.

## Proposing a feature

Open an issue describing the problem before writing the code. Start with the
form you were trying to build and what stopped you, not with the API you have
in mind — the underlying need often has a simpler answer than the feature it
first suggests.

Please wait for a maintainer response before starting substantial work. Nobody
enjoys closing a large pull request that was heading somewhere we cannot merge.

## Making a change

```bash
npm ci          # install exactly what the lockfile pins
npm run format  # Prettier
npm test        # or the repo's documented test command
```

Before opening the pull request:

- **Run the checks.** Each repository documents its own; most have `npm run
format:check` and a test script. CI runs the same things.
- **Add a test.** For a bug fix, one that fails without your change. For a
  feature, one that covers the behaviour you are adding.
- **Keep it focused.** Unrelated cleanups in the same pull request make the
  actual change hard to review. Send them separately — they are welcome.
- **Match the surrounding code.** Naming, comment density and file layout
  should read as though the existing author wrote it.

### Conventions

- **JavaScript only** in `form0-core`. Types are expressed with JSDoc, so there
  is no TypeScript build step.
- **ES Modules** throughout. File names are `kebab-case.js`.
- Functions are `camelCase`, classes `PascalCase`, constants
  `UPPER_SNAKE_CASE`.
- Prettier settings live in each repository; run the formatter rather than
  matching the style by hand.

### Commit messages

[Conventional Commits](https://www.conventionalcommits.org/), with a scope
where one is obvious:

```
feat(schema): add version utilities
fix(engine): keep read-only fields out of calculated results
docs(cli): document the connector command
```

### Pull requests

Say what the change does and why. Link the issue it closes. If you changed
anything exported from the public API, note it explicitly — that is what other
people build on.

## Security

**Do not open a public issue for a security problem.** form0 evaluates
expressions from form schemas, so a report there can be genuinely sensitive.
Use the private reporting link in `SECURITY.md` in the affected repository.

## Licence

By contributing you agree that your contributions are licensed under the MIT
License, the same terms that cover the rest of the project.
