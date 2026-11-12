'use client';
import { useEffect, useState } from 'react';
import { api, errorMessage } from '@/lib/api';
import type { StorageSettings } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { InlineLoading, Note } from '@/components/ui/states';

/**
 * 对象存储（腾讯云 COS）。
 *
 * 三条界面上的取舍：
 *  1. SecretKey **不回显**。服务端只回"已配置 + 末四位"，所以输入框永远空着，
 *     留空 = 不改。想换密钥就填新的，想清空就填一个空格再删——代价是容易误操作，
 *     所以清空前有二次确认（见 disabled 提示）。
 *  2. 「测试连接」不要求先保存。配置常常是"抄错一个字符"，逼人先存再测，
 *     存进去的就是错的，而错配置会影响之后每一次上传。
 *  3. 保存成功不一定等于生效：钥匙对、桶名错一样能存。所以状态文案说的是
 *     **现在附件到底存哪儿**，而不是"已保存"。
 */

interface FormState {
  enabled: boolean;
  secretId: string;
  secretKey: string;
  bucket: string;
  region: string;
  keyPrefix: string;
  customDomain: string;
}

const EMPTY: FormState = {
  enabled: false,
  secretId: '',
  secretKey: '',
  bucket: '',
  region: 'ap-guangzhou',
  keyPrefix: 'contracts/',
  customDomain: '',
};

