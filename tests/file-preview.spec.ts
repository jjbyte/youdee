import { describe, expect, it } from 'vitest';
import { canPreview, previewBlockedHint, previewKind } from '@/lib/file-preview';

describe('previewKind', () => {
  it('浏览器原生的两类：PDF 与图片', () => {
    expect(previewKind('pdf')).toBe('pdf');
    expect(previewKind('jpg')).toBe('image');
    expect(previewKind('jpeg')).toBe('image');
    expect(previewKind('png')).toBe('image');
    expect(previewKind('webp')).toBe('image');
  });

  it('需要解析的两类：docx / xlsx', () => {
    expect(previewKind('docx')).toBe('docx');
    expect(previewKind('xlsx')).toBe('sheet');
  });

  it('老版二进制格式解析不了，只能下载', () => {
    expect(previewKind('doc')).toBe('none');
    expect(previewKind('xls')).toBe('none');
    expect(previewKind('zip')).toBe('none');
    expect(previewKind('')).toBe('none');
    expect(previewKind(null)).toBe('none');
  });

  it('大小写与前导点都能认', () => {
    expect(previewKind('PDF')).toBe('pdf');
    expect(previewKind('.Docx')).toBe('docx');
    expect(previewKind('.xlsx')).toBe('sheet');
  });
});

describe('canPreview', () => {
  it('与 previewKind 一一对应，不存在“按钮说能看、点开让你下载”的错位', () => {
    for (const ext of ['pdf', 'jpg', 'png', 'webp', 'docx', 'xlsx', 'doc', 'xls', 'txt']) {
      expect(canPreview(ext)).toBe(previewKind(ext) !== 'none');
    }
  });
});

describe('previewBlockedHint', () => {
  it('老格式要告诉用户具体怎么办，而不是一句“不支持”', () => {
    expect(previewBlockedHint('doc')).toContain('.docx');
    expect(previewBlockedHint('xls')).toContain('.xlsx');
    // 不认识的后缀给通用说法，但也必须提到下载
    expect(previewBlockedHint('zip')).toContain('下载');
  });
});
