# Catch Recording module ownership root

This directory is the agreed ownership root for the eight Catch Recording modules. See
[`docs/catch-recording-modules.md`](../../docs/catch-recording-modules.md) for each module's
responsibilities, exclusions, and the approved dependency direction.

Rules for adding code here:

- Create a module subdirectory (`controller/`, `normalization/`, `submission/`, `query/`,
  `validation/`, `persistence/`, `artifact/`, `pdf/`) only when the implementation step that owns it adds
  its first real file. Do not pre-create an empty subdirectory.
- Keep a small module to one implementation file and one colocated test; split further only when the
  module has enough code to justify it.
- Application and domain modules must not import Hapi, `@hapi/boom`, the `mongodb` driver, or an
  object-storage SDK — those belong to the owning adapter (`controller/`, `persistence/`, `artifact/`).
- Do not add a pass-through wrapper, placeholder file, or empty barrel export.

This repository is a greenfield Catch Recording implementation: no module here may reference a previous
Catch Recording implementation, legacy fields, migration or compatibility behaviour, Redis, or any
application cache.
