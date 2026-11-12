/**
 * 附件存放位置：本地磁盘 或 腾讯云对象存储（COS）。
 *
 * 为什么做成"可切换"而不是"一律上云"：
 *   - 客户的生产机可能是内网、可能没有公网出口，硬的云存储会让整个合同模块不可用；
 *   - 反过来，附件一多（扫描件 + 结算单），本地盘会成为备份与迁移的负担。
 *   所以默认仍是本地，管理员在【设置 → 对象存储】填了密钥才切到 COS。
 *
 * 三条不变式：
 *   1. **配置只从库里读**（app_settings.cos_storage），不读环境变量：改密钥是运维动作，
 *      不该逼人登服务器改 .env 再重启。环境变量只作为兜底初值。
 *   2. **SecretKey 永远不回传前端**。GET 只给"配没配 + 末四位"，前端拿不到就用不了。
 *      代价是"看不回来"，所以改配置时留空 = 不改，这一条必须写进界面文案。
 *   3. **桶里的对象键不含业务语义**（contracts/<合同 id>/<uuid>.<ext>），
 *      文件名单独存在库里的 original_name。键一旦带原始文件名，重名、乱码、
 *      超长路径都会在上传时才炸，而那时文件已经传了一半。
 */
import COS from 'cos-nodejs-sdk-v5';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { AppError } from '../http';
import { getSetting, setSetting } from '../store/settings.store';
import type { CurrentUser } from '../auth/session';

const SETTINGS_KEY = 'cos_storage';

export interface CosConfig {
  enabled: boolean;
  secret_id: string;
  secret_key: string;
  bucket: string;
  region: string;
  /** 对象键前缀，默认 contracts/（结尾必带 /） */
  key_prefix: string;
  /** 可选：CDN / 自定义加速域名，仅影响下载直链与展示，不影响上传 */
  custom_domain: string | null;
}

export interface CosConfigPublic {
  enabled: boolean;
  secret_id: string;
  /** 前端只能知道"有没有配"，拿不到值 */
  secret_key_set: boolean;
  /** 末四位，用来确认"现在用的是不是我以为的那个密钥" */
  secret_key_hint: string;
  bucket: string;
  region: string;
  key_prefix: string;
  custom_domain: string | null;
}

export interface StorageSettingsDTO {
  /** 当前实际生效的存放位置：配置齐了且启用才是 cos */
  provider: 'local' | 'cos';
  /** 已配置但没启用 / 配置不完整时的说明，界面上照实显示 */
  status: 'local' | 'cos' | 'cos_incomplete' | 'cos_disabled';
  cos: CosConfigPublic;
}

const EMPTY: CosConfig = {
  enabled: false,
  secret_id: '',
  secret_key: '',
  bucket: '',
  region: 'ap-guangzhou',
  key_prefix: 'contracts/',
  custom_domain: null,
};

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

/** 配置读出来一律走这里：库里的东西可能是半截的（填了一半保存过） */
async function readConfig(): Promise<CosConfig> {
  const raw = (await getSetting<Partial<CosConfig> | null>(SETTINGS_KEY, null)) ?? {};
  const prefix = str(raw.key_prefix) || EMPTY.key_prefix;
  return {
    enabled: raw.enabled === true,
    secret_id: str(raw.secret_id),
    secret_key: str(raw.secret_key),
    bucket: str(raw.bucket),
    region: str(raw.region) || EMPTY.region,
    key_prefix: prefix.endsWith('/') ? prefix : `${prefix}/`,
    custom_domain: str(raw.custom_domain) || null,
  };
}

/** 配置是否完整到能用。缺哪项由 `missingOf` 说清楚，不要只说"配置不完整" */
function missingOf(c: CosConfig): string[] {
  const miss: string[] = [];
  if (!c.secret_id) miss.push('SecretId');
  if (!c.secret_key) miss.push('SecretKey');
  if (!c.bucket) miss.push('存储桶');
  if (!c.region) miss.push('地域');
  return miss;
}

export async function isCosEnabled(): Promise<boolean> {
  const c = await readConfig();
  return c.enabled && missingOf(c).length === 0;
}

/** 对象键前缀（已保证以 / 结尾）。上传侧拼键用，配置读一次就够 */
export async function cosPrefix(): Promise<string> {
  return (await readConfig()).key_prefix;
}

function mask(a: string): string {
  if (!a) return '';
  return a.length <= 4 ? '••••' : `••••${a.slice(-4)}`;
}

