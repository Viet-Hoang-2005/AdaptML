# ADR 001: Domain-Oriented Modular Monolith

Status: Accepted

The control plane is organized by business domain under `apps/`. Each app owns
its persistence and write services. Selectors provide tenant-scoped reads.
Infrastructure is behind execution/storage clients. This replaces the former
large view modules and shared persistence object with explicit boundaries while
retaining one deployable Django service.
