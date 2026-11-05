import { describe, expect, it } from 'vitest';
import { canArchive, canDeleteRecord, ROLE_CAPABILITIES } from '../src/domain/permissions';
import { canRestore, canVoid } from '../src/domain/quote-status';

/**
 * 这一组测的是 2026-11-05 客户提的权限边界：
 *   管理员能删（含已发出的报价单）；成员不能删，但能作废和恢复。
 *
 * 为什么值得单开一个文件：这条边界一旦松动，错的方式是"成员点到了删除按钮"
 * 或者"成员建错的草稿永远清不掉"，两种都不会在类型检查或页面上暴露出来，
 * 只会等到有人真的点错那一下。
 */
describe('删除 vs 作废的权限分界', () => {
  it('删除只有管理员能做', () => {
    expect(canDeleteRecord('admin')).toBe(true);
    expect(canDeleteRecord('member')).toBe(false);
  });

  it('作废 / 恢复两种角色都能做', () => {
    expect(canArchive('admin')).toBe(true);
    expect(canArchive('member')).toBe(true);
  });

  it('能力清单里"作废/恢复"对成员是开的，"删除"是关的', () => {
    const archive = ROLE_CAPABILITIES.find((c) => c.label.includes('作废'));
    const del = ROLE_CAPABILITIES.find((c) => c.label.includes('删除'));
    expect(archive?.member).toBe(true);
    expect(del?.member).toBe(false);
  });
});

describe('报价单状态机：草稿也能作废', () => {
  it('草稿可作废（否则成员建错一张单就永远清不掉）', () => {
    expect(canVoid('draft')).toBe(true);
  });

  it('已发出可作废', () => {
    expect(canVoid('issued')).toBe(true);
  });

  it('已作废不能再作废（不能把恢复的可能性叠两次）', () => {
    expect(canVoid('void')).toBe(false);
  });

  it('只有已作废的能恢复', () => {
    expect(canRestore('void')).toBe(true);
    expect(canRestore('draft')).toBe(false);
    expect(canRestore('issued')).toBe(false);
  });
});
