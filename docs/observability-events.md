# Observability & Events

This demo uses Soroban events to provide an application-level activity stream.

- `initialized`: indicates the contract bootstrapped its admin
- `user_approved`: indicates an admin-approved wallet
- `protected_action_executed`: indicates a successful guarded call

The frontend activity panel is a lightweight indexing pattern for demo purposes.
A production system would add observability tooling such as OpenZeppelin Monitor or Hypernative-style streaming.

Soroban events make it possible to build audit trails, dashboards, and alerting for protected asset flows.
