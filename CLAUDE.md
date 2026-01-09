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

## Testing Standards

### NEVER Copy Implementation Code Into Tests

**This is the cardinal sin of testing.** Tests must import and exercise the ACTUAL code, not a copy of it.

**BAD - Copying logic into tests:**
```tsx
// ❌ WRONG: Re-implementing the function in the test file
function formatValue(value: number, decimals: number): string[] {
  // copied from component...
}

it('formats correctly', () => {
  expect(formatValue(3, 2)).toEqual(['0', '3', '0', '0']);
});
```

**GOOD - Testing the actual code:**
```tsx
// ✅ CORRECT: Import and test the real component/function
import { DigitSpinner } from '../DigitSpinner';

it('formats correctly', () => {
  render(<DigitSpinner value={3} decimals={2} min={0} max={100} onChange={vi.fn()} unit="V" />);
  expect(screen.getByText('03.00')).toBeInTheDocument();
});
```

### Why Copying Code Into Tests Is Unacceptable

1. **Tests verify the copy, not the actual code** - Bugs in production go undetected
2. **Same bug in both places = passing tests with broken code**
3. **Changes to production code aren't validated** - Tests become stale
4. **False confidence** - 100% pass rate means nothing

### What Tests MUST Do

1. **Import the actual module/component being tested**
2. **Exercise the real code path** - render components, call actual functions
3. **Test behavior, not implementation** - verify outputs and side effects
4. **For React components**: use React Testing Library to render and interact
5. **For utility functions**: export them and import in tests

### If Logic Needs Unit Testing

If a component has complex internal logic worth unit testing:

1. **Extract it to a separate, exported function** in a utils file
2. **Import that function in both the component AND the test**
3. **Never duplicate the logic**

```tsx
// utils/formatters.ts
export function formatDigits(value: number, decimals: number, max: number): string[] { ... }

// Component.tsx
import { formatDigits } from '../utils/formatters';

// Component.test.tsx
import { formatDigits } from '../utils/formatters';  // Same function!
```

### Test File Checklist

Before writing a test, verify:
- [ ] Does it import the actual code being tested?
- [ ] Does it render/call the real implementation?
- [ ] Would a bug in production cause this test to fail?
- [ ] If I change the production code, will this test catch regressions?
