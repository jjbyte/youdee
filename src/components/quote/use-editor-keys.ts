'use client';
import { useEffect } from 'react';

/**
 * 编辑器的全局键盘层（§C.7）。
 *
 * 只做**表格里那些重复劳动**：复制、移行、删、撤销、出单、预览。
 * 一个报价单几十行，鼠标点每一行的「复制」是纯体力活；键盘能不能干这事，
 * 决定用户是一天出 3 单还是 10 单。
 *
 * 三条纪律：
 *   ① 正在打字时**不许抢键**。焦点在文本框里，Delete 就是删字符、⌘Z 就是撤字符——
 *      抢过来撤销一次删行会让用户以为自己删了一行（其实只是删了个 0）。
 *   ② 有弹窗时**全部暂停**。弹窗里按 ⌘D 复制的是空气，用户看不到任何反馈。
 *   ③ 拦掉浏览器默认行为只在我们真处理了的时候。⌘D 在 Chrome 是「加书签」，
 *      我们不 preventDefault 就会弹出书签框——那比没有快捷键更让人困惑。
 */

export interface EditorKeyOptions {
  /** 顺序即当前 sortOrder——用来判断「还能不能再往上」 */
  lineIds: string[];
  selectedIds: ReadonlySet<string>;
  /** 有弹窗/抽屉打开，或单据已发出（只读）时为 false */
  enabled: boolean;
  canUndo: boolean;
  onDuplicate: (lineId: string) => void;
  onMove: (lineId: string, dir: -1 | 1) => void;
  onDelete: (lineId: string) => void;
  onUndo: () => void;
  onIssue: () => void;
  onPreview: () => void;
  /** ⌘S：不保存（服务端每次改动都落了库），只回一句人话，顺手拦掉浏览器「另存为网页」 */
  onAutosaveHint: () => void;
}

const TEXTUAL_INPUT_TYPES = new Set([
  '',
  'text',
  'number',
  'search',
  'email',
  'tel',
  'url',
  'password',
  'date',
  'datetime-local',
]);

/** 焦点是否在「会吃掉按键」的控件里 */
function isTyping(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  if (tag !== 'INPUT') return false;
  return TEXTUAL_INPUT_TYPES.has((el as HTMLInputElement).type);
}

/** 焦点所在的行；没有就退回「只勾了一行」的那一行。两个都没有 → 不动 */
function currentLineId(selectedIds: ReadonlySet<string>): string | null {
  const el = document.activeElement;
  if (el instanceof HTMLElement) {
    const tr = el.closest('[data-line-id]');
    if (tr instanceof HTMLElement && tr.dataset.lineId) return tr.dataset.lineId;
  }
  if (selectedIds.size === 1) return Array.from(selectedIds)[0] ?? null;
  return null;
}

export function useEditorKeys(opts: EditorKeyOptions) {
  const {
    lineIds,
    selectedIds,
    enabled,
    canUndo,
    onDuplicate,
    onMove,
    onDelete,
    onUndo,
    onIssue,
    onPreview,
    onAutosaveHint,
  } = opts;

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (!enabled) return;
      const mod = e.metaKey || e.ctrlKey;
      const typing = isTyping(document.activeElement);

      // ── 有 ⌘ 的组合键：文本框里也认（它们不出字符），但 ⌘Z 除外 ──
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        onAutosaveHint();
        return;
      }
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        onIssue();
        return;
      }
      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        onPreview();
        return;
      }
      if (mod && e.key.toLowerCase() === 'z' && !typing) {
        if (!canUndo) return;
        e.preventDefault();
        onUndo();
        return;
      }

      // 剩下都是单键或 Alt 组合：正在打字就完全不碰
      if (typing) return;

      const lineId = currentLineId(selectedIds);

      if (mod && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        if (lineId) onDuplicate(lineId);
        return;
      }

      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !mod) {
        e.preventDefault();
        if (!lineId) return;
        const dir = e.key === 'ArrowUp' ? -1 : 1;
        const idx = lineIds.indexOf(lineId);
        if (idx < 0) return;
        const next = idx + dir;
        if (next < 0 || next >= lineIds.length) return; // 到顶到底就静默不动，不弹提示
        onMove(lineId, dir);
        return;
      }

      // 只认 Delete。Backspace 不放进来——勾了行手滑按一下就没了一行，
      // 而这个键在很多人的肌肉记忆里是「返回」。
      if (e.key === 'Delete' && !mod && !e.altKey) {
        if (!lineId) return;
        e.preventDefault();
        onDelete(lineId);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    enabled,
    canUndo,
    lineIds,
    selectedIds,
    onDuplicate,
    onMove,
    onDelete,
    onUndo,
    onIssue,
    onPreview,
    onAutosaveHint,
  ]);
}
