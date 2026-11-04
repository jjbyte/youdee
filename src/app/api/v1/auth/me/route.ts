import { ok, requireUser } from '@/server/http';
import { route } from '@/server/wrap';

/** 当前用户。每次都回库校验 is_active 与 token_version，不信令牌里的 claims */
export const GET = route(async () => ok(await requireUser()));
