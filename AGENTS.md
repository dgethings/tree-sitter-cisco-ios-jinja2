# AGENTS.md

Commands and conventions for working in this repo.

## Workflow — branches, worktrees & pull requests (authoritative)

> **This section is this repository's authoritative contribution policy.** It
> **supersedes** any generic close-protocol guidance emitted elsewhere —
> including the beads "Session Completion" block at the bottom of this file and
> the `bd prime` output. **Never push to `main` directly: every change lands
> through a branch + pull request.** When the two disagree, this section wins.

This repo is a **git worktree** layout managed by the [`wt`](https://github.com/dgethings/wt)
command. The default checkout is itself a worktree (`main` lives at
`…/tree-sitter-cisco-ios-jinja2/main`); sibling worktrees are created next to it,
one per branch. Each unit of work gets its own worktree on its own branch, so
multiple changes can proceed in parallel without clobbering each other.

### Branch naming

Conventional-Commits prefixes, one per change:

| prefix      | use for                                            |
| ----------- | -------------------------------------------------- |
| `feat/`     | new grammar rules / parsing capability             |
| `fix/`      | bug fixes to the grammar or bindings               |
| `chore/`    | tooling, build, deps, metadata                     |
| `docs/`     | README, AGENTS.md, comments                        |
| `refactor/` | internal restructuring, no behavior change         |

Commit messages follow Conventional Commits too (`feat(grammar): …`,
`fix(node): …`, `docs(agents): …`).

### Lifecycle of a change

```bash
# 1. Start — create a worktree + branch off main
wt switch --create docs/<short-slug> -b main

# 2. Cold start only — build deps are gitignored, so a fresh worktree is bare:
npm install && pip install -e . && go mod download
#    …or copy them from an existing worktree to skip the cold start:
wt step copy-ignored

# 3. Make changes. Regenerate src/ for any grammar edit (see next section).
make test

# 4. Commit (Conventional Commits) and push the branch
git add -A
git commit -m "docs(agents): adopt worktree + PR workflow"
git push -u origin HEAD

# 5. Open, then merge, the pull request
gh pr create --fill
gh pr merge --squash --delete-branch     # only after CI is green

# 6. Clean up the worktree
wt switch main
wt remove docs/<short-slug>
```

### Notes

- **`wt merge` is a *local* merge** (squash + fast-forward into the target
  branch). For a reviewed change use the `gh pr …` flow above; reserve
  `wt merge` for fast local merges you explicitly choose not to review.
- **CI is PR-ready**: `.github/workflows/ci.yml` runs on every PR and enforces
  the `git diff --exit-code src/` drift gate plus all four binding builds. Do
  not merge a red PR.
- **GitHub branch protection on `main`** (require a PR + passing CI before
  merge) is the companion hard control — see beads issue `main-00q` for the
  manual GitHub-settings step.
- **Beads is worktree-safe**: `.beads/` lives at the bare-repo root (shared by
  all worktrees) and syncs via `refs/dolt/data` in the shared `.git`, so `bd`
  commands work identically from any worktree.

## After any `grammar.js` change (mandatory)

Do this **on your feature branch, inside its worktree** — never directly on
`main`:

```
make test                   # regen src/parser.c, src/grammar.json, src/node-types.json
                            # corpus — must stay green
git add src/ grammar.js     # src/ is committed (bindings build from it — never leave it drifted)
```

Commit the regenerated `src/` together with the `grammar.js` change on your
branch, then follow the PR lifecycle above.

`src/parser.c`, `src/grammar.json`, `src/node-types.json` are **CHECKED IN** and
are the source of truth for every binding (C/Go/Node/Python all build from
`src/`). Regenerate and commit them on every grammar change — a drifted `src/`
will fail CI's `git diff --exit-code src/` gate.

## Binding tests

Run the ones you touched, or all four — inside the worktree you're working in:

```
npm install && npm test                                       # Node  (node --test bindings/node/*_test.js)
go test ./bindings/go                                         # Go
pip install -e . && python -m pytest bindings/python/tests    # Python
make test                                                     # alias for `tree-sitter generate && tree-sitter test`
```

Node and Python bindings require a C compiler — `node-gyp` and `setuptools`
both compile `src/parser.c` into a native extension.

## Gotchas

- `\n` is deliberately NOT in `extras` (`grammar.js` line ~49) — it's what
  keeps `command_line` line-bound. Do NOT add it.
- New rich rules promote a leading keyword via `token(prec(2, "kw"))`. A
  GENERIC rule (`seq(kw, repeat(arg))`) is safe; a SPECIFIC rule orphans
  sibling commands because the lexer commits to the keyword tokenization and
  tree-sitter does NOT re-lex. See the deferred-`ip address` comment in
  `grammar.js` (~line 391): one specific rule regressed coverage by +344
  errors.
- Top-level commands dispatch via `_ios_statement`, NOT `_command`. A new
  top-level rich rule must be registered in BOTH (see the config-global /
  config-line / nacl mirrors, `grammar.js` ~line 290). Section-body rules go
  in `_command` only.
- Build artifacts (`*.a`, `*.so`, `*.dylib`, `*.wasm`, `*.pc`, `build/`,
  `node_modules/`, `dist/`, `*.egg-info`, `uv.lock`) are gitignored — never
  commit them.

## Where things live

- Grammar — `grammar.js`
- Generated parser — `src/` (`parser.c`, `grammar.json`, `node-types.json`)
- Bindings — `bindings/{c,go,node,python}/`
- Corpus — `test/corpus/*.txt` (153 cases, 13 files)
- Queries — `queries/` (`highlights.scm`, …)

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:7510c1e2 -->
<!-- NOTE: the "Session Completion" block below was adapted for this repo's
     branch + PR policy (see the authoritative "Workflow" section above). It is
     beads-managed; a future `bd setup` run may regenerate it — in which case
     the authoritative Workflow section still holds. -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

**Architecture in one line:** issues live in a local Dolt DB; sync uses `refs/dolt/data` on your git remote; `.beads/issues.jsonl` is a passive export. See <https://github.com/gastownhall/beads/blob/main/docs/SYNC_CONCEPTS.md> for details and anti-patterns.

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT
complete until the change is merged to `main` via pull request (see the
authoritative "Workflow" section above — **do not push to `main` directly**).

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds (e.g. `make test`)
3. **Update issue status** - Close finished work, update in-progress items
4. **OPEN & MERGE A PULL REQUEST** - This is MANDATORY (never push straight to `main`):

   ```bash
   git push -u origin HEAD                # push your feature branch
   gh pr create --fill                    # open the PR
   gh pr merge --squash --delete-branch   # after CI is green
   ```

5. **Clean up** - Return to the main worktree, remove the feature worktree,
   refresh `main`:

   ```bash
   wt switch main
   wt remove <branch>
   git pull
   ```

6. **Verify** - The PR is merged and `main` is up to date locally
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**

- Work is NOT complete until the **PR is merged** to `main`
- NEVER push directly to `main` — always open a PR
- NEVER say "ready to push when you are" - YOU open and merge the PR
- If CI fails, fix it on the branch and re-push until the PR is green
<!-- END BEADS INTEGRATION -->