export async function getStorageSettings(): Promise<StorageSettingsDTO> {
  const c = await readConfig();
  const missing = missingOf(c);
  const usable = c.enabled && missing.length === 0;
  return {
    provider: usable ? 'cos' : 'local',
    status: usable ? 'cos' : !c.enabled && missing.length === 0 ? 'cos_disabled' : 'cos_incomplete',
    cos: {
      enabled: c.enabled,
      secret_id: c.secret_id,
      secret_key_set: Boolean(c.secret_key),
      secret_key_hint: mask(c.secret_key),
      bucket: c.bucket,
      region: c.region,
      key_prefix: c.key_prefix,
      custom_domain: c.custom_domain,
    },
  };
}

export interface CosConfigPatch {
  enabled?: boolean;
  secret_id?: string;
  /** undefined = 不改（界面留空就是不动）；空串 = 明确清空 */
  secret_key?: string;
  bucket?: string;
  region?: string;
  key_prefix?: string;
  custom_domain?: string | null;
}

/**
 * 保存配置。
 *
 * 校验放在这里而不是 route 里：这些字段的形状是被 COS 的 URL 规则决定的，
 * 填错的结果是"上传时 403 / NoSuchBucket"，而那时代码已经跑了一半。
 * 在这里挡住，用户看到的是"存储桶名要形如 xxx-1250000000"。
 */
export async function saveStorageSettings(input: CosConfigPatch, actor: CurrentUser): Promise<StorageSettingsDTO> {
  const current = await readConfig();
  const next: CosConfig = {
    enabled: input.enabled ?? current.enabled,
    secret_id: input.secret_id !== undefined ? input.secret_id.trim() : current.secret_id,
    secret_key: input.secret_key !== undefined ? input.secret_key.trim() : current.secret_key,
    bucket: input.bucket !== undefined ? input.bucket.trim() : current.bucket,
    region: input.region !== undefined ? input.region.trim() : current.region,
    key_prefix: current.key_prefix,
    custom_domain: input.custom_domain !== undefined ? input.custom_domain : current.custom_domain,
  };

  if (input.key_prefix !== undefined) {
    // 前缀统一成"不以 / 开头、必以 / 结尾"，否则对象键会拼出 // 或变成绝对路径
    const p = input.key_prefix.trim().replace(/^\/+/, '');
    if (p.includes('..')) {
      throw new AppError(40001, '对象键前缀里不能出现 ..。', 400, { field: 'key_prefix' });
    }
    if (p && !/^[A-Za-z0-9._\-\/]+$/.test(p)) {
      throw new AppError(40001, '对象键前缀只能用字母、数字、-、_、. 和 /。', 400, { field: 'key_prefix' });
    }
    next.key_prefix = p === '' ? '' : p.endsWith('/') ? p : `${p}/`;
  }

  if (next.bucket && !/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]-\d{1,20}$/.test(next.bucket)) {
    throw new AppError(40001, '存储桶名要形如 youdee-1250000000（全小写，末尾是 APPID）。', 400, {
      field: 'bucket',
    });
  }
  if (next.region && !/^[a-z]{2,}-[a-z0-9-]{1,40}$/.test(next.region)) {
    // 真实地域都不带数字（ap-guangzhou / ap-hongkong / na-siliconvalley），
    // 所以这里不能要求以 -数字 结尾——那条规则会把正确值全挡在外面
    throw new AppError(40001, '地域要形如 ap-guangzhou / ap-shanghai / ap-beijing。', 400, { field: 'region' });
  }
  if (next.custom_domain) {
    const host = next.custom_domain.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
    if (!/^[A-Za-z0-9.-]+(:\d+)?$/.test(host)) {
      throw new AppError(40001, '自定义域名只填域名本身，例如 cdn.example.com。', 400, { field: 'custom_domain' });
    }
    next.custom_domain = host;
  }
  if (next.enabled) {
    const missing = missingOf(next);
    if (missing.length > 0) {
      throw new AppError(40001, `要启用云存储，还缺：${missing.join('、')}。`, 400, {
        field: missing[0] === 'SecretId' ? 'secret_id' : missing[0] === 'SecretKey' ? 'secret_key' : 'bucket',
      });
    }
  }

  await setSetting(SETTINGS_KEY, next, actor.id);
  invalidateClient();
  return getStorageSettings();
}

