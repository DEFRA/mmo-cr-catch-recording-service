# Architecture Decision Records (ADRs)

This directory contains Architecture Decision Records (ADRs) for the MMO Catch Recording Authentication
Service, following DEFRA software development standards.

## When to write an ADR

Per the working framework in `.github/copilot-instructions.md` §3 step 6, author an ADR **before**
implementing any change that establishes or alters architecture:

- A new routing or plugin composition pattern
- A persistence, caching or session strategy change
- A new external service integration or service-to-service auth pattern
- A change to published API contract versioning or error-handling architecture

## Structure

Copy [template.md](./template.md) to `NNNN-short-title.md` (e.g. `0001-mongodb-persistence-and-locking.md`),
using the next sequential number.
