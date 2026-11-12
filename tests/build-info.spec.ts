import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readBuildId, readVersion } from '@/server/services/build-info';

/**
 * 这一组测的不是"能读出 0.1.30"，而是**读不到时不许编**。
 * 线上那次 0.1.27 事故的本质就是"报了一个没人能验证来源的数字"，
 * 所以这里重点覆盖：来源标记、降级顺序、脏数据不抛异常。
 */

const dirs: string[] = [];

function makeDir(pkg?: string) {
  const dir = mkdtempSync(path.join(tmpdir(), 'yd-build-info-'));
  dirs.push(dir);
  if (pkg !== undefined) writeFileSync(path.join(dir, 'package.json'), pkg, 'utf8');
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe('readVersion', () => {
  it('磁盘 package.json 优先于环境变量（两者冲突时以磁盘为准）', () => {
    const dir = makeDir(JSON.stringify({ version: '0.1.30' }));
    expect(readVersion(dir, { npm_package_version: '0.1.27' })).toEqual({
      version: '0.1.30',
      source: 'package.json',
    });
  });

  it('source 会明确标出来源，便于更新脚本判断可信度', () => {
    const dir = makeDir(JSON.stringify({ version: '1.2.3' }));
    expect(readVersion(dir, {}).source).toBe('package.json');
  });

  it('没有 package.json 时降级到环境变量，并把 source 标成 env', () => {
    const dir = makeDir();
    expect(readVersion(dir, { npm_package_version: '0.1.27' })).toEqual({
      version: '0.1.27',
      source: 'env',
    });
  });

  it('package.json 不是合法 JSON 时降级，而不是抛异常把健康检查打成 500', () => {
    const dir = makeDir('{ 这不是 json');
    expect(readVersion(dir, { npm_package_version: '9.9.9' })).toEqual({
      version: '9.9.9',
      source: 'env',
    });
  });

  it('version 为空串/非字符串时视为没有，继续降级', () => {
    const dir = makeDir(JSON.stringify({ version: '   ' }));
    expect(readVersion(dir, { npm_package_version: '2.0.0' }).version).toBe('2.0.0');

    const dir2 = makeDir(JSON.stringify({ version: 42 }));
    expect(readVersion(dir2, { npm_package_version: '3.0.0' }).version).toBe('3.0.0');
  });

  it('两个来源都没有时返回 unknown，不冒用任何真版本号', () => {
    const dir = makeDir();
    expect(readVersion(dir, {})).toEqual({ version: '0.0.0', source: 'unknown' });
  });

  it('version 前后的空白会被去掉（Windows 上手改 package.json 常见）', () => {
    const dir = makeDir(JSON.stringify({ version: ' 0.1.30\n' }));
    expect(readVersion(dir, {}).version).toBe('0.1.30');
  });
});

describe('readBuildId', () => {
  it('读出 .next/BUILD_ID（去掉尾部换行，next build 写的时候带换行）', () => {
    const dir = makeDir();
    mkdirSync(path.join(dir, '.next'), { recursive: true });
    writeFileSync(path.join(dir, '.next', 'BUILD_ID'), 'AbC123\n', 'utf8');
    expect(readBuildId(dir)).toBe('AbC123');
  });

  it('没有 .next/BUILD_ID 时返回空串，让调用方按"无法证明"处理，而不是伪造一个值', () => {
    expect(readBuildId(makeDir())).toBe('');
  });
});
