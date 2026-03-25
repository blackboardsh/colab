# Workflow Guide

## Repository Configuration

- **origin**: Your fork (push target)
- **upstream**: blackboardsh/colab (fetch only)

## Git Settings

```bash
pull.rebase = false    # Use merge (not rebase)
pull.ff = only         # Fast-forward only pulls
merge.ff = false       # Create merge commits
```

## Main Branch

- **swe/main**: Tracks upstream/main for sync

## Worktree Setup

```bash
# Create feature worktree
git worktree add worktrees/colab/feat/my-feature -b feat/my-feature

# List worktrees
git worktree list
```

## Sync Workflow

```bash
# Sync swe/main with upstream
git checkout swe/main
git fetch upstream
git merge --ff-only upstream/main || git merge --no-ff upstream/main
git push origin swe/main

# Create feature
git worktree add worktrees/colab/feat/my-feature -b feat/my-feature
cd worktrees/colab/feat/my-feature
```

## Branch Naming

- `feat/*`, `fix/*`, `chore/*`, `refactor/*`, `docs/*`

## Rules

1. Use worktrees for features
2. swe/main: FF-only when possible, no-ff otherwise
3. No rebase on pushed branches
4. Merge commits preserve history
