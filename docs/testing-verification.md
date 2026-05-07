# Testing & Verification

This repository includes unit tests for the Soroban contract.

Test coverage includes:
- contract initialization
- denial of execution for unapproved users
- admin approval flow
- approved user execution

For production-grade verification, the same patterns extend to invariant testing and formal verification.
Certora/Runtime Verification concepts can be layered on top of this POC for stronger guarantees.
