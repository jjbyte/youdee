import { describe, expect, it } from 'vitest';
import { buildObjectKey } from '@/server/services/storage.service';

const UUID = '2a6ba4d1-97b9-4054-abbc-ceb20aff778a';

describe('buildObjectKey', () => {
  it('默认前缀 contracts/ + 合同 id → 只出现一次 contracts', () => {
    expect(buildObjectKey('contracts/', UUID, 'x.pdf')).toBe(`contracts/${UUID}/x.pdf`);
  });

  it('调用方仍传 contracts/<合同 id> 时也不重复（线上出现过的写法）', () => {
    expect(buildObjectKey('contracts/', `contracts/${UUID}`, 'x.pdf')).toBe(`contracts/${UUID}/x.pdf`);
  });

  it('前缀自己没带尾斜杠也不粘成 contractsxxx', () => {
    expect(buildObjectKey('contracts', UUID, 'x.pdf')).toBe(`contracts/${UUID}/x.pdf`);
    expect(buildObjectKey('/contracts/', UUID, 'x.pdf')).toBe(`contracts/${UUID}/x.pdf`);
  });

  it('换了前缀就是换根目录：子目录里的 contracts 属于业务分类，保留', () => {
    expect(buildObjectKey('youdee/', `contracts/${UUID}`, 'x.pdf')).toBe(
      `youdee/contracts/${UUID}/x.pdf`,
    );
  });

  it('多段前缀整段比对，不会把同名开头吃掉', () => {
    expect(buildObjectKey('youdee/prod/', 'youdee/prod/x', 'a.txt')).toBe('youdee/prod/x/a.txt');
    expect(buildObjectKey('youdee/prod/', 'youdee/production', 'a.txt')).toBe(
      'youdee/prod/youdee/production/a.txt',
    );
    expect(buildObjectKey('contracts/', 'contracts-old/x', 'a.txt')).toBe(
      'contracts/contracts-old/x/a.txt',
    );
  });

  it('子目录前后多余斜杠归一；子目录为空时直接落在前缀下', () => {
    expect(buildObjectKey('contracts/', `/${UUID}/`, 'x.pdf')).toBe(`contracts/${UUID}/x.pdf`);
    expect(buildObjectKey('contracts/', '', 'x.txt')).toBe('contracts/x.txt');
    expect(buildObjectKey('', UUID, 'x.pdf')).toBe(`${UUID}/x.pdf`);
  });

  it('连接测试用的 _connection_test 也走常规定义', () => {
    expect(buildObjectKey('contracts/', '_connection_test', '1.txt')).toBe(
      'contracts/_connection_test/1.txt',
    );
  });
});
