/**
 * Route Handler 统一包装。
 *
 * 作用只有一件：把任何异常交给 handleError，保证**不存在**返回裸 500 或
 * Next 默认错误页的路径。散在 40 多个文件里的 try/catch 迟早漏一个，
 * 而漏掉的那个恰好会是用户第一次点到的按钮。
 */
import type { NextRequest } from 'next/server';
import type { NextResponse } from 'next/server';
import { handleError } from './http';

type RouteContext = { params: Promise<Record<string, string>> };

export function route(
  fn: (req: NextRequest, params: Record<string, string>) => Promise<NextResponse>,
): (req: NextRequest, ctx: RouteContext) => Promise<NextResponse> {
  return async (req, ctx) => {
    try {
      const params = ctx?.params ? await ctx.params : {};
      return await fn(req, params);
    } catch (e) {
      return handleError(e);
    }
  };
}
