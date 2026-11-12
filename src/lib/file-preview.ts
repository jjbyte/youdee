/**
 * 「这份附件能不能在页面里看」的判断。
 *
 * 单独成一个纯函数模块，是因为这个判断有四个消费方（列表按钮文案、弹层分派、
 * 空态提示、单测），而它们分散在三处代码里 —— 各写一份 `ext === 'pdf' || ...`，
 * 加一种格式时漏掉一处，就会出现"按钮写着预览、点开让你下载"这种自相矛盾的界面。
 *
 * 关键事实：**浏览器只认 PDF 和图片**。Word / Excel 没有原生渲染能力，
 * 想让它们显示必须自己解析（docx 用 docx-preview，xlsx 用服务端 exceljs）。
 * 老格式 .doc / .xls 是二进制，现有解析库都读不了，只能下载。
 */

/** 弹层里怎么画 */
export type PreviewKind =
  /** 浏览器原生 PDF 阅读器（iframe） */
  | 'pdf'
  /** <img> */
  | 'image'
  /** docx-preview 解析后重排 */
  | 'docx'
  /** 服务端 exceljs 解析成表格 */
  | 'sheet'
  /** 只能下载 */
  | 'none';

export function previewKind(ext: string | null | undefined): PreviewKind {
  const e = (ext ?? '').toLowerCase().replace(/^\./, '');
  switch (e) {
    case 'pdf':
      return 'pdf';
    case 'jpg':
    case 'jpeg':
    case 'png':
    case 'webp':
      return 'image';
    case 'docx':
      return 'docx';
    case 'xlsx':
      return 'sheet';
    default:
      return 'none';
  }
}

/** 能不能在弹层里看。决定按钮写「预览」还是「下载」 */
export function canPreview(ext: string | null | undefined): boolean {
  return previewKind(ext) !== 'none';
}

/**
 * 不能预览时的说明。必须说出**为什么**和**怎么办**：
 * 「不支持预览」这种话用户已经听了一辈子，它不解决任何问题。
 */
export function previewBlockedHint(ext: string | null | undefined): string {
  const e = (ext ?? '').toLowerCase().replace(/^\./, '');
  if (e === 'doc') {
    return '老版 Word（.doc）无法在线预览。下载后用 Word 打开、另存为 .docx 再上传，就能在这里直接看。';
  }
  if (e === 'xls') {
    return '老版 Excel（.xls）无法在线预览。下载后用 Excel 打开、另存为 .xlsx 再上传，就能在这里直接看。';
  }
  return '这种格式不支持在页面里预览，请下载后用本地软件打开。';
}
