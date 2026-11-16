'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { OcrSettings } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { InlineLoading, Note } from '@/components/ui/states';

/**
 * 发票识别（腾讯云 OCR）设置。
 *
 * 与对象存储那块同一套规矩：
 *  1. **SecretKey 永不回显**，服务端只给"配没配 + 末四位"，输入框永远空着，留空 = 不改。
 *  2. **测试连接不要求先保存**：配置常常是抄错一个字符，逼人先存再测，存进去的就是错的。
 *  3. 密钥默认复用对象存储那一对（同一个腾讯云账号），所以这里留空即可用——
 *     真要换一把权限更小的子账号密钥，才在下面填。
 *
 * 界面必须说清两件做不到的事（写死在文案里，不留给客户经理口头解释）：
 *  · OFD 数电票传不上来（识别接口不收 OFD，先另存 PDF）；
 *  · 识别只保证"图上有这些字"，**不判断真伪**。
 */
export function OcrSettingsForm() {
  const [saved, setSaved] = useState<OcrSettings | null>(null);
  const [form, setForm] = useState({ enabled: false, secretId: '', secretKey: '', region: 'ap-guangzhou' });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .ocrSettings()
      .then((s) => {
        setSaved(s);
        setForm({
          enabled: s.enabled,
          secretId: s.secretId,
          secretKey: '',
          region: s.region || 'ap-guangzhou',
        });
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  const patch = (p: Partial<typeof form>) => setForm((f) => ({ ...f, ...p }));

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await api.updateOcrSettings({
        enabled: form.enabled,
        secretId: form.secretId.trim(),
        // 空 = 不改：界面上看不到原值，所以空不能当成"清空"
        secretKey: form.secretKey.trim() === '' ? undefined : form.secretKey.trim(),
        region: form.region.trim(),
      });
      setSaved(next);
      setForm((f) => ({ ...f, secretKey: '' }));
      setMessage(
        next.enabled && next.secretKeySet
          ? '已保存。现在批量上传会直接调识别；识别失败的票不会入库，可单条重传。'
          : '已保存，但识别还没真正可用（没启用或缺密钥）。上传会被拦下并指回这一页。',
      );
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setTesting(true);
    setError(null);
    setMessage(null);
    try {
      const r = await api.testOcr();
      setMessage(`识别服务通了（${r.latencyMs}ms）。${r.note}`);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <InlineLoading label="正在读识别配置…" />;

  const configured = saved?.secretKeySet ?? false;

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <div className="panel">
        <div className="fw-semi t-sm mb-[var(--space-2)]">现在能不能识别</div>
        <p className="t-sm">
          {saved?.enabled && configured
            ? '已启用。上传发票时会自动调腾讯云「通用票据识别（高级版）」，识别出的号码、金额、日期直接入库。'
            : '还没配好。没配好之前批量上传会被拦下——识别是上传链路的一环，系统不会先存一张没有字段的空行。只是想把票号先记下来，用发票台账右上角的「手工录入」。'}
        </p>
        {!configured ? (
          <p className="t-xs t-3 mt-[var(--space-1)]">
            密钥默认复用「对象存储」那一对（同一个腾讯云账号）；要换一把权限更小的子账号密钥，才在下面填。
          </p>
        ) : null}
      </div>

      <div className="panel flex flex-col gap-[var(--space-4)]">
        <div className="fw-semi t-sm">腾讯云 · 文字识别 OCR</div>

        <Field label="启用发票识别" htmlFor="ocr-enabled" hint="关掉后上传按钮会置灰，已入库的票不受影响">
          <Select
            id="ocr-enabled"
            value={form.enabled ? 'on' : 'off'}
            onChange={(e) => patch({ enabled: e.target.value === 'on' })}
          >
            <option value="off">不启用</option>
            <option value="on">启用（上传时自动识别）</option>
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-[var(--space-3)]">
          <Field label="SecretId" htmlFor="ocr-id" hint="访问管理 → API 密钥管理；留空 = 用对象存储那一对">
            <Input
              id="ocr-id"
              value={form.secretId}
              placeholder="AKIDxxxxxxxxxxxxxxxx"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => patch({ secretId: e.target.value })}
            />
          </Field>
          <Field
            label="SecretKey"
            htmlFor="ocr-key"
            hint={configured ? `已配置 ${saved?.secretKeyHint ?? ''}，留空表示不改` : '和 SecretId 成对出现'}
          >
            <Input
              id="ocr-key"
              type="password"
              value={form.secretKey}
              placeholder={configured ? '不想改就留空' : '粘贴 SecretKey'}
              autoComplete="new-password"
              spellCheck={false}
              onChange={(e) => patch({ secretKey: e.target.value })}
            />
          </Field>
        </div>

        <Field
          label="地域"
          htmlFor="ocr-region"
          hint="一般不用改。选错了不影响识别，只影响这一路请求走哪个接入点"
        >
          <Input
            id="ocr-region"
            value={form.region}
            placeholder="ap-guangzhou"
            spellCheck={false}
            onChange={(e) => patch({ region: e.target.value })}
          />
        </Field>

        <div className="flex items-center gap-[var(--space-3)] flex-wrap">
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            保存
          </Button>
          <Button variant="secondary" loading={testing} onClick={() => void test()}>
            测试连接
          </Button>
          <span className="t-xs t-3">
            测试会真调一次识别（用内置的一张样例票），不写库、不花钱之外的副作用。
          </span>
        </div>

        {message ? <Note tone="neutral">{message}</Note> : null}
        {error ? (
          <div className="field-error" role="alert">
            {error}
          </div>
        ) : null}
      </div>

      <Note tone="warn">
        识别<strong>不判断发票真伪</strong>。系统只能保证「这张图上是这些字」，不能保证「这张票是真的、没被作废」——
        假票、废票照样会进台账。真伪核验要接税务的查验接口，这一版没做。
      </Note>
      <Note tone="neutral">
        只收 PNG / JPG / PDF，单份识别上限约 7.5MB（超过的会被拦下，先压缩或拆页）。
        OFD 数电票请先在电子税务局另存为 PDF 再传。
      </Note>
      <Note tone="neutral">
        红票（冲红）自动判定只能靠启发式：识别接口不返回红票标记。所以界面会一直显示「含冲红 N 张」，
        判错了由管理员在发票抽屉里手工改——改状态会同时把三项金额翻成负数。
      </Note>
    </div>
  );
}
