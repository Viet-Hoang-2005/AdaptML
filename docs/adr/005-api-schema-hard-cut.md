# ADR 005: API and Schema Hard Cut

Status: Accepted

The old schema and endpoints are not preserved. The public API has no version
prefix, resources use domain-specific routes, and all clients/manifests change in
one release. Initial migrations build a blank database. Cutover resets only the
control-plane PostgreSQL schema and separately cleans managed external resources.
