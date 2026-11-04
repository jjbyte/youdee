/**
 * 口令哈希与校验（零依赖，只用 node:crypto scrypt）。
 *
 * 为什么不用 bcrypt：需要编译原生模块，客户是 Windows 环境，装机成本大于收益。
 * scrypt 是 RFC 7914 标准算法，N=16384 时单次约 60-90ms，足够对抗离线爆破。
 *
 * 存储格式：scrypt$N$r$p$base64url(salt)$base64url(hash)
 * 带参数存储是为了将来调参后老口令仍可校验（校验时按存储的参数重算）。
 */
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/** promisify 会丢掉 scrypt 的 options 重载，这里手写一层，避免参数被静默忽略 */
function scrypt(password: string, salt: Buffer, keylen: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password, salt, keylen, options, (err, derived) => {
      if (err) reject(err);
      else resolve(derived as Buffer);
    });
  });
}

const N = 16_384;
const R = 8;
const P = 1;
const KEYLEN = 64;

export async function hashPassword(plain: string): Promise<string> {
  if (!plain || plain.length < 8) {
    throw new Error('口令至少 8 位');
  }
  const salt = randomBytes(16);
  const derived = await scrypt(plain, salt, KEYLEN, { N, r: R, p: P });
  return ['scrypt', N, R, P, salt.toString('base64url'), derived.toString('base64url')].join('$');
}

export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (!Number.isFinite(n) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const salt = Buffer.from(parts[4]!, 'base64url');
  const expected = Buffer.from(parts[5]!, 'base64url');
  const derived = await scrypt(plain, salt, expected.length, { N: n, r, p });
  if (derived.length !== expected.length) return false;
  return timingSafeEqual(derived, expected);
}