/* ── SDK 客户端 ─────────────────────────────────────────────── */

let cache: { fp: string; cos: COS } | null = null;

/** 配置一变就重建客户端：SDK 把密钥吃进实例，复用旧实例等于继续用旧密钥 */
function invalidateClient(): void {
  cache = null;
}

function clientFor(cfg: CosConfig): COS {
  const fp = createHash('sha1')
    .update(`${cfg.secret_id}|${cfg.secret_key}|${cfg.bucket}|${cfg.region}`)
    .digest('hex');
  if (cache && cache.fp === fp) return cache.cos;
  const cos = new COS({ SecretId: cfg.secret_id, SecretKey: cfg.secret_key });
  cache = { fp, cos };
  return cos;
}

async function requireClient(): Promise<{ cos: COS; cfg: CosConfig }> {
  const cfg = await readConfig();
  const missing = missingOf(cfg);
  if (!cfg.enabled || missing.length > 0) {
    throw new AppError(40901, '云存储还没配置好，先到「设置 → 对象存储」把密钥和存储桶填上。', 409);
  }
  return { cos: clientFor(cfg), cfg };
}

/** COS 的错误对象翻成人话。原样抛 Code 的话，界面上只会出现 AccessDenied 这种词 */
interface CosError {
  statusCode?: number;
  Code?: string;
  code?: string;
  Message?: string;
  message?: string;
}

function translate(e: unknown, action: string): AppError {
  const err = (e ?? {}) as CosError;
  const code = err.Code ?? err.code ?? '';
  const status = err.statusCode ?? 0;
  const known: Record<string, string> = {
    AccessDenied: '密钥没有这个桶的权限。检查子账号的策略里有没有 cos:PutObject / cos:GetObject。',
    NoSuchBucket: '找不到这个存储桶。桶名要带 APPID（形如 youdee-1250000000），地域要和创建时一致。',
    InvalidAccessKeyId: 'SecretId 不对。到腾讯云控制台「访问管理 → API 密钥管理」重新取一个。',
    SignatureDoesNotMatch: 'SecretKey 不对（或含有多余空格）。重新粘贴一次密钥。',
    RequestTimeTooSkewed: '服务器时间和腾讯云差了太多。校准一下系统时间。',
  };
  const hint = known[code];
  const base = `${action}失败${code ? `（${code}${status ? ` / HTTP ${status}` : ''}）` : ''}`;
  const detail = err.Message ?? err.message ?? '';
  return new AppError(
    50201,
    hint ? `${base}：${hint}` : `${base}${detail ? `：${detail}` : '。'} 到「设置 → 对象存储」点一次「测试连接」看具体原因。`,
    502,
    { field: 'file' },
  );
}

/** 生成对象键。不含原始文件名，理由见文件头第 3 条 */
export function buildObjectKey(prefix: string, subdir: string, name: string): string {
  const clean = subdir.replace(/^\/+|\/+$/g, '');
  return `${prefix}${clean ? `${clean}/` : ''}${name}`;
}

export interface CosPutResult {
  key: string;
  /** 直链（只用于展示/排错，下载走后端签名跳转，不把桶暴露成公开读） */
  url: string;
}

/**
 * 从临时文件流式上传。
 *
 * 用 createReadStream + ContentLength，而不是 readFile：附件已经不限大小，
 * 一个 1GB 的扫描件读进内存就是一次 OOM，而 OOM 只会表现为进程消失。
 */
