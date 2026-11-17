'use client';
/**
 * 内联 PDF：iframe 交给浏览器自带的阅读器（能翻页、能搜索、能缩放，全都免费）。
 *
 * 合同附件与发票原件共用这一份。两个模块各写一份的话，"多久没加载出来才提示、
 * 提示里写什么"只会在一处被改，另一处继续留一片空白。
 *
 * 地址必须是**同源、服务端写 inline** 的 content 路由，不能用文件自带的 url：
 * 云文件走 `/raw` → 302 到预签名地址，能不能内联取决于中间层有没有保留
 * `response-content-disposition` 参数。参数一丢，桶里对象的元数据（attachment）
 * 生效，点「预览」反而下载一个文件——线上真实发生过。
 */
import { useEffect, useState } from 'react';
import { Note } from './states';

export function PdfPreview({ url, fileName }: { url: string; fileName: string }) {
  const [stuck, setStuck] = useState(false);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    setStuck(false);
    setLoaded(false);
    // 内联 PDF 的 iframe 不会给我们任何"失败"回调（状态码、跨域都在阅读器内部），
    // 所以只能等：迟迟没有 load 就把"可能没显示出来"讲明白，而不是留一片空白。
    const t = window.setTimeout(() => setStuck(true), 12000);
    return () => window.clearTimeout(t);
  }, [url]);

  return (
    <div className="h-full flex flex-col">
      {stuck && !loaded ? (
        <div className="p-[var(--space-3)]">
          <Note tone="danger">
            浏览器没有把这份 PDF 显示出来（可能被安全策略拦了，或文件太大）。
            <div className="t-xs t-3 mt-[var(--space-1)]">
              点右上角「下载原件」用本地阅读器打开。若每份都这样，请把这条信息反馈给我们。
            </div>
          </Note>
        </div>
      ) : null}
      <iframe
        src={url}
        title={fileName || 'PDF 预览'}
        className="w-full flex-1 min-h-0 border-0"
        onLoad={() => setLoaded(true)}
      />
    </div>
  );
}
