# ADR 002: UUID Public Identifiers

Status: Accepted

Every public resource uses an immutable UUID `public_id` in APIs, callbacks, S3
keys, and runtime names. Integer primary keys are internal. Encoded integer IDs
were removed to avoid coupling public contracts to database identity and to make
resource identifiers portable across execution systems.
