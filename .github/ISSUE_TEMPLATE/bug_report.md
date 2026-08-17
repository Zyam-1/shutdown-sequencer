---
name: Bug Report
about: Something isn't working as expected
title: "bug: "
labels: bug
assignees: ""
---

## Environment

- **Node.js version:** (`node --version`)
- **shutdown-sequencer version:** (`npm ls shutdown-sequencer`)
- **OS:**

## Describe the Bug

A clear description of what the bug is.

## Reproduction

The smallest possible code that triggers the bug:

```ts
import { createShutdownManager } from 'shutdown-sequencer';

const shutdown = createShutdownManager();
// ...
```

## Expected Behavior

What you expected to happen.

## Actual Behavior

What actually happened. Include any error messages or log output.

## Additional Context

Any other context — is a specific phase hanging? Is the ordering wrong? Are you running in Docker/Kubernetes?
