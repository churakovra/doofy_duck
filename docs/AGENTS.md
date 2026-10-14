# Documentation maintenance

Use [README.md](README.md) as the index and authority map. Start from current
documents for the task.

- Record implemented behavior separately from requirements, future architecture,
  and dated verification evidence. Follow-up reports do not validate later code.
- Remove obsolete documents and outdated sections; update incoming links. Do not
  keep superseded requirements as historical guidance. Retained verification
  evidence must keep its execution date and must not imply a new successful run.
- When adding or moving a document, update the index and check relative links.
- Keep code ownership in `ARCHITECTURE.md`, operational commands in the root
  README, and exact simulation mechanics in `ARCADE_SIMULATION.md`.
- Update relevant current docs when behavior changes. Do not duplicate the full
  specification or bake changing test counts into agent instructions.
- Keep private/ignored materials out of tracked docs. Do not reconstruct removed
  documents from Git history without an explicit user request.

Documentation-only work needs link/diff inspection; it does not require running
the application suites or regenerating simulation fixtures.
