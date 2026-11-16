/**
 * 发票识别（腾讯云 OCR）的密钥配置。
 *
 * 三条不变式（与「设置 → 对象存储」同一套做法，不另发明）：
 *   1. **配置只从库里读**（app_settings.ocr），不读环境变量：改密钥是运维动作，
 *      不该逼人登服务器改 .env 再重启。
 *   2. **SecretKey 永远不回传前端**。GET 只给"配没配 + 末四位"，
 *      所以 PATCH 时留空 = 不改，这一条必须写进界面文案。
 *   3. **默认复用对象存储的那对密钥**：客户已经在用 COS，再让他去控制台
 *      新建一个子账号只是多一道坎。OCR 与 COS 用的是同一个腾讯云账号体系，
 *      一对密钥足够；要分开管就在设置页填自己的那一对（覆盖）。
 *
 * 为什么"未配置"要用 409 而不是 400：这不是用户填错了，是**功能还没开通**。
 * 前端拿到 409 + 那句话就去引导"到设置里填密钥"，而 400 会被读成"你这次操作有问题"。
 */
import { AppError } from '../http';
import { getSetting, setSetting } from '../store/settings.store';
import type { CurrentUser } from '../auth/session';

/** app_settings 的键。与 storage.service 的 'cos_storage' 并列 */
const SETTINGS_KEY = 'ocr';
/** 复用对象存储密钥时要读的那个键（storage.service 没导出读函数，这里只读不写） */
const COS_SETTINGS_KEY = 'cos_storage';
const DEFAULT_REGION = 'ap-guangzhou';

interface OcrOwnConfig {
  enabled: boolean;
  secret_id: string;
  secret_key: string;
  region: string;
}

export interface OcrSettingsDTO {
  /** 开关。关掉后上传识别直接 409，不花 OCR 的钱 */
  enabled: boolean;
  /** 实际生效的 SecretId（自己的或复用对象存储那个） */
  secret_id: string;
  /** 前端只能知道"有没有配"，拿不到值 */
  secret_key_set: boolean;
  /** 末四位，用来确认"现在用的是不是我以为的那个密钥" */
  secret_key_hint: string;
  region: string;
}

/** 服务端内部用的完整配置（含明文密钥）。**绝不返回给前端** */
export interface OcrRuntimeConfig {
  secretId: string;
  secretKey: string;
  region: string;
  /** own = 本模块自己配的；cos_storage = 复用对象存储那一对 */
  source: 'own' | 'cos_storage';
}

const EMPTY: OcrOwnConfig = { enabled: false, secret_id: '', secret_key: '', region: DEFAULT_REGION };

function str(v: unknown): string {
  return typeof v === 'string' ? v.trim() : '';
}

async function readOwn(): Promise<OcrOwnConfig> {
  const raw = (await getSetting<Partial<OcrOwnConfig> | null>(SETTINGS_KEY, null)) ?? {};
  return {
    enabled: raw.enabled === true,
    secret_id: str(raw.secret_id),
    secret_key: str(raw.secret_key),
    region: str(raw.region) || DEFAULT_REGION,
  };
}

/** 对象存储那一对密钥（只读、只在服务端用） */
async function readCosKeys(): Promise<{ secret_id: string; secret_key: string; region: string }> {
  const raw = (await getSetting<{ secret_id?: unknown; secret_key?: unknown; region?: unknown } | null>(
    COS_SETTINGS_KEY,
    null,
  )) ?? {};
  return { secret_id: str(raw.secret_id), secret_key: str(raw.secret_key), region: str(raw.region) };
}

function mask(key: string): string {
  if (!key) return '';
  return key.length <= 4 ? '••••' : `••••${key.slice(-4)}`;
}

/**
 * 解析出真正要用的密钥。自己的优先，没有才回落对象存储那一对。
 *
 * 注意两者必须**成对**取：只取到 SecretId、SecretKey 依旧用另一个来源的，
 * 腾讯云会返回 `AuthFailure.SignatureFailure`，而那句错误码对用户毫无意义。
 */
export async function resolveOcrConfig(): Promise<OcrRuntimeConfig | null> {
  const own = await readOwn();
  if (own.secret_id && own.secret_key) {
    return { secretId: own.secret_id, secretKey: own.secret_key, region: own.region, source: 'own' };
  }
  const cos = await readCosKeys();
  if (cos.secret_id && cos.secret_key) {
    return {
      secretId: cos.secret_id,
      secretKey: cos.secret_key,
      region: own.region || cos.region || DEFAULT_REGION,
      source: 'cos_storage',
    };
  }
  return null;
}

