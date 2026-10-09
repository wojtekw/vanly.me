# Vanly local service

Preserve the Vanly UI and Polish product copy from docs/prototype-v3.html. It is reference material, not a functional backend.

- App: Next.js FrontOffice on 3100, separate React/Vite owner/admin on 8182/8183, NestJS/Fastify API on 4100, PostgreSQL 16, independent worker.
- All money uses integer grosz. Derive price and permissions on the API; never accept client totals or roles.
- Scope owner operations by authenticated company. Database exclusion constraints protect vehicle occupancy; lock inventory rows for quantity allocation.
- Keep booking, payment, deposit and travel-service statuses separate.
- External payments and partner purchases stay disabled without explicit configuration. Local test payments must be clearly labelled.
- No AWS resources are necessary for local development. User's total AWS budget ceiling: USD 50/month. Do not create cloud resources casually.
- Keep credentials in .env.local and .local, both untracked. Never edit other projects' databases or services.
- Run meaningful API integration tests and check the relevant UI after changes.

- Source lives in this workspace; user services run from `/Users/wojtek/.local/share/vanly-portal`. Use scripts/deploy-local.sh for updates. Preserve all unrelated proxy domains.
