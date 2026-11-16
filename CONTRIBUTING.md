# Contributing

**Removing code is more valuable than adding code.**

## Setup

```bash
pnpm install
pnpm build
pnpm test
```

## Local CI gate (husky hooks)

CI checks run locally via husky — there are no GitHub Actions check workflows. (The weekly OpenSSF
Scorecard workflow only publishes the README badge score; it gates nothing.)

| Hook         | What runs                                                                                                                 |
| ------------ | ------------------------------------------------------------------------------------------------------------------------- |
| `pre-commit` | `pnpm format:check`, `pnpm lint`                                                                                          |
| `pre-push`   | `pnpm typecheck`, `pnpm lint`, `pnpm test --passWithNoTests`, `pnpm security:gate`, trufflehog secret scan (if installed) |

Hooks are installed automatically by `pnpm install` (via the `prepare` script).

`pnpm security:gate` fails the push when a production dependency has a critical advisory.

To install trufflehog for secret scanning:
https://github.com/trufflesecurity/trufflehog#installation. It is optional — the pre-push hook skips
the scan if `trufflehog` is not on `PATH`.

## Security report

`pnpm security` runs every installed scanner and prints one summary: dependency advisories
(`pnpm audit`, OSV-Scanner), static analysis (Semgrep), secrets in git history (gitleaks), and the
repo's OpenSSF Scorecard score. Scanners that are not installed are skipped:

```bash
brew install osv-scanner semgrep gitleaks scorecard
pnpm security          # summary table
pnpm security --json   # the same numbers as JSON
```

Scorecard grades what is pushed to GitHub, so it needs a token (`gh auth login` or
`GITHUB_AUTH_TOKEN`) and doesn't move until your changes are pushed.

## Guidelines

- Use `workspace:*` for internal dependencies
- Use `catalog:` references for shared dependencies
- Follow [Conventional Commits](https://www.conventionalcommits.org/)
- Run `pnpm lint` and `pnpm format` before committing

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
