/**
 * 报价单模板的**版式定义**：从管理员上传的 Excel 解析成结构化 JSON。
 *
 * 为什么不让 xlsx 直接当打印底版——
 * 客户版 PDF 与 xlsx 现在读同一份模型（`customer-sheet.ts`），这是「打印和 Excel
 * 一致」唯一可靠的实现方式。一旦 xlsx 单独拿底版回填，两条输出路必然漂移，
 * 而且要等客户把 PDF 和 Excel 并排放在一起才会被发现。所以 Excel 只承担一件事：
 * **描述列怎么排、表头写什么、抬头怎么摆**，内容仍然由系统填。
 *
 * 本文件不碰 exceljs：输入是已经摊平的单元格网格（`RawSheet`），
 * 因此可以脱离文件系统做单测。
 *
 * 协议（管理员在 Excel 里看到的就是这些中文词）：
 *   抬头  `{{客户名称}}` 等，可在一格里与固定文字混排，如 `客户名称：{{客户名称}}`
 *   表头  `{{序号}} {{项目}} {{规格}} {{单位}} {{数量}} {{单价}} {{小计}} {{备注}}`
 *         出现顺序即列序；要改列名写成 `{{项目:服务项目}}`
 */

/** 列身份。与 `customer-sheet.ts` 的 SheetColumn.key 是同一套 */
export type TemplateColumnKey = 'no' | 'name' | 'spec' | 'unit' | 'qty' | 'unitPrice' | 'amount' | 'remark';

export type SheetAlign = 'left' | 'right' | 'center';

export interface TemplateColumn {
  key: TemplateColumnKey;
  /** 表头显示的文字。默认取中文别名本身，可用 `{{项目:服务项目}}` 覆盖 */
  header: string;
  /** Excel 列宽（字符数），HTML 侧按占比换算，两边比例因此一致 */
  width: number;
}

export interface TemplateMetaCell {
  /** 原文，含 `{{占位符}}`。渲染时才替换成单据里的值 */
  text: string;
  colSpan: 1 | 2;
  align: SheetAlign;
  bold: boolean;
}

export interface TemplateMetaRow {
  /**
   * title / subtitle 是抬头区开头连续的单格行（大标题、副标题）；
   * line 是普通抬头行，一到两格。
   */
  kind: 'title' | 'subtitle' | 'line';
  cells: TemplateMetaCell[];
}

export interface TemplateLayout {
  version: 1;
  columns: TemplateColumn[];
  meta: TemplateMetaRow[];
}

/** exceljs 读出来摊平后的一个非空单元格 */
export interface RawCell {
  /** 1-based */
  row: number;
  /** 1-based */
  col: number;
  text: string;
  /** 合并后跨的列数；未合并为 1 */
  colSpan: number;
  bold: boolean;
  centered: boolean;
}

export interface RawSheet {
  cells: RawCell[];
  /** 每列宽度（字符数），下标 0 对应第 1 列 */
  colWidths: number[];
  /** 表格实际用到的最右列（1-based） */
  maxCol: number;
}

export interface LayoutIssue {
  level: 'error' | 'warn';
  /** 定位，如「抬头 B3」「表头 E1」 */
  where: string;
  message: string;
}

/** 抬头里允许出现的占位符。不在这里的一律拒绝——静默忽略会让客户版少印一行 */
export const META_PLACEHOLDERS = [
  '报价单号',
  '版本',
  '供应商名称',
  '客户名称',
  '项目名称',
  '报价日期',
  '活动日期',
  '报价有效期',
  '税口径',
  '报价人',
  '联系电话',
  '公司名称',
  '公司地址',
  '公司电话',
] as const;

export type MetaPlaceholder = (typeof META_PLACEHOLDERS)[number];

/** 列别名 → 列身份。管理员写中文最自然，英文 key 也认，避免样例被改坏后没人会修 */
const COLUMN_ALIASES: Record<string, TemplateColumnKey> = {
  序号: 'no',
  项目: 'name',
  名称: 'name',
  服务项目: 'name',
  规格: 'spec',
  型号: 'spec',
  单位: 'unit',
  数量: 'qty',
  单价: 'unitPrice',
  小计: 'amount',
  金额: 'amount',
  备注: 'remark',
  说明: 'remark',
  no: 'no',
  name: 'name',
  spec: 'spec',
  unit: 'unit',
  qty: 'qty',
  unitPrice: 'unitPrice',
  amount: 'amount',
  remark: 'remark',
};

