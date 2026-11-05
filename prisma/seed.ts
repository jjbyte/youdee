/**
 * 种子数据。
 *
 * 设计原则：
 *   1) 种子只是初始值，全部可改（分类专门在引导里提示"可以按你们自己的叫法改"）
 *   2) 必须**踩到每一条核心规则**，否则演示时看不出这套系统的价值：
 *      - 同一物料多家供应商、价格有高有低（比价页才有效果）
 *      - 跨单位折算（桁架按根 vs 按米）
 *      - 含税 / 不含税混存（口径不同不混排）
 *      - 阶梯价（LED 屏按天租，3 天以上降价）
 *      - 已 superseded 的旧价（历史趋势才有曲线）
 *      - 人员「按场」与「按天」并存（讲师 2800/场 vs 1500/天）
 *   3) 所有写库走显式值，不依赖 DEFAULT（Spec §5.2 红线 10）
 *
 * 幂等：以"库里有几个用户"为闸门，重复执行不会产生重复数据。
 */
import { existsSync } from 'node:fs';
import pg from 'pg';

// tsx 不自动加载 .env（Prisma 7 CLI 也不），这里显式加载
if (existsSync('.env')) process.loadEnvFile('.env');

import { hashPassword } from '../src/server/auth/password';

const { Client } = pg;

