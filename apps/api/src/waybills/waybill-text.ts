export type WaybillRecognition = { carrier?: string; trackingNo?: string };

const carrierPatterns: Array<[RegExp, string]> = [
  [/顺\s*丰|\bSF\s*EXPRESS\b/, '顺丰速运'],
  [/京\s*东|\bJD\s*LOGISTICS\b/, '京东物流'],
  [/中\s*通|\bZTO\b/, '中通快递'],
  [/圆\s*通|\bYTO\b/, '圆通速递'],
  [/申\s*通|\bSTO\b/, '申通快递'],
  [/韵\s*达|\bYUNDA\b/, '韵达快递'],
  [/极\s*兔|\bJ&T\b/, '极兔速递'],
  [/邮\s*政|\bEMS\b/, '中国邮政'],
  [/德\s*邦|\bDEPPON\b/, '德邦快递'],
];

const prefixCarriers: Record<string, string> = {
  DPK: '德邦快递',
  SF: '顺丰速运',
  JD: '京东物流',
  YT: '圆通速递',
  JT: '极兔速递',
};

function candidateAt(value: string, labeled: boolean) {
  const text = value.replace(/^[\s:：#]+/, '');
  const match = text.match(/^([A-Z0-9]+(?:-[A-Z0-9]+)*)/);
  if (!match) return undefined;
  let token = match[1];
  let remaining = text.slice(match[0].length);
  if (/^[A-Z]{1,5}$/.test(token)) {
    const digits = remaining.match(/^\s+([A-Z0-9]+(?:-[A-Z0-9]+)*)/);
    if (!digits) return undefined;
    token += digits[1];
    remaining = remaining.slice(digits[0].length);
  }
  const initialDigits = token.replace(/[A-Z-]/g, '');
  const grouped = initialDigits.length < 8;
  while (true) {
    const next = remaining.match(/^[ \t]+([A-Z0-9]+(?:-[A-Z0-9]+)*)/);
    if (!next || !/^\d/.test(next[1])) break;
    if (!grouped || !/^\d{1,6}$/.test(next[1])) return undefined;
    token += next[1];
    remaining = remaining.slice(next[0].length);
    if (token.length > 30) return undefined;
  }
  const candidate = token.replace(/-/g, '');
  if (/^[._/-]/.test(remaining)) return undefined;
  if (/^(DPK|SF|JD|YT|JT)\d{8,20}$/.test(candidate)) return candidate;
  if (
    labeled &&
    (/^\d{8,20}$/.test(candidate) ||
      /^[A-Z]{1,5}\d{8,20}$/.test(candidate) ||
      /^[A-Z]{2}\d{9}[A-Z]{2}$/.test(candidate))
  )
    return candidate;
  return undefined;
}

export function parseWaybillText(text: string): WaybillRecognition {
  const normalized = text.normalize('NFKC').toUpperCase();
  const candidates = new Set<string>();
  const labels =
    /(?:运\s*单\s*(?:编\s*号|号\s*码|号)|快\s*递\s*单\s*号|物\s*流\s*单\s*号|TRACKING(?:\s*(?:NO\.?|NUMBER))?|WAYBILL(?:\s*NO\.?)?)/g;
  for (const match of normalized.matchAll(labels)) {
    const candidate = candidateAt(normalized.slice(match.index! + match[0].length), true);
    if (candidate) candidates.add(candidate);
  }
  const prefixes = /(?<![A-Z0-9-])(?:DPK|SF|JD|YT|JT)(?=[\d\s-])/g;
  for (const match of normalized.matchAll(prefixes)) {
    const candidate = candidateAt(normalized.slice(match.index!), false);
    if (candidate) candidates.add(candidate);
  }
  const trackingNo = candidates.size === 1 ? [...candidates][0] : undefined;
  const explicitCarriers = carrierPatterns
    .filter(([pattern]) => pattern.test(normalized))
    .map(([, carrier]) => carrier);
  const inferredCarrier = trackingNo
    ? prefixCarriers[trackingNo.match(/^[A-Z]+/)?.[0] ?? '']
    : undefined;
  const carrier =
    explicitCarriers.length === 1
      ? !inferredCarrier || explicitCarriers[0] === inferredCarrier
        ? explicitCarriers[0]
        : undefined
      : explicitCarriers.length === 0
        ? inferredCarrier
        : undefined;
  return { carrier, trackingNo };
}
