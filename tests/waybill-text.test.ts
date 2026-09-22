import { describe, expect, test } from 'vitest';
import { parseWaybillText } from '../apps/api/src/waybills/waybill-text';

describe('服务端运单候选提取', () => {
  test('德邦前缀及中英文名称匹配完整号码', () => {
    expect(parseWaybillText('德邦快递\n运单号：DPK8765432109876')).toEqual({
      carrier: '德邦快递',
      trackingNo: 'DPK8765432109876',
    });
    expect(parseWaybillText('DEPPON\nWAYBILL NO: DPK7654321098765')).toEqual({
      carrier: '德邦快递',
      trackingNo: 'DPK7654321098765',
    });
    expect(parseWaybillText('DPK6543210987654')).toEqual({
      carrier: '德邦快递',
      trackingNo: 'DPK6543210987654',
    });
  });

  test('全角字符和分组数字规范化但不吞后续字段', () => {
    expect(
      parseWaybillText('顺 丰 速 运\n运 单 号：ＳＦ８７６５４３２１０９８７６\n收件人 李先生'),
    ).toEqual({ carrier: '顺丰速运', trackingNo: 'SF8765432109876' });
    expect(parseWaybillText('DEPPON Tracking No: DPK 8765 4321 0987 Weight 1KG')).toEqual({
      carrier: '德邦快递',
      trackingNo: 'DPK876543210987',
    });
    expect(parseWaybillText('SF EXPRESS Tracking No: SF7654321098765 Weight 1KG')).toEqual({
      carrier: '顺丰速运',
      trackingNo: 'SF7654321098765',
    });
    expect(parseWaybillText('物流单号：\nDPK7654321098765')).toEqual({
      carrier: '德邦快递',
      trackingNo: 'DPK7654321098765',
    });
  });

  test('保留中英文标签、纯数字单号与邮政格式', () => {
    expect(parseWaybillText('中通快递\n快递单号：73876543210987')).toEqual({
      carrier: '中通快递',
      trackingNo: '73876543210987',
    });
    expect(parseWaybillText('EMS Waybill No: EA987654321CN')).toEqual({
      carrier: '中国邮政',
      trackingNo: 'EA987654321CN',
    });
    expect(parseWaybillText('Tracking Number: ZTO87654321098')).toEqual({
      carrier: undefined,
      trackingNo: 'ZTO87654321098',
    });
  });

  test.each([
    ['京东物流', 'JD8765432109876', '京东物流'],
    ['YTO EXPRESS', 'YT8765432109876', '圆通速递'],
    ['J&T EXPRESS', 'JT8765432109876', '极兔速递'],
    ['申通快递\n运单号：', '77876543210987', '申通快递'],
    ['YUNDA\n运单号：', '43876543210987', '韵达快递'],
  ])('保留承运商 %s', (label, number, carrier) => {
    expect(parseWaybillText(`${label} ${number}`)).toEqual({ carrier, trackingNo: number });
  });

  test.each([
    'DPK876543210O9876',
    'DPK8765432109876I',
    'DPK876543210-98O76',
    'DPK876543210.9876',
    'DPK8765432109876-ABC',
    'DPK8765432109876 98O76',
    'DPK8765432109876 12345678901',
  ])('混字母及不完整候选不截断为号码 %s', (number) => {
    expect(parseWaybillText(`运单号：${number}`).trackingNo).toBeUndefined();
  });

  test('无标签电话、日期、孤立数字和短号码不冒充单号', () => {
    expect(parseWaybillText('收件电话 13987654321\n日期 2026-09-22\n8765432109876')).toEqual({
      carrier: undefined,
      trackingNo: undefined,
    });
    expect(parseWaybillText('Tracking No: 9876').trackingNo).toBeUndefined();
  });

  test('重复候选合并，冲突号码不任选其一', () => {
    expect(parseWaybillText('德邦快递\n运单号 DPK8765432109876\nDPK8765432109876').trackingNo).toBe(
      'DPK8765432109876',
    );
    expect(parseWaybillText('德邦快递\n运单号 DPK8765432109876\n运单号 DPK7654321098765')).toEqual({
      carrier: '德邦快递',
      trackingNo: undefined,
    });
  });

  test('承运商冲突不猜测但保留独立完整号码', () => {
    expect(parseWaybillText('DEPPON SF EXPRESS\nDPK8765432109876')).toEqual({
      carrier: undefined,
      trackingNo: 'DPK8765432109876',
    });
    expect(parseWaybillText('顺丰速运\nDPK8765432109876')).toEqual({
      carrier: undefined,
      trackingNo: 'DPK8765432109876',
    });
  });
});
