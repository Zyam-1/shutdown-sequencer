# Security Policy

## Supported Versions

| Version | Supported |
|---|---|
| 1.0.x | ✅ |
| 0.1.x | ❌ |

## Reporting a Vulnerability

If you discover a security vulnerability in shutdown-sequencer, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, please email **[zyamm7@gmail.com]** with:

1. A description of the vulnerability
2. Steps to reproduce
3. Potential impact assessment

You will receive a response within 48 hours acknowledging receipt. A fix will be developed privately and released as a patch version before any public disclosure.

## Scope

Since shutdown-sequencer is a zero-dependency process lifecycle library, the most likely security concerns are:

- Signal handling that could be exploited to prevent graceful shutdown
- Unintended information disclosure via error messages or log output
- Denial-of-service through crafted phase configurations

Dependencies are audited in CI via `npm audit`.
