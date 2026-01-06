# Claude Development Notes

This document contains important guidelines for Claude instances working on this codebase.

## Critical: Always Run Tests Before Pushing

**NEVER push changes without running all relevant tests first.** A previous commit broke tests because the mock objects in WebSocketHandler.test.ts weren't updated to match the production code changes.

Before pushing any changes:

1. Run `npm test` to execute the full test suite (typecheck + vitest + client tests)
2. If that fails due to native module issues, at minimum run `npx vitest --run` for the server tests
3. Fix any failing tests before committing/pushing
4. If you modify code that has corresponding test files, make sure to update both the production code AND the test mocks/fixtures

## Common Test Issues

### Native Module Errors (SQLite/better-sqlite3)
If you see errors like:
```
Error: Module did not self-register: '.../better-sqlite3/build/Release/better_sqlite3.node'
```
This is an environment setup issue, not a code issue. You can exclude SQLite tests with:
```bash
npx vitest --run --exclude '**/db/**'
```

### Mock Objects
When changing interfaces or method signatures in production code, always check for corresponding test mocks that may need updates. For example, the WebSocketHandler tests use MockWebSocket objects that need to implement the same methods the real WebSocket does.

## Project Structure

- `server/` - Backend Node.js code
- `client/` - Frontend React code
- `shared/` - Shared types and utilities
- Tests are colocated in `__tests__` directories
