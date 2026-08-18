# Contributing to shutdown-sequencer

Thanks for your interest in contributing! This document covers what you need to know.

## Development Setup

```bash
git clone https://github.com/zyam/shutdown-sequencer.git
cd shutdown-sequencer
npm install
```

### Available Scripts

| Command | What it does |
|---|---|
| `npm test` | Run the full test suite (vitest) |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage report |
| `npm run lint` | Lint source and test files (ESLint) |
| `npm run lint:fix` | Lint and auto-fix where possible |
| `npm run format` | Format all files (Prettier) |
| `npm run format:check` | Check formatting without modifying |
| `npm run typecheck` | Type-check without emitting (tsc --noEmit) |
| `npm run build` | Build CJS/ESM/DTS output to `dist/` |

### CI Pipeline Order

The CI runs checks in this order, failing fast on the cheapest check:

```
lint → typecheck → test → build → bundle size → package contents → tarball smoke test
```

Make sure the first four pass locally before pushing:

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

The last three gates run only in CI. They guard the published artifact: the gzipped ESM bundle must stay under 2KB, and the packed tarball is installed into a scratch project and loaded via both `require()` and `import()` — which is how a broken `exports` map gets caught before it reaches npm.

## Coding Rules

This project follows strict coding rules, enforced by ESLint and `tsc` where possible:

### TypeScript

- **`strict: true`** — no exceptions
- **No `any`** — use `unknown` and narrow, or define the actual type
- **No `export default`** — named exports only (CJS/ESM interop)
- **No non-null assertions (`!`)** without a comment explaining why
- **Exhaustive switches** — every `switch` on a union gets a `default: assertNever(x)` case

### Error Handling

- Never swallow errors silently (no empty `catch {}`)
- Throw `Error` subclasses with structured context, never strings
- Every `Promise` is `await`ed, `.catch()`ed, or marked `void` with a comment

### Testing

- Every bug fix ships with a regression test
- Test behavior, not implementation
- No shared mutable state between tests
- Each test sets up and tears down its own state

### Style

- No magic numbers/strings — use named constants
- One primary export per file
- No commented-out code in commits

## Commit Convention

This project uses [Conventional Commits](https://www.conventionalcommits.org/):

```
feat: add retry option for failed phases
fix: prevent stall when all phases are sync
chore: update dev dependencies
refactor: extract wave executor into separate function
docs: clarify after-ordering behavior in README
test: add regression test for diamond dependency race
```

One logical change per commit. A commit that mixes a bug fix with an unrelated refactor should be split into two.

## Pull Request Process

1. **Fork the repo** and create your branch from `main`
2. **Keep PRs small** — if it needs a summary paragraph longer than the diff, split it
3. **Run the full pipeline** before pushing:
   ```bash
   npm run lint && npm run typecheck && npm test && npm run build
   ```
4. **Add tests** for any new behavior or bug fix
5. **Update documentation** if you're changing the public API
6. **Fill out the PR template** — describe what changed and why

### What Gets Reviewed

The CI gates catch formatting, type errors, lint violations, and test failures automatically. Code reviewers focus on:

- Function size and single-responsibility
- Documentation quality (why-comments, not what-comments)
- API design and naming
- Edge cases the tests might miss

## Scope

Before starting work on a new feature, please open an issue to discuss it. This project has explicit [non-goals](./README.md#non-goals) to keep scope manageable:

- No serving of readiness/liveness endpoints — the package binds no port. `isShuttingDown()` exposes the state for you to wire into your own server.
- No framework-specific plugins
- No retry logic for failed phases
- No distributed/multi-process coordination

Features outside these boundaries are deferred to a v2 discussion, not silently added.

## Reporting Bugs

When filing a bug report, include:

1. **Node.js version** (`node --version`)
2. **shutdown-sequencer version** (`npm ls shutdown-sequencer`)
3. **Minimal reproduction** — the smallest code that triggers the bug
4. **Expected vs actual behavior**
5. **Relevant logs** (especially if a phase is hanging or ordering is wrong)

## License

By contributing, you agree that your contributions will be licensed under the [MIT License](./LICENSE).