export async function putFileToCos(opts: {
  filePath: string;
  sizeBytes: number;
  key: string;
  contentType: string;
  /** 下载时默认的文件名（浏览器另存为时用） */
  originalName: string;
}): Promise<CosPutResult> {
  const { cos, cfg } = await requireClient();
  try {
    await new Promise<void>((resolve, reject) => {
      cos.putObject(
        {
          Bucket: cfg.bucket,
          Region: cfg.region,
          Key: opts.key,
          Body: createReadStream(opts.filePath),
          ContentLength: opts.sizeBytes,
          ContentType: opts.contentType,
          // 对象元数据里记下原始文件名：以后要批量导出时不用回库查
          ContentDisposition: `attachment; filename*=UTF-8''${encodeURIComponent(opts.originalName)}`,
        },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  } catch (e) {
    throw translate(e, '上传到对象存储');
  }
  const host = cfg.custom_domain ?? `${cfg.bucket}.cos.${cfg.region}.myqcloud.com`;
  return { key: opts.key, url: `https://${host}/${opts.key}` };
}

/**
 * 预签名下载地址。
 *
 * 为什么不把桶设成公有读：合同是内部凭据，公有读等于"链接一泄全泄"，
 * 而链接会出现在浏览器历史、转发消息、截图里。预签名 5 分钟过期，
 * 泄露了也基本没用；代价是每次打开都多一次 302，可以接受。
 */
export async function presignCosDownload(opts: {
  key: string;
  /** 附件（Office）要下载，图片/PDF 可以内联 */
  attachment: boolean;
  fileName: string;
  contentType: string;
  expiresSeconds?: number;
}): Promise<string> {
  const { cos, cfg } = await requireClient();
  const disposition = `${opts.attachment ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(opts.fileName)}`;
  try {
    const url = await new Promise<string>((resolve, reject) => {
      cos.getObjectUrl(
        {
          Bucket: cfg.bucket,
          Region: cfg.region,
          Key: opts.key,
          Sign: true,
          Protocol: 'https:',
          Expires: opts.expiresSeconds ?? 300,
          Query: {
            'response-content-disposition': disposition,
            'response-content-type': opts.contentType,
          },
        },
        (err, data) => (err ? reject(err) : resolve(data?.Url ?? '')),
      );
    });
    if (!url) throw new Error('empty url');
    // 自定义域名：把默认的 <bucket>.cos.<region>.myqcloud.com 换掉，
    // 但签名是按 host 无关的（COS 签名只覆盖路径与参数），换域名不影响校验
    if (cfg.custom_domain) {
      return url.replace(/^https?:\/\/[^/]+/i, `https://${cfg.custom_domain}`);
    }
    return url;
  } catch (e) {
    throw translate(e, '生成下载地址');
  }
}

/**
 * 测试连接：真的传一个 8 字节的小对象再删掉。
 *
 * 只做 getBucket（列举）不够——子账号经常被给"只读"策略，
 * 列举成功但上传 403，而用户以为配好了，直到真正传合同时才失败。
 */
export async function testCosConnection(input?: Partial<CosConfigPatch>): Promise<{
  ok: true;
  bucket: string;
  region: string;
  latency_ms: number;
  note: string;
}> {
  const current = await readConfig();
  const merged: CosConfig = {
    enabled: true,
    secret_id: input?.secret_id !== undefined ? input.secret_id.trim() : current.secret_id,
    secret_key: input?.secret_key !== undefined && input.secret_key !== '' ? input.secret_key.trim() : current.secret_key,
    bucket: input?.bucket !== undefined ? input.bucket.trim() : current.bucket,
    region: input?.region !== undefined ? input.region.trim() : current.region,
    key_prefix: current.key_prefix,
    custom_domain: current.custom_domain,
  };
  const missing = missingOf(merged);
  if (missing.length > 0) {
    throw new AppError(40001, `还缺：${missing.join('、')}。填完再测。`, 400, {
      field: missing[0] === 'SecretId' ? 'secret_id' : missing[0] === 'SecretKey' ? 'secret_key' : 'bucket',
    });
  }

  const cos = new COS({ SecretId: merged.secret_id, SecretKey: merged.secret_key });
  const key = buildObjectKey(merged.key_prefix, '_connection_test', `${Date.now()}.txt`);
  const started = Date.now();
  try {
    await new Promise<void>((resolve, reject) => {
      cos.putObject(
        {
          Bucket: merged.bucket,
          Region: merged.region,
          Key: key,
          Body: Buffer.from('youdee storage check'),
          ContentType: 'text/plain',
        },
        (err) => (err ? reject(err) : resolve()),
      );
    });
  } catch (e) {
    throw translate(e, '测试写入');
  }
  // 探针对象自己收拾掉。删不掉不影响结论（写入已经成功），但要如实说一句
  let note = '读写都正常。';
  try {
    await new Promise<void>((resolve, reject) => {
      cos.deleteObject({ Bucket: merged.bucket, Region: merged.region, Key: key }, (err) =>
        err ? reject(err) : resolve(),
      );
    });
  } catch {
    note = `写入成功，但测试对象删不掉（${key}），可能是密钥没有 cos:DeleteObject 权限——不影响上传，记得偶尔清一下。`;
  }
  return {
    ok: true,
    bucket: merged.bucket,
    region: merged.region,
    latency_ms: Date.now() - started,
    note,
  };
}