/** 上传入口用它判断"要不要进识别链路"。未开通时路由直接 409，不读文件不花钱 */
export async function isOcrEnabled(): Promise<boolean> {
  const own = await readOwn();
  if (!own.enabled) return false;
  return (await resolveOcrConfig()) !== null;
}

/**
 * 读配置给界面。`secret_key` 字段**不存在**于返回值里（不是空串，是没有这个键）——
 * 少一个键比"传空串但心里知道它是密钥"更难被误用。
 */
export async function getOcrSettings(): Promise<OcrSettingsDTO> {
  const own = await readOwn();
  const runtime = await resolveOcrConfig();
  return {
    enabled: own.enabled,
    secret_id: runtime?.secretId ?? '',
    secret_key_set: runtime !== null,
    secret_key_hint: mask(runtime?.secretKey ?? ''),
    region: own.region,
  };
}

export interface OcrSettingsPatch {
  enabled?: boolean;
  secret_id?: string;
  /** undefined = 不改（界面留空就是不动）；空串 = 明确清空 */
  secret_key?: string;
  region?: string;
}

/**
 * 保存配置。
 *
 * 校验放在这里而不是 route：region 的格式是被腾讯云的 endpoint 规则决定的，
 * 填错的结果是"上传时才 502"，而那时用户已经传了 20 张。
 */
export async function saveOcrSettings(input: OcrSettingsPatch, actor: CurrentUser): Promise<OcrSettingsDTO> {
  const current = await readOwn();
  const next: OcrOwnConfig = {
    enabled: input.enabled ?? current.enabled,
    secret_id: input.secret_id !== undefined ? input.secret_id.trim() : current.secret_id,
    secret_key: input.secret_key !== undefined ? input.secret_key.trim() : current.secret_key,
    region: input.region !== undefined ? input.region.trim() || DEFAULT_REGION : current.region,
  };

  if (!/^[a-z]{2,}-[a-z0-9-]{1,40}$/.test(next.region)) {
    throw new AppError(40001, '地域要形如 ap-guangzhou / ap-shanghai / ap-beijing。', 400, { field: 'region' });
  }
  if (next.secret_id && !/^[A-Za-z0-9]{10,64}$/.test(next.secret_id)) {
    throw new AppError(40001, 'SecretId 形如 AKIDxxxxxxxxxxxxxxxxxxxxxxxx，检查是不是粘错了。', 400, {
      field: 'secret_id',
    });
  }

  // 只填了 SecretId 没填 SecretKey（且对象存储也没有可复用的）→ 明确告诉他还缺什么。
  // 不拦的话，保存会成功、上传时才 409，而人以为自己已经配好了。
  const cos = await readCosKeys();
  const keyReady = Boolean(next.secret_key) || Boolean(cos.secret_key);
  if (next.enabled && (!next.secret_id || !keyReady)) {
    throw new AppError(
      40001,
      keyReady
        ? '要启用识别，还得填 SecretId（或先在「设置 → 对象存储」配好那一对密钥）。'
        : '要启用识别，还得填 SecretKey。SecretKey 只在保存时提交一次，之后再也不会显示出来。',
      400,
      { field: next.secret_id ? 'secret_key' : 'secret_id' },
    );
  }

  await setSetting(SETTINGS_KEY, next, actor.id);
  return getOcrSettings();
}

/**
 * 上传链路用：拿不到配置就抛 409。
 *
 * 文案与 Spec §5.4 逐字一致 —— 前端在打开上传框前会先用同一个「未配置」判断把按钮置灰，
 * 两处说的必须是同一句话，否则用户会看到两种不同的解释。
 */
export async function requireOcrConfig(): Promise<OcrRuntimeConfig> {
  const own = await readOwn();
  const runtime = await resolveOcrConfig();
  if (!own.enabled || !runtime) {
    throw new AppError(
      40901,
      '发票识别还没配置。到「设置 → 发票识别」填腾讯云密钥（默认用对象存储那一对）。',
      409,
    );
  }
  return runtime;
}

export const OCR_DEFAULT_REGION = DEFAULT_REGION;
