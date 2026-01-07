# Claude Code Instructions

## MANDATORY: Run Tests Before Every Commit

**THIS IS NON-NEGOTIABLE.** You MUST run both typecheck and tests before committing ANY changes:

```bash
npm run typecheck    # TypeScript compilation check
npm run test:run     # Unit and integration tests
```

**BOTH commands must pass with zero errors before you commit.** If tests fail, fix them before committing. Do NOT commit code that breaks tests.

**Do NOT use `--no-verify` to skip pre-commit hooks.**

## First Thing: Install Dependencies

**IMPORTANT:** Before making any code changes, always run:

```bash
npm install
cd client && npm install && cd ..
```

This ensures:
1. All dependencies are available for type checking
2. Husky pre-commit hooks are installed (runs typecheck before commit)
3. You can run tests locally to verify your changes

If `npm install` fails due to native dependencies (e.g., electron-builder), try:
```bash
npm install --ignore-scripts
cd client && npm install && cd ..
```

Check that `.git/hooks/pre-commit` exists after install.

## Pre-Commit Checklist

Before EVERY commit, you MUST:

1. **Run `npm run typecheck`** - Must pass with zero errors
2. **Run `npm run test:run`** - All tests must pass
3. **Review your changes** - Ensure tests cover new functionality
4. **If you change code, verify existing tests still pass**
5. **If tests fail, either fix the code OR fix the tests** - Never commit failing tests

## Project Structure

- `client/` - React frontend (Vite + TypeScript)
- `server/` - Node.js backend (Express + TypeScript)
- `shared/` - Shared types between client and server
- `e2e/` - Playwright end-to-end tests
- `demo/` - Demo/simulation code

## Key Patterns

- Uses Zustand for state management
- WebSocket communication between client and server
- Type guards (e.g., `isDeviceCapabilities()`) for discriminating union types
