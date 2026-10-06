# Implementation
- Follow SPEC.md and the requested scope.
- Complete requested milestones in order without waiting for confirmation.
- Preserve existing architecture and reuse existing code where practical.
- Avoid unrelated refactoring, dependencies, or optional features.
- Ask only when ambiguity materially affects the result.

# Architecture
- Keep UI, provider, audio, analysis, deck, and mixer logic separated.
- Keep real-time audio processing outside React.
- Deck A and Deck B must share reusable implementations.

# Verification
- Verify each milestone before continuing.
- Add focused tests for new behavior and preserve existing tests.
- Fix failures caused by your changes.
- Report unrelated failures without fixing them.
- Never report skipped or failed checks as passed.

# Acceptance
- Automated tests do not replace real UI/audio testing.
- Final manual acceptance belongs to the user.
- Provide an unchecked acceptance checklist when needed.

# Documentation
- Do not create milestone, summary, plan, or verification files unless requested.
- Update existing docs only for lasting architecture or behavior changes.

# Communication
- Work autonomously and avoid unnecessary pauses.
- Report changes, tests, limitations, and remaining issues in Traditional Chinese.