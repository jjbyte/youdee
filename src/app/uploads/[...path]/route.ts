/**
 * 附件读取（图片 / PDF）。
 *
 * 为什么不能靠 public/ 静态托管：`next start` 在**进程启动时**把 public/ 递归读成一个
 * Set（next/dist/server/lib/router-utils/filesystem.js），之后新写入的文件不在这个集合里，
 * 请求会被判为不存在 —— 直到下次重启。而附件是运行期上传的，于是生产上表现为
 * "传完图，刷新就 404"，本地 `next dev` 逐次读盘，看不到这个差异。
 *
 * 这里显式从 UPLOAD_DIR 读盘返回，与上传侧的落盘目录是同一个来源，
 * 所以不存在"两边各写一个路径、只有一边对"的问题。
 */
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export const runtime = 'nodejs';
// 每次都要看盘：缓存了这个响应，新上传的文件就永远拿不到
export const dynamic = 'force-dynamic';

// turbopackIgnore：这行会让静态分析认为"路径是动态的"，于是把整个工程（含 public/）
// 都算进 server 产物的依赖里，构建变慢、体积膨胀。而这里读的是运行期上传的文件，
// 构建期一个都不存在，追不追无所谓 —— 显式退出追踪。
const ROOT = path.resolve(/*turbopackIgnore: true*/ process.cwd(), process.env.UPLOAD_DIR ?? 'var/uploads');

/** 与 upload.service 的白名单一致。不在表里的扩展名一律不读盘。 */
const MIME: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
};

function notFound(): Response {
  return new Response('附件不存在', { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

export async function GET(_req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path: segs = [] } = await ctx.params;

  const mime = MIME[path.extname(segs.at(-1) ?? '').toLowerCase()];
  if (!mime) return notFound();

  // 反目录穿越。只判 startsWith(ROOT) 不够稳：先挡掉所有可疑段，
  // 再对拼好的绝对路径做一次前缀校验，两道都过才读盘。
  if (segs.some((s) => s === '' || s === '.' || s === '..' || s.includes('/') || s.includes('\\'))) {
    return notFound();
  }
  const target = path.resolve(/*turbopackIgnore: true*/ ROOT, segs.join(path.sep));
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) return notFound();

  try {
    const info = await stat(target);
    if (!info.isFile()) return notFound();
    const buf = await readFile(target);
    return new Response(new Uint8Array(buf), {
      headers: {
        'Content-Type': mime,
        'Content-Length': String(info.size),
        // 文件名是 UUID，内容不会变；但仍标 private，这些是内部资料
        'Cache-Control': 'private, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch {
    return notFound();
  }
}