type Id = string;

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const existing = await client.query<{ n: string }>('SELECT count(*)::text AS n FROM users');
  if (Number(existing.rows[0]!.n) > 0) {
    console.log('[seed] 已有用户数据，跳过（如需重来请 npm run db:reset）');
    await client.end();
    return;
  }

  const today = new Date().toISOString().slice(0, 10);

  try {
    await client.query('BEGIN');

    // ── 1. 单位字典（17 条）──────────────────────────────────
    const units: Array<[string, string, string, boolean, number, string | null]> = [
      ['piece', '个', 'common', false, 10, null],
      ['case', '件', 'common', false, 20, null],
      ['block', '块', 'material', false, 30, 'LED 箱体、KT 板按块报价时用'],
      ['sheet', '张', 'material', false, 40, '线上电商常按张售'],
      ['set', '套', 'common', false, 50, '含画面的整套背景板'],
      ['group', '组', 'common', false, 60, null],
      ['sqm', '㎡', 'material', false, 70, null],
      ['linear_m', '延米', 'material', false, 80, null],
      ['meter', 'm', 'material', false, 90, null],
      ['day', '天', 'common', true, 100, '租赁与按天计价的人员'],
      ['session', '场', 'personnel', true, 110, '主持、演艺、礼仪按场'],
      ['batch', '批', 'material', false, 120, '茶歇、餐按批'],
      ['root', '根', 'material', false, 130, '桁架'],
      ['roll', '卷', 'material', false, 140, '地毯、布幔'],
      ['person_day', '人天', 'personnel', true, 150, '搭建工、搬运'],
      ['hour', '小时', 'common', true, 160, '超时费'],
      ['half_day', '半天', 'personnel', true, 170, '讲师半天'],
    ];
    for (const u of units) {
      await client.query(
        'INSERT INTO units (code, name_zh, kind, is_time, sort_order, note) VALUES ($1,$2,$3,$4,$5,$6)',
        u,
      );
    }

    // ── 2. 账号 ───────────────────────────────────────────────
    const adminPwd = await hashPassword('youdee2026');
    const memberPwd = await hashPassword('youdee2026');

    const admin = await one<Id>(
      client,
      `INSERT INTO users (login, password_hash, name, role, phone, is_active, token_version)
       VALUES ($1,$2,$3,'admin','0571-8888 6677',true,0) RETURNING id`,
      ['admin', adminPwd, '管理员'],
    );
    const member = await one<Id>(
      client,
      `INSERT INTO users (login, password_hash, name, role, phone, is_active, token_version)
       VALUES ($1,$2,$3,'member',NULL,true,0) RETURNING id`,
      ['xiaowang', memberPwd, '小王'],
    );

    // ── 3. 供应商（8 家，覆盖 5 种类型）──────────────────────
    const sup: Record<string, Id> = {};
    const suppliers: Array<[
      string, string, string | null, string | null, string | null, string | null, string | null, number | null,
    ]> = [
      // name, type, contact, phone, region, shopUrl, note, leadTime
      ['淘宝·霓虹广告旗舰店', 'online', null, null, '浙江义乌', 'https://item.taobao.com/', '喷绘、KT 板，48 小时发货', 3],
      ['淘宝·展会物料批发', 'online', null, null, '广东深圳', 'https://shop.taobao.com/', '易拉宝、桌牌、胸卡', 4],
      ['金桥桁架厂', 'factory', '金师傅', '138-0000-0001', '上海嘉定', null, '桁架、舞台、背景板定做，含安装', 7],
      ['星辉租赁', 'rental', '李经理', '138-0000-0002', '上海闵行', null, '音响灯光桌椅，需 3 天前下单', 3],
      ['睿视 AV 租赁', 'rental', '陈工', '138-0000-0003', '上海浦东', null, 'LED 屏、投影、直播设备', 5],
      ['老王兼职团队', 'freelancer', '王哥', '138-0000-0004', '上海', null, '搭建、搬运、场控，20 人以内', 2],
      ['上海熠演文化', 'freelancer', '赵老师', '138-0000-0005', '上海', null, '讲师、主持、演艺资源', 10],
      ['本公司自有', 'internal', null, null, '上海', null, '自有人员与常用器材，成本按内部结算价', 0],
    ];
    for (const s of suppliers) {
      sup[s[0]] = await one<Id>(
        client,
        `INSERT INTO suppliers (name, type, contact_name, contact_phone, region, shop_url, note, default_lead_time_days, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) RETURNING id`,
        s,
      );
    }

    /**
     * 开票信息（v1.13）：给三家「会走公账开发票」的补满，另外五家留空。
     *
     * 留空是有意的：淘宝店和兼职团队通常不开发票，正好演示「五项全空也能用」。
     * 如果种子里家家都填满，验收的人会以为这五格是必填。
     */
    const invoices: Array<[string, string, string, string, string, string]> = [
      // name, 税号, 地址, 电话, 开户银行, 账号
      ['金桥桁架厂', '91310114MA1GX8Q23K', '上海市嘉定区安亭镇墨玉路 28 号 2 幢', '021-5998 6677', '中国工商银行上海安亭支行', '1001200409006789123'],
      ['星辉租赁', '91310112MA1GB2X68R', '上海市闵行区莘庄工业区申北路 66 号', '021-6412 3355', '中国建设银行上海莘庄支行', '31001529360050212345'],
      ['本公司自有', '91310115MA1K4T0L7Y', '上海市浦东新区张江路 88 号 5 层', '021-5888 1234', '招商银行上海张江支行', '121905261810901'],
    ];
    for (const [name, taxNo, address, phone, bank, account] of invoices) {
      await client.query(
        `UPDATE suppliers SET tax_no=$2, company_address=$3, company_phone=$4, bank_name=$5, bank_account=$6
          WHERE name=$1`,
        [name, taxNo, address, phone, bank, account],
      );
    }

    // ── 4. 分类（物料 8 + 人员 8，各带二级）──────────────────
    const catMat: Record<string, Id> = {};
    const matCats: Array<[string, string | null]> = [
      ['舞美硬体', 'custom_made'],
      ['灯光音响 AV', 'rental_per_day'],
      ['印刷物料', 'custom_made'],
      ['桌椅布草', 'rental_per_day'],
      ['美陈软装', 'custom_made'],
      ['礼品物料', 'purchase'],
      ['餐饮服务', 'purchase'],
      ['场地设备', 'rental_per_day'],
    ];
    let so = 10;
    for (const [name, nature] of matCats) {
      catMat[name] = await one<Id>(
        client,
        `INSERT INTO categories (domain, name, parent_id, sort_order, default_pricing_nature)
         VALUES ('material',$1,NULL,$2,$3) RETURNING id`,
        [name, so, nature],
      );
      so += 10;
    }

    const catPer: Record<string, Id> = {};
    const perCats = ['主持司仪', '演艺资源', '影像团队', '策划设计', '执行搭建', '礼仪模特', '专业嘉宾', '支持人员'];
    so = 10;
    for (const name of perCats) {
      catPer[name] = await one<Id>(
        client,
        `INSERT INTO categories (domain, name, parent_id, sort_order, default_pricing_nature)
         VALUES ('personnel',$1,NULL,$2,NULL) RETURNING id`,
        [name, so],
      );
      so += 10;
    }

    // 二级分类（只挑几个常用的，其余让用户自己建）
    const sub: Record<string, Id> = {};
    const subs: Array<[string, keyof typeof catMat | keyof typeof catPer, number]> = [
      ['桁架背景板', '舞美硬体', 11],
      ['舞台', '舞美硬体', 12],
      ['地毯', '舞美硬体', 13],
      ['LED 屏', '灯光音响 AV', 21],
      ['音响', '灯光音响 AV', 22],
      ['灯光', '灯光音响 AV', 23],
      ['喷绘写真', '印刷物料', 31],
      ['KT 板 / 展架', '印刷物料', 32],
      ['桌椅', '桌椅布草', 41],
      ['花艺', '美陈软装', 51],
      ['伴手礼', '礼品物料', 61],
      ['茶歇', '餐饮服务', 71],
      ['发电机', '场地设备', 81],
      ['主持人', '主持司仪', 11],
      ['歌手', '演艺资源', 21],
      ['摄影摄像', '影像团队', 31],
      ['搭建搬运', '执行搭建', 51],
      ['礼仪', '礼仪模特', 61],
      ['讲师', '专业嘉宾', 71],
    ];
    for (const [name, parentKey, order] of subs) {
      const parentId = catMat[parentKey] ?? catPer[parentKey];
      const domain = catMat[parentKey] ? 'material' : 'personnel';
      sub[name] = await one<Id>(
        client,
        `INSERT INTO categories (domain, name, parent_id, sort_order, default_pricing_nature)
         VALUES ($1,$2,$3,$4,NULL) RETURNING id`,
        [domain, name, parentId, order],
      );
    }

    // ── 5. 计价主体 ───────────────────────────────────────────
    const item: Record<string, Id> = {};
    interface ItemSeed {
      key: string;
      type: 'material' | 'personnel';
      cat: string;
      name: string;
      aliases: string[];
      spec: string | null;
      /** 备注：录进报价单时作为该行备注的初值。只给几个常用的示例填，其余留空 */
      note?: string | null;
      baseUnit: string;
      compareUnit: string | null;
      includesTravel?: boolean | null;
    }
    const items: ItemSeed[] = [
      // 物料
      { key: 'truss_bg', type: 'material', cat: '桁架背景板', name: '桁架背景板 6m×3m', aliases: ['背景板', '签到墙'], spec: '含桁架 + 画面 + 安装', note: "报价含运输、安装与拆除；不含电费与场地费", baseUnit: 'set', compareUnit: 'sqm' },
      { key: 'truss', type: 'material', cat: '桁架背景板', name: '铝合金桁架（单根 3m）', aliases: ['桁架'], spec: '200×200 方管', baseUnit: 'meter', compareUnit: 'meter' },
      { key: 'stage', type: 'material', cat: '舞台', name: '舞台（含围裙）', aliases: ['地台'], spec: '高度 0.4–0.8m 可调', note: "报价含围裙与台阶；高度按 0.6m 报，0.8m 加 15%", baseUnit: 'sqm', compareUnit: 'sqm' },
      { key: 'carpet', type: 'material', cat: '地毯', name: '展览地毯', aliases: ['红毯', '灰毯'], spec: '宽 3m', baseUnit: 'sqm', compareUnit: 'sqm' },
      { key: 'led', type: 'material', cat: 'LED 屏', name: 'LED 屏 P3.9（一套约 12㎡）', aliases: ['大屏', 'LED'], spec: '含控台与技术人员', note: "含控台与 1 名技术；超 8 小时按半天加收", baseUnit: 'day', compareUnit: 'day' },
      { key: 'speaker', type: 'material', cat: '音响', name: '线阵音响（全场）', aliases: ['音响', 'PA'], spec: '含调音台、无线麦 4 支', note: "含调音师与 4 支无线麦；话筒加一支 +120", baseUnit: 'day', compareUnit: 'day' },
      { key: 'par_light', type: 'material', cat: '灯光', name: '帕灯 54 颗（单台）', aliases: ['帕灯', '面光'], spec: null, baseUnit: 'piece', compareUnit: 'piece' },
      { key: 'print_banner', type: 'material', cat: '喷绘写真', name: '喷绘布（普通）', aliases: ['喷绘', '写真'], spec: '510 克内光布', note: "含设计与喷绘；画面改版另算，不含高空安装", baseUnit: 'sqm', compareUnit: 'sqm' },
      { key: 'kt_board', type: 'material', cat: 'KT 板 / 展架', name: 'KT 板 5mm（含写真）', aliases: ['KT板'], spec: '1.2m×2.4m 一张 2.88㎡', baseUnit: 'sqm', compareUnit: 'sqm' },
      { key: 'rollup', type: 'material', cat: 'KT 板 / 展架', name: '易拉宝 80×200', aliases: ['易拉宝', '展架'], spec: '含画面', baseUnit: 'piece', compareUnit: 'piece' },
      { key: 'table_set', type: 'material', cat: '桌椅', name: '圆桌 + 10 椅（含桌布椅套）', aliases: ['桌椅'], spec: null, baseUnit: 'set', compareUnit: 'set' },
      { key: 'flower', type: 'material', cat: '花艺', name: '桌面花（签到台用）', aliases: ['桌花'], spec: '直径约 30cm', baseUnit: 'piece', compareUnit: 'piece' },
      { key: 'gift_mug', type: 'material', cat: '伴手礼', name: '定制马克杯（含 logo）', aliases: ['伴手礼', '礼品'], spec: '300ml 陶瓷', baseUnit: 'piece', compareUnit: 'piece' },
      { key: 'catering', type: 'material', cat: '茶歇', name: '茶歇（30 人份）', aliases: ['茶歇', '下午茶'], spec: '含摆台与服务员', baseUnit: 'batch', compareUnit: 'batch' },
      { key: 'generator', type: 'material', cat: '发电机', name: '静音发电机 5kW', aliases: ['发电机'], spec: '含油', baseUnit: 'day', compareUnit: 'day' },
      // 人员
      { key: 'host_cn', type: 'personnel', cat: '主持人', name: '主持人（中文·商务）', aliases: ['主持'], spec: '3 年以上经验', note: "报价含彩排一次；跨市场地另计差旅", baseUnit: 'session', compareUnit: 'session', includesTravel: true },
      { key: 'host_bi', type: 'personnel', cat: '主持人', name: '主持人（中英双语）', aliases: ['双语主持'], spec: null, baseUnit: 'session', compareUnit: 'session', includesTravel: true },
      { key: 'singer', type: 'personnel', cat: '歌手', name: '歌手（流行·单人）', aliases: ['歌手', '演唱'], spec: '含 2 首', baseUnit: 'session', compareUnit: 'session', includesTravel: false },
      { key: 'photographer', type: 'personnel', cat: '摄影摄像', name: '摄影（单机）', aliases: ['摄影'], spec: '含 200 张精修', note: "含 200 张精修；原片全给，加急 3 天内交付 +20%", baseUnit: 'day', compareUnit: 'day', includesTravel: false },
      { key: 'videographer', type: 'personnel', cat: '摄影摄像', name: '摄像（双机 + 剪辑）', aliases: ['摄像', '视频'], spec: '3 分钟成片', baseUnit: 'day', compareUnit: 'day', includesTravel: false },
      { key: 'builder', type: 'personnel', cat: '搭建搬运', name: '搭建工', aliases: ['工人', '搭建'], spec: null, note: "按人天报；夜班（22:00 后）按 1.5 倍", baseUnit: 'person_day', compareUnit: 'person_day', includesTravel: false },
      { key: 'supervisor', type: 'personnel', cat: '搭建搬运', name: '现场督导', aliases: ['督导', '场控'], spec: null, baseUnit: 'day', compareUnit: 'day', includesTravel: false },
      { key: 'usher', type: 'personnel', cat: '礼仪', name: '礼仪（迎宾）', aliases: ['礼仪', '迎宾'], spec: '身高 168 以上', baseUnit: 'session', compareUnit: 'session', includesTravel: false },
      { key: 'lecturer_mid', type: 'personnel', cat: '讲师', name: '外聘讲师（中级）', aliases: ['讲师', '老师'], spec: '行业 5 年以上', baseUnit: 'day', compareUnit: 'day', includesTravel: true },
      { key: 'lecturer_senior', type: 'personnel', cat: '讲师', name: '外聘讲师（高级 / 专家）', aliases: ['专家', '大咖'], spec: '行业 10 年以上', baseUnit: 'half_day', compareUnit: 'half_day', includesTravel: true },
    ];
    for (const it of items) {
      item[it.key] = await one<Id>(
        client,
        `INSERT INTO items (item_type, category_id, name, aliases, spec, note, base_unit_code, compare_unit_code, includes_travel, is_active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10) RETURNING id`,
        [
          it.type,
          sub[it.cat] ?? (it.type === 'material' ? catMat[it.cat] : catPer[it.cat]),
          it.name,
          it.aliases,
          it.spec,
          it.note ?? null,
          it.baseUnit,
          it.compareUnit,
          it.includesTravel ?? null,
          admin,
        ],
      );
    }

    // ── 6. 价格 ───────────────────────────────────────────────
    interface PriceSeed {
      item: string;
      supplier: string;
      unit: string;
      baseUnitQty?: string | null;
      price: string;
      taxIncluded: boolean;
      nature: string;
      moq?: string | null;
      from: string;
      to?: string | null;
      status?: 'active' | 'superseded';
      tiers?: Array<[string, string]>;
      note?: string | null;
      lastUsedAt?: string | null;
    }

    const H1 = '2026-07-01'; // 本年度下半年的现行价
    const H0 = '2025-07-01'; // 上一年度的旧价（superseded）

    const prices: PriceSeed[] = [
      // 桁架背景板：比价基准 = ㎡，但三家都按「套」报（6m×3m = 18㎡，1㎡ = 1/18 套 = 0.055556）。
      // 不填折算系数就会全部"不可比"——这是这套系统最容易踩的坑，种子里必须踩对。
      { item: 'truss_bg', supplier: '金桥桁架厂', unit: 'set', baseUnitQty: '0.055556', price: '3200.0000', taxIncluded: true, nature: 'custom_made', from: H1, note: '含安装与拆除' },
      { item: 'truss_bg', supplier: '淘宝·霓虹广告旗舰店', unit: 'set', baseUnitQty: '0.055556', price: '2680.0000', taxIncluded: false, nature: 'custom_made', from: H1, note: '不含税、不含安装', lastUsedAt: '2026-09-20T02:00:00Z' },
      { item: 'truss_bg', supplier: '本公司自有', unit: 'set', baseUnitQty: '0.055556', price: '1450.0000', taxIncluded: true, nature: 'custom_made', from: H1, note: '旧架翻新，仅算材料与人工' },

      // 桁架：金桥按根报（需折算 1m = 1/3 根 → 0.3333）
      { item: 'truss', supplier: '金桥桁架厂', unit: 'root', baseUnitQty: '0.333333', price: '95.0000', taxIncluded: true, nature: 'purchase', from: H1 },
      { item: 'truss', supplier: '星辉租赁', unit: 'meter', price: '38.0000', taxIncluded: true, nature: 'purchase', from: H1, note: '整根切卖，不足 3m 按 3m 计' },

      // 舞台
      { item: 'stage', supplier: '金桥桁架厂', unit: 'sqm', price: '180.0000', taxIncluded: true, nature: 'custom_made', from: H1 },
      { item: 'stage', supplier: '星辉租赁', unit: 'sqm', price: '65.0000', taxIncluded: true, nature: 'rental_per_day', from: H1, note: '租赁，按天计' },

      // 地毯：按卷与按㎡
      { item: 'carpet', supplier: '星辉租赁', unit: 'sqm', price: '12.0000', taxIncluded: true, nature: 'rental_per_day', from: H1 },
      // 1 卷 = 30㎡ → 1㎡ = 1/30 卷 = 0.033333（乘法口径，260 × 0.033333 ≈ 8.67 元/㎡）
      { item: 'carpet', supplier: '淘宝·展会物料批发', unit: 'roll', baseUnitQty: '0.033333', price: '260.0000', taxIncluded: false, nature: 'purchase', from: H1, note: '1 卷 30㎡' },

      // LED：阶梯价（1 天 / 3 天起 / 7 天起）
      {
        item: 'led', supplier: '睿视 AV 租赁', unit: 'day', price: '2200.0000', taxIncluded: true, nature: 'rental_per_day', from: H1,
        tiers: [['1.00', '2200.0000'], ['3.00', '1950.0000'], ['7.00', '1700.0000']],
        note: '含控台与 1 名技术', lastUsedAt: '2026-10-15T03:00:00Z',
      },
      {
        item: 'led', supplier: '星辉租赁', unit: 'day', price: '2600.0000', taxIncluded: true, nature: 'rental_per_day', from: H1,
        note: '不含技术，技术另计 600/天',
      },

      // 音响
      { item: 'speaker', supplier: '星辉租赁', unit: 'day', price: '3800.0000', taxIncluded: true, nature: 'rental_per_day', from: H1, moq: '1.00', note: '含调音师' },
      { item: 'speaker', supplier: '睿视 AV 租赁', unit: 'day', price: '4150.0000', taxIncluded: false, nature: 'rental_per_day', from: H1, lastUsedAt: '2026-08-01T02:00:00Z' },

      // 帕灯
      { item: 'par_light', supplier: '星辉租赁', unit: 'piece', price: '45.0000', taxIncluded: true, nature: 'rental_per_day', from: H1, moq: '8.00', note: '8 台起租' },
      { item: 'par_light', supplier: '睿视 AV 租赁', unit: 'piece', price: '38.0000', taxIncluded: true, nature: 'rental_per_day', from: H1, moq: '12.00' },

      // 喷绘：淘宝按张（0.5㎡/张 → 1㎡ = 2 张）与定做厂按㎡
      { item: 'print_banner', supplier: '淘宝·霓虹广告旗舰店', unit: 'sheet', baseUnitQty: '2.000000', price: '16.0000', taxIncluded: false, nature: 'custom_made', from: H1, note: '一张 0.5㎡', lastUsedAt: '2026-10-28T06:00:00Z' },
      { item: 'print_banner', supplier: '金桥桁架厂', unit: 'sqm', price: '38.0000', taxIncluded: true, nature: 'custom_made', from: H1 },

      // KT 板：按张（2.88㎡）与按㎡
      { item: 'kt_board', supplier: '淘宝·霓虹广告旗舰店', unit: 'sqm', price: '42.0000', taxIncluded: false, nature: 'custom_made', from: H1 },
      { item: 'kt_board', supplier: '金桥桁架厂', unit: 'sqm', price: '55.0000', taxIncluded: true, nature: 'custom_made', from: H1 },

      // 易拉宝
      { item: 'rollup', supplier: '淘宝·展会物料批发', unit: 'piece', price: '78.0000', taxIncluded: false, nature: 'custom_made', from: H1, moq: '4.00', note: '4 个起做' },
      { item: 'rollup', supplier: '金桥桁架厂', unit: 'piece', price: '145.0000', taxIncluded: true, nature: 'custom_made', from: H1 },

      // 桌椅
      { item: 'table_set', supplier: '星辉租赁', unit: 'set', price: '120.0000', taxIncluded: true, nature: 'rental_per_day', from: H1, moq: '5.00' },
      { item: 'table_set', supplier: '本公司自有', unit: 'set', price: '60.0000', taxIncluded: true, nature: 'rental_per_day', from: H1, note: '自有 30 套，仅算损耗与人工' },

      // 花艺
      { item: 'flower', supplier: '星辉租赁', unit: 'piece', price: '180.0000', taxIncluded: true, nature: 'custom_made', from: H1 },
      { item: 'flower', supplier: '淘宝·展会物料批发', unit: 'piece', price: '95.0000', taxIncluded: false, nature: 'custom_made', from: H1, note: '仿真花' },

      // 礼品
      { item: 'gift_mug', supplier: '淘宝·霓虹广告旗舰店', unit: 'piece', price: '22.0000', taxIncluded: false, nature: 'purchase', from: H1, moq: '50.00', note: '50 个起定' },

      // 茶歇
      { item: 'catering', supplier: '本公司自有', unit: 'batch', price: '1500.0000', taxIncluded: true, nature: 'purchase', from: H1, note: '外协采购 + 摆台' },

      // 发电机
      { item: 'generator', supplier: '星辉租赁', unit: 'day', price: '680.0000', taxIncluded: true, nature: 'rental_per_day', from: H1 },

      // ── 人员 ──
      // 主持人：按场
      { item: 'host_cn', supplier: '上海熠演文化', unit: 'session', price: '2800.0000', taxIncluded: true, nature: 'service', from: H1, note: '含彩排一次' },
      { item: 'host_cn', supplier: '本公司自有', unit: 'session', price: '1200.0000', taxIncluded: true, nature: 'service', from: H1, note: '内部员工，按内部结算' },
      { item: 'host_bi', supplier: '上海熠演文化', unit: 'session', price: '4500.0000', taxIncluded: true, nature: 'service', from: H1 },

      // 歌手
      { item: 'singer', supplier: '上海熠演文化', unit: 'session', price: '3600.0000', taxIncluded: true, nature: 'service', from: H1, note: '2 首，超时另计' },

      // 摄影 / 摄像：按天
      { item: 'photographer', supplier: '上海熠演文化', unit: 'day', price: '1600.0000', taxIncluded: false, nature: 'service', from: H1 },
      { item: 'photographer', supplier: '老王兼职团队', unit: 'day', price: '1200.0000', taxIncluded: false, nature: 'service', from: H1, lastUsedAt: '2026-10-08T09:00:00Z' },
      { item: 'videographer', supplier: '上海熠演文化', unit: 'day', price: '3800.0000', taxIncluded: true, nature: 'service', from: H1 },

      // 搭建工：人天
      { item: 'builder', supplier: '老王兼职团队', unit: 'person_day', price: '450.0000', taxIncluded: false, nature: 'service', from: H1, moq: '4.00' },
      { item: 'builder', supplier: '金桥桁架厂', unit: 'person_day', price: '520.0000', taxIncluded: true, nature: 'service', from: H1, note: '含工具' },

      // 督导
      { item: 'supervisor', supplier: '本公司自有', unit: 'day', price: '800.0000', taxIncluded: true, nature: 'service', from: H1 },

      // 礼仪
      { item: 'usher', supplier: '上海熠演文化', unit: 'session', price: '800.0000', taxIncluded: true, nature: 'service', from: H1, moq: '2.00' },

      // 讲师：按天 vs 按半天 —— 两条口径不同，比价页必须**分组**而不是标"最低"
      { item: 'lecturer_mid', supplier: '上海熠演文化', unit: 'day', price: '6000.0000', taxIncluded: true, nature: 'service', from: H1, note: '含课件定制' },
      { item: 'lecturer_mid', supplier: '本公司自有', unit: 'day', price: '3000.0000', taxIncluded: true, nature: 'service', from: H1 },
      { item: 'lecturer_senior', supplier: '上海熠演文化', unit: 'half_day', price: '9000.0000', taxIncluded: true, nature: 'service', from: H1, note: '半天，含差旅' },

      // ── 历史价（superseded，用于价格趋势）──
      { item: 'truss_bg', supplier: '金桥桁架厂', unit: 'set', baseUnitQty: '0.055556', price: '2950.0000', taxIncluded: true, nature: 'custom_made', from: H0, to: '2025-12-31', status: 'superseded' },
      { item: 'truss_bg', supplier: '金桥桁架厂', unit: 'set', baseUnitQty: '0.055556', price: '3100.0000', taxIncluded: true, nature: 'custom_made', from: '2026-01-01', to: '2026-06-30', status: 'superseded' },
      { item: 'speaker', supplier: '星辉租赁', unit: 'day', price: '3400.0000', taxIncluded: true, nature: 'rental_per_day', from: H0, to: '2025-12-31', status: 'superseded' },
      { item: 'speaker', supplier: '星辉租赁', unit: 'day', price: '3600.0000', taxIncluded: true, nature: 'rental_per_day', from: '2026-01-01', to: '2026-06-30', status: 'superseded' },
      { item: 'host_cn', supplier: '上海熠演文化', unit: 'session', price: '2400.0000', taxIncluded: true, nature: 'service', from: H0, to: '2025-12-31', status: 'superseded' },
      { item: 'host_cn', supplier: '上海熠演文化', unit: 'session', price: '2600.0000', taxIncluded: true, nature: 'service', from: '2026-01-01', to: '2026-06-30', status: 'superseded' },
    ];

    for (const p of prices) {
      const status = p.status ?? 'active';
      const priceId = await one<Id>(
        client,
        `INSERT INTO prices (item_id, supplier_id, unit_code, base_unit_qty, unit_price, currency, tax_included,
                             pricing_nature, moq, effective_from, effective_to, status, source_note, last_used_at, created_by)
         VALUES ($1,$2,$3,$4,$5,'CNY',$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [
          item[p.item], sup[p.supplier], p.unit, p.baseUnitQty ?? null, p.price,
          p.taxIncluded, p.nature, p.moq ?? null, p.from, p.to ?? null, status,
          p.note ?? null, p.lastUsedAt ?? null, admin,
        ],
      );

      if (p.tiers) {
        for (const [minQty, unitPrice] of p.tiers) {
          await client.query(
            'INSERT INTO price_tiers (price_id, min_qty, unit_price) VALUES ($1,$2,$3)',
            [priceId, minQty, unitPrice],
          );
        }
      }

      await client.query(
        `INSERT INTO price_change_logs (price_id, action, snapshot, changed_by, note)
         VALUES ($1,'created',$2,$3,$4)`,
        [
          priceId,
          JSON.stringify({
            unitPrice: p.price, unitCode: p.unit, baseUnitQty: p.baseUnitQty ?? null,
            taxIncluded: p.taxIncluded, pricingNature: p.nature, effectiveFrom: p.from,
            effectiveTo: p.to ?? null, status,
          }),
          admin,
          '种子数据',
        ],
      );
    }

    // ── 7. 毛利预警线（按项目类型）+ 该类型的默认毛利率 ──────────
    // 预警线是「低于它变琥珀色」，默认毛利率是「新建单预填、售价 = 成本 ÷ (1 − 它)」。
    // 这里把默认毛利率填成「预警线 + 10 个点」只是占位，让新建单有个能看的初值；
    // 设置页必须明写请按实际改——两个数填成一样，等于报价正好压在自己的警告线上。
    const thresholds: Array<[string, string, string, number]> = [
      ['annual_meeting', '0.1800', '年会 / 庆典', 10],
      ['product_launch', '0.2200', '品牌发布会', 20],
      ['exhibition_booth', '0.2500', '展台特装', 30],
      ['roadshow', '0.1500', '路演 / 地推', 40],
      ['framework_client', '0.1200', '长期框架客户', 50],
    ];
    for (const t of thresholds) {
      const marginDefault = Math.min(Number(t[1]) + 0.1, 0.95).toFixed(4);
      await client.query(
        `INSERT INTO margin_thresholds (project_type, warn_rate, default_margin_rate, label, sort_order)
         VALUES ($1,$2,$3,$4,$5)`,
        [t[0], t[1], marginDefault, t[2], t[3]],
      );
    }

    // ── 8. 系统设置 ───────────────────────────────────────────
    const settings: Array<[string, unknown]> = [
      ['stale_days_threshold', 90],
      ['default_margin_warn_rate', 0.25],
      ['tax_statement_default', 'inclusive'],
      ['quote_no_prefix', 'YD'],
      ['quote_valid_days_default', 15],
      ['price_book_min_effective_count', 150],
      ['org_name', '有底活动'],
      ['seeded_at', today],
    ];
    for (const [key, value] of settings) {
      await client.query(
        'INSERT INTO app_settings (key, value, updated_by) VALUES ($1,$2,$3)',
        [key, JSON.stringify(value), admin],
      );
    }

    // ── 9. 单号计数器 ─────────────────────────────────────────
    const ym = today.slice(0, 7).replace('-', '');
    await client.query('INSERT INTO counters (key, value) VALUES ($1, 0)', [`quote_no:${ym}`]);

    await client.query('COMMIT');

    const counts = await client.query<{ t: string; n: string }>(`
      SELECT 'units' AS t, count(*)::text AS n FROM units
      UNION ALL SELECT 'users', count(*)::text FROM users
      UNION ALL SELECT 'suppliers', count(*)::text FROM suppliers
      UNION ALL SELECT 'categories', count(*)::text FROM categories
      UNION ALL SELECT 'items', count(*)::text FROM items
      UNION ALL SELECT 'prices', count(*)::text FROM prices
      UNION ALL SELECT 'price_tiers', count(*)::text FROM price_tiers
      UNION ALL SELECT 'margin_thresholds', count(*)::text FROM margin_thresholds
    `);
    console.log('[seed] 完成：');
    for (const r of counts.rows) console.log(`  ${r.t.padEnd(18)} ${r.n}`);
    console.log(`\n[seed] 管理员 admin / youdee2026    成员 xiaowang / youdee2026`);
    console.log(`[seed] member 账号 id=${member.slice(0, 8)}…（用于验证"改旧价需管理员"）`);
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    await client.end();
  }
}

async function one<T>(client: pg.Client, sql: string, params: unknown[]): Promise<T> {
  const r = await client.query(sql, params);
  const row = r.rows[0] as { id: T } | undefined;
  if (!row) throw new Error(`期望返回一行，实际为空：${sql.slice(0, 60)}`);
  return row.id;
}

main().catch((e) => {
  console.error('[seed] 失败:', e.message || e);
  if (e.detail) console.error('  detail:', e.detail);
  if (e.constraint) console.error('  constraint:', e.constraint);
  process.exit(1);
});
