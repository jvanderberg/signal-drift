# Claude Code Instructions

## First Thing: Install Dependencies

**IMPORTANT:** Before making any code changes, always run:

```bash
npm install
```

This ensures:
1. All dependencies are available for type checking
2. Husky pre-commit hooks are installed (runs typecheck before commit)
3. You can run tests locally to verify your changes

If `npm install` fails due to native dependencies (e.g., electron-builder), the core dependencies and hooks should still work. Check that `.git/hooks/pre-commit` exists after install.

## Before Committing

Always run these checks before committing:

```bash
npm run typecheck    # TypeScript compilation check
npm run test:run     # Unit and integration tests
```

Do NOT use `--no-verify` to skip pre-commit hooks.

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