export const DEFAULT_HEADER: Record<TemplateColumnKey, string> = {
  no: '序号',
  name: '项目',
  spec: '规格',
  unit: '单位',
  qty: '数量',
  unitPrice: '单价',
  amount: '小计',
  remark: '备注',
};

/** 缺了这三列，这张表在客户眼里就是算不平或看不懂 */
const REQUIRED_COLUMNS: TemplateColumnKey[] = ['name', 'qty', 'amount'];

/** 客户版不许出现的词。模板是新增的注入面，这层必须自己守住 */
const FORBIDDEN_WORDS = ['成本', '毛利', '加价', '利润', '参考最低价', '最低价', '供应商报价', '进价', '底价', '折扣率'];

const MAX_COLUMNS = 8;
const MIN_COLUMNS = 3;

const FULL_RE = /^\s*\{\{\s*([^{}]*?)\s*\}\}\s*$/;
const PH_RE = /\{\{\s*([^{}]*?)\s*\}\}/g;

export function placeholderNames(text: string): string[] {
  const out: string[] = [];
  PH_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PH_RE.exec(text)) !== null) out.push(m[1]!.trim());
  return out;
}

/** 1 → A, 27 → AA */
export function colLetter(n: number): string {
  let s = '';
  let v = Math.max(1, Math.trunc(n));
  while (v > 0) {
    const r = (v - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    v = Math.floor((v - 1) / 26);
  }
  return s;
}

function ref(c: { row: number; col: number }): string {
  return `${colLetter(c.col)}${c.row}`;
}

function clampWidth(w: unknown): number {
  const n = Number(w);
  if (!Number.isFinite(n) || n <= 0) return 12;
  return Math.round(Math.min(40, Math.max(5, n)) * 10) / 10;
}

function splitHeader(inner: string): { name: string; label: string | null } {
  const i = inner.search(/[:：]/);
  if (i === -1) return { name: inner.trim(), label: null };
  return { name: inner.slice(0, i).trim(), label: inner.slice(i + 1).trim() || null };
}

/** 这一格有没有横跨表格中线——跨了就是「整行一格」，没跨就是普通的一栏 */
function coversMiddle(c: RawCell, maxCol: number): boolean {
  const mid = maxCol / 2;
  return c.col <= mid && c.col + c.colSpan - 1 > mid;
}

function groupByRow(cells: RawCell[]): Map<number, RawCell[]> {  const map = new Map<number, RawCell[]>();
  for (const c of cells) {
    const arr = map.get(c.row);
    if (arr) arr.push(c);
    else map.set(c.row, [c]);
  }
  for (const arr of map.values()) arr.sort((a, b) => a.col - b.col);
  return map;
}

/**
 * 解析一张摊平的模板表。
 *
 * 判错的原则：**宁可拒绝，也不猜**。模板错了会静默印出错的单，
 * 而错单是客户拿去申请预算的东西，比报错难收拾得多。
 */
export function parseTemplateSheet(raw: RawSheet): { layout: TemplateLayout | null; issues: LayoutIssue[] } {
  const issues: LayoutIssue[] = [];
  const rows = groupByRow(raw.cells);

  // ── 禁用词先扫一遍：命中就不必往下解析了 ──
  for (const c of raw.cells) {
    for (const w of FORBIDDEN_WORDS) {
      if (c.text.includes(w)) {
        issues.push({
          level: 'error',
          where: ref(c),
          message: `出现了「${w}」。客户版不允许出现成本、毛利、加价这类内部口径，这一格必须删掉。`,
        });
      }
    }
  }

  // ── 找表头行：第一行里有两个以上整格占位符的 ──
  let headerRow = -1;
  for (const r of [...rows.keys()].sort((a, b) => a - b)) {
    const count = rows.get(r)!.filter((c) => FULL_RE.test(c.text)).length;
    if (count >= 2) {
      headerRow = r;
      break;
    }
  }
  if (headerRow < 0) {
    issues.push({
      level: 'error',
      where: '整张表',
      message:
        '没找到明细表头。表头行每格要写一个列占位符（例如 {{序号}} {{项目}} {{数量}} {{小计}}），至少两个，系统靠它认列。',
    });
    return { layout: null, issues };
  }

  // ── 解析列 ──
  const columns: TemplateColumn[] = [];
  const seen = new Set<TemplateColumnKey>();
  for (const c of rows.get(headerRow)!) {
    const m = FULL_RE.exec(c.text);
    if (!m) {
      if (c.text.trim()) {
        issues.push({
          level: 'warn',
          where: ref(c),
          message: `表头里的「${c.text.trim()}」不是占位符，这一列被忽略。要当列用请写成 {{列名}}。`,
        });
      }
      continue;
    }
    const { name, label } = splitHeader(m[1]!);
    const key = COLUMN_ALIASES[name];
    if (!key) {
      issues.push({
        level: 'error',
        where: ref(c),
        message: `{{${name}}} 不是可用的列。可用的有：序号、项目、规格、单位、数量、单价、小计、备注。`,
      });
      continue;
    }
    if (seen.has(key)) {
      issues.push({ level: 'error', where: ref(c), message: `「${DEFAULT_HEADER[key]}」出现了两次，一列只能出现一次。` });
      continue;
    }
    seen.add(key);
    columns.push({ key, header: label ?? DEFAULT_HEADER[key], width: clampWidth(raw.colWidths[c.col - 1]) });
  }

  for (const key of REQUIRED_COLUMNS) {
    if (!seen.has(key)) {
      issues.push({
        level: 'error',
        where: '表头',
        message: `缺少「${DEFAULT_HEADER[key]}」列。这三列（项目、数量、小计）缺一个，客户就看不出这笔钱是怎么算的。`,
      });
    }
  }
  if (columns.length > MAX_COLUMNS) {
    issues.push({
      level: 'error',
      where: '表头',
      message: `一共 ${columns.length} 列，超过 ${MAX_COLUMNS} 列。A4 纵向装不下更多，删几列或者把纸改成更紧凑的版式。`,
    });
  }
  if (columns.length > 0 && columns.length < MIN_COLUMNS) {
    issues.push({ level: 'error', where: '表头', message: `只认出 ${columns.length} 列，至少要有项目、数量、小计三列。` });
  }

  // ── 解析抬头 ──
  const meta: TemplateMetaRow[] = [];
  let leadingSingles = 0;
  let closedLeading = false;

  for (const r of [...rows.keys()].filter((x) => x < headerRow).sort((a, b) => a - b)) {
    const cells = rows.get(r)!;
    if (cells.length > 2) {
      issues.push({
        level: 'error',
        where: `第 ${r} 行`,
        message: `抬头一行里有 ${cells.length} 个格子，最多两个。把相邻的合并成一格，或者拆成两行。`,
      });
      continue;
    }
    const each: TemplateMetaCell[] = cells.map((c) => ({
      text: c.text,
      /**
       * 一格是否占满整宽，看它有没有跨过表格中线。
       * 不能只看「跨的列数够不够一半」——抬头左右两栏各占一半时，
       * 左格跨了 4 列（正好一半）却被判成整宽，右格就会被挤到下一行。
       */
      colSpan: cells.length === 1 || coversMiddle(c, raw.maxCol) ? 2 : 1,
      align: c.centered ? 'center' : 'left',
      bold: c.bold,
    }));

    let kind: TemplateMetaRow['kind'] = 'line';
    if (cells.length === 1 && !closedLeading) {
      if (leadingSingles === 0) kind = 'title';
      else if (leadingSingles === 1) kind = 'subtitle';
      else kind = 'line';
      leadingSingles += 1;
    } else {
      // 一旦出现两格的行，后面再出现的单格行都只是普通整行行，不再当标题
      closedLeading = true;
    }

    // 渲染时列宽只有两格可用，单格行强制占满
    if (cells.length === 1 && each[0]) each[0].colSpan = 2;
    meta.push({ kind, cells: each });
  }

  if (meta.length === 0) {
    issues.push({ level: 'warn', where: '抬头', message: '抬头区是空的。这样出单只有标题和表格，客户看不出是给谁做的。' });
  }

  // ── 抬头占位符白名单 ──
  const allowed = new Set<string>(META_PLACEHOLDERS);
  for (const row of meta) {
    for (const cell of row.cells) {
      for (const name of placeholderNames(cell.text)) {
        if (!allowed.has(name)) {
          issues.push({
            level: 'error',
            where: `抬头「${cell.text.slice(0, 12)}…」`,
            message: `{{${name}}} 不是可用的抬头字段。可用的有：${META_PLACEHOLDERS.join('、')}。`,
          });
        }
      }
    }
  }

  const hasError = issues.some((i) => i.level === 'error');
  if (hasError) return { layout: null, issues };

  return { layout: { version: 1, columns, meta }, issues };
}
