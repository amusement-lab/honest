# NestJS Flavor Notes

The repo name "honest" = HonoJS + NestJS flavor. Goal is to mimic NestJS folder/structure conventions, not the rigid decorators or strict conventions.

## Current structure vs NestJS

| Element | NestJS | Our approach |
|---------|--------|-------------|
| Feature grouping | `modules/user/` with controller, service, module, entity, dto | `modules/user/` with controller, service, entity (merged DTO + entity) |
| Per-feature module | `user.module.ts` declares providers/imports/exports | Skipped — empty ceremony without DI |
| DTO | Separate `dto/create-user.dto.ts` | Merged into `*.entity.ts` — less file-jumping, same domain object |
| Module naming | `modules/` (plural) | Now `modules/` |
| Test suffix | `.spec.ts` | `.test.ts` (Vitest default) |

## What matters (already present)

- Feature grouping — co-located controller + service + entity for each domain
- `app.module.ts` as the single composition root
- `db/` separated from business logic
- `utils/` for cross-cutting helpers
- `common/` for root-level controller

## What's intentionally skipped

- Per-feature `module.ts` files — would be empty ceremony without DI
- Separate DTO files — merged with entity since they describe the same object
- Decorators / decorator system — not the goal
- DI container — not the goal

## Verdict

The structure is clean and achieves the NestJS-flavored look without overhead. No structural changes needed beyond bug/design fixes.
