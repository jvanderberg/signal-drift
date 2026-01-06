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

## CRITICAL: No Type Escape Hatches

**NEVER use `as any`, `as unknown`, or any other type cast that bypasses TypeScript's type system.**

This is a strict, non-negotiable rule. Type casts like `as any` and `as unknown` defeat the entire purpose of TypeScript and hide bugs that should be caught at compile time.

**What to do instead:**
1. **Fix the actual type mismatch.** If types don't match, the code has a design problem. Fix it properly.
2. **Create union types** if a value can legitimately be multiple types (e.g., `DeviceCapabilities | OscilloscopeCapabilities`)
3. **Use type guards** to narrow types safely (e.g., `if ('channels' in capabilities) { ... }`)
4. **Add proper type definitions** for external data or APIs
5. **Use generics** where flexibility is needed

**Exception for tests (VERY LIMITED):**
In test files ONLY, `as unknown as T` may be used when:
- Creating intentionally malformed data to test error handling (e.g., `{ steps: 'not an array' } as unknown as ArbitraryWaveform`)
- Mocking complex external interfaces where full implementation is impractical

Even in tests, prefer creating proper mock factories with correct types. The `as unknown` escape hatch should be rare and always accompanied by a comment explaining why it's necessary.

**If you find yourself reaching for `as any`:**
STOP. You are about to introduce a potential runtime bug. Ask yourself:
- Why don't the types match?
- What is the correct type for this value?
- Should I create a union type or type guard?

## Project Structure

- `server/` - Backend Node.js code
- `client/` - Frontend React code
- `shared/` - Shared types and utilities
- Tests are colocated in `__tests__` directories