export function StoragePanel() {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [saved, setSaved] = useState<StorageSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .storageSettings()
      .then((s) => {
        setSaved(s);
        setForm({
          enabled: s.cos.enabled,
          secretId: s.cos.secretId,
          secretKey: '',
          bucket: s.cos.bucket,
          region: s.cos.region || 'ap-guangzhou',
          keyPrefix: s.cos.keyPrefix,
          customDomain: s.cos.customDomain ?? '',
        });
      })
      .catch((e) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, []);

  const patch = (p: Partial<FormState>) => setForm((f) => ({ ...f, ...p }));

  async function save() {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const next = await api.updateStorageSettings({
        enabled: form.enabled,
        secretId: form.secretId.trim(),
        // 空 = 不改：界面上看不到原值，所以空不能当成"清空"
        secretKey: form.secretKey.trim() === '' ? undefined : form.secretKey.trim(),
        bucket: form.bucket.trim(),
        region: form.region.trim(),
        keyPrefix: form.keyPrefix.trim(),
        customDomain: form.customDomain.trim() || null,
      });
      setSaved(next);
      setForm((f) => ({ ...f, secretKey: '' }));
      setMessage({
        tone: 'ok',
        text:
          next.provider === 'cos'
            ? '已保存。之后新上传的合同附件会直接进腾讯云。'
            : '已保存。当前附件仍存在服务器本地磁盘。',
      });
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
      const r = await api.testStorage({
        secretId: form.secretId.trim() || undefined,
        secretKey: form.secretKey.trim() || undefined,
        bucket: form.bucket.trim() || undefined,
        region: form.region.trim() || undefined,
      });
      setMessage({ tone: 'ok', text: `连上了（${r.latencyMs}ms）。${r.note}` });
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setTesting(false);
    }
  }

  if (loading) return <InlineLoading label="正在读存储配置…" />;

  const configured = saved?.cos.secretKeySet ?? false;

  return (
    <div className="flex flex-col gap-[var(--space-4)]">
      <div className="panel">
        <div className="fw-semi t-sm mb-[var(--space-2)]">现在附件存在哪儿</div>
        <p className="t-sm">
          {saved?.provider === 'cos'
            ? `腾讯云对象存储（${saved.cos.bucket} · ${saved.cos.region}）。新传的附件直接进云，之前传的仍在服务器本地，点开照常能看。`
            : '服务器本地磁盘（UPLOAD_DIR）。填好下面四项并启用，之后新传的附件会进腾讯云。'}
        </p>
        {saved?.status === 'cos_disabled' ? (
          <p className="t-xs t-3 mt-[var(--space-1)]">云存储已配置但没启用，附件仍写本地磁盘。</p>
        ) : null}
        {saved?.status === 'cos_incomplete' ? (
          <p className="t-xs t-3 mt-[var(--space-1)]">云存储配置不完整，还缺必填项，所以暂时仍写本地磁盘。</p>
        ) : null}
      </div>

      <div className="panel flex flex-col gap-[var(--space-4)]">
        <div className="fw-semi t-sm">腾讯云对象存储（COS）</div>

        <Field label="启用云存储" htmlFor="cos-enabled" hint="关掉就回到本地磁盘；已有云附件不受影响，仍能打开">
          <Select
            id="cos-enabled"
            value={form.enabled ? 'on' : 'off'}
            onChange={(e) => patch({ enabled: e.target.value === 'on' })}
          >
            <option value="off">不启用（存本地磁盘）</option>
            <option value="on">启用（新附件上传到 COS）</option>
          </Select>
        </Field>

        <div className="grid grid-cols-2 gap-[var(--space-3)]">
          <Field label="SecretId" htmlFor="cos-id" hint="访问管理 → API 密钥管理">
            <Input
              id="cos-id"
              value={form.secretId}
              placeholder="AKIDxxxxxxxxxxxxxxxx"
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => patch({ secretId: e.target.value })}
            />
          </Field>
          <Field
            label="SecretKey"
            htmlFor="cos-key"
            hint={configured ? `已配置 ${saved?.cos.secretKeyHint ?? ''}，留空表示不改` : '和 SecretId 成对出现'}
          >
            <Input
              id="cos-key"
              type="password"
              value={form.secretKey}
              placeholder={configured ? '不想改就留空' : '粘贴 SecretKey'}
              autoComplete="new-password"
              spellCheck={false}
              onChange={(e) => patch({ secretKey: e.target.value })}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-[var(--space-3)]">
          <Field label="存储桶" htmlFor="cos-bucket" hint="形如 youdee-1250000000，末尾是 APPID">
            <Input
              id="cos-bucket"
              value={form.bucket}
              placeholder="youdee-1250000000"
              spellCheck={false}
              onChange={(e) => patch({ bucket: e.target.value })}
            />
          </Field>
          <Field label="地域" htmlFor="cos-region" hint="和建桶时选的地域一致，写错会报 NoSuchBucket">
            <Input
              id="cos-region"
              value={form.region}
              placeholder="ap-guangzhou"
              spellCheck={false}
              onChange={(e) => patch({ region: e.target.value })}
            />
          </Field>
        </div>

        <div className="grid grid-cols-2 gap-[var(--space-3)]">
          <Field label="对象键前缀" htmlFor="cos-prefix" hint="桶里所有附件都放这个目录下，方便和别的业务分开">
            <Input
              id="cos-prefix"
              value={form.keyPrefix}
              placeholder="contracts/"
              spellCheck={false}
              onChange={(e) => patch({ keyPrefix: e.target.value })}
            />
          </Field>
          <Field label="自定义域名" htmlFor="cos-domain" hint="可选。配了 CDN 才填，只影响下载地址">
            <Input
              id="cos-domain"
              value={form.customDomain}
              placeholder="cdn.example.com"
              spellCheck={false}
              onChange={(e) => patch({ customDomain: e.target.value })}
            />
          </Field>
        </div>

        <div className="flex items-center gap-[var(--space-3)] flex-wrap">
          <Button variant="primary" loading={busy} onClick={() => void save()}>
            保存
          </Button>
          <Button variant="secondary" loading={testing} onClick={() => void test()}>
            测试连接
          </Button>
          <span className="t-xs t-3">测试会真传一个几字节的探针文件再删掉——只列举桶测不出能不能写。</span>
        </div>

        {message ? <Note tone="neutral">{message.text}</Note> : null}
        {error ? (
          <div className="field-error" role="alert">
            {error}
          </div>
        ) : null}
      </div>

      <Note tone="warn">
        存储桶请保持「私有读写」。下载走服务端 5 分钟有效的签名跳转，桶设成公有读等于把合同变成
        &quot;拿到链接就能看&quot;，而链接会留在浏览器历史和转发记录里。
      </Note>
      <Note tone="neutral">
        附件单份不设大小上限。上限只受云存储配额与磁盘剩余空间限制；真要收口，
        在服务器的环境变量里设 MAX_CONTRACT_FILE_BYTES（字节，0 = 不限制）。
      </Note>
    </div>
  );
}
