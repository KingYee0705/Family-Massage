// Deliberately imports public catalogue data only. No database or booking APIs.
import { catalog, type Locale } from '../app/catalog.ts';
import { SUPPORT_MAX_HISTORY, SUPPORT_MAX_MESSAGE, type SupportRequest, type SupportReply, type SupportMode } from '../app/support-types.ts';

export const intents = ['services', 'prices', 'addons', 'differences', 'hours', 'policy', 'safety', 'private', 'booking', 'unknown', 'discount', 'greeting'] as const;
export type SupportIntent = typeof intents[number];
export type SupportQuery = { intent: SupportIntent; categories: string[]; minutes: number };
export class SupportError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string) { super(code); this.status = status; this.code = code; }
}

export function validateSupportRequest(raw: unknown): SupportRequest {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SupportError(400, 'invalid_request');
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !['message', 'history', 'locale'].includes(key))
    || !['en', 'zh'].includes(value.locale as string)
    || typeof value.message !== 'string' || !value.message.trim() || value.message.length > SUPPORT_MAX_MESSAGE
    || !Array.isArray(value.history) || value.history.length > SUPPORT_MAX_HISTORY
    || value.history.some((entry) => typeof entry !== 'string' || !entry.trim() || entry.length > SUPPORT_MAX_MESSAGE)) {
    throw new SupportError(400, 'invalid_request');
  }
  return { message: value.message.trim(), history: value.history as string[], locale: value.locale as Locale };
}

export function parseSupportQuery(raw: unknown): SupportQuery {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SupportError(502, 'provider_failure');
  const value = raw as Record<string, unknown>;
  if (Object.keys(value).some((key) => !['intent', 'categories', 'minutes'].includes(key))
    || !intents.includes(value.intent as SupportIntent) || !Array.isArray(value.categories) || value.categories.length > catalog.length
    || value.categories.some((id) => !catalog.some((category) => category.id === id))
    || ![0, 30, 60, 90, 120].includes(value.minutes as number)) throw new SupportError(502, 'provider_failure');
  return { intent: value.intent as SupportIntent, categories: [...new Set(value.categories as string[])], minutes: value.minutes as number };
}

// Best-effort minimisation, not a promise to detect all personal information.
export function redactSupportText(text: string) {
  return text.replace(/[\w.+-]+@[\w.-]+\.[a-z]{2,}/gi, '[email removed]')
    .replace(/(?:\+?\d[\d ()-]{7,}\d)/g, '[number removed]')
    .replace(/\b(?:sk-|Bearer\s+)[\w-]+/gi, '[credential removed]');
}

export function guardedIntent(text: string): SupportIntent | null {
  if (/\b(revenue|payroll|salary|commission|profit|sql|database|api key|password|customer records?|staff earnings)\b|营收|收入|佣金|工资|薪水|数据库|密钥|密码|客户记录|财务/i.test(text)) return 'private';
  if (/\b(diagnos\w*|pregnan\w*|diabet\w*|cancer|medical|injur\w*|allerg\w*|safe|pain|blood pressure|cure|treat my)\b|怀孕|孕妇|诊断|糖尿病|疾病|受伤|过敏|安全|疼痛|痛|高血压|治疗/i.test(text)) return 'safety';
  if (/\b(refund|cancel\w*|complaint|complain|late|policy|policies|deposit)\b|退款|取消|投诉|迟到|政策|订金|定金/i.test(text)) return 'policy';
  if (/\b(discount|promotion|coupon|free|cheaper|override|pretend|ignore|invent)\b|打折|折扣|优惠码|促销|免费|改价|忽略|假装|编造/i.test(text)) return 'discount';
  if (/\b(book\w*|reserv\w*|availability|available (?:today|tomorrow)|appointment|reschedule|confirm)\b|预约|预订|有空|空位|改期|确认预约/i.test(text)) return 'booking';
  if (/\b(?:(?:opening|business|your|shop|working) hours|open|clos\w*)\b|营业|开门|关门|几点/i.test(text)) return 'hours';
  return null;
}

const aliases: Record<string, RegExp> = {
  aromatherapy: /aroma|essential oil|精油|芳香/i,
  thai: /thai|泰式|泰国/i,
  'full-body': /full.?body|body massage|全身|身体按摩/i,
  foot: /foot|feet|足部|足底|脚底|脚部|足疗/i,
};
export function categoryMatches(text: string) {
  const matches = catalog.filter((category) => aliases[category.id]?.test(text)).map((category) => category.id);
  // Aromatherapy Body Massage contains "body massage" but is one category.
  return matches.includes('aromatherapy') && !/full.?body|普通全身/i.test(text) ? matches.filter((id) => id !== 'full-body') : matches;
}

export function mockInterpret(request: SupportRequest): SupportQuery {
  const text = request.message;
  const categories = categoryMatches(text);
  if (!categories.length && /what about|and |the .*one|那|呢|再|那个|分钟|min|hour|小时/i.test(text)) {
    for (const previous of [...request.history].reverse()) {
      const found = categoryMatches(previous); if (found.length) { categories.push(...found); break; }
    }
  }
  const minutes = /90|ninety|one and a half|1\.5\s*(?:h|小时)|一(?:个)?半小时|九十|1\s*小时半/i.test(text) ? 90
    : /120|two hours|2\s*(?:h|小时)|两小时|二小时|一百二十/i.test(text) ? 120
      : /30|thirty|half an hour|半小时|三十/i.test(text) ? 30
        : /60|sixty|one hour|1\s*(?:h|小时)|一小时|六十/i.test(text) ? 60 : 0;
  let intent = guardedIntent(text);
  if (!intent) {
    if (/hot stone|swedish|shiatsu|facial|hair|热石|瑞典|指压|美容|理发/i.test(text)) intent = 'unknown';
    else if (/add.?on|extra|附加|加购|拔罐|刮痧|耳烛|草药|泰风油|herbal|balm|cupping|scrub/i.test(text)) intent = 'addons';
    else if (/differ|compar|区别|不同|比较/i.test(text)) intent = 'differences';
    else if (/price|cost|how much|价格|多少钱|价钱|分钟|min|hour|小时/i.test(text) || categories.length) intent = 'prices';
    else if (/service|massage|menu|疗程|服务|菜单|按摩/i.test(text)) intent = 'services';
    else if (/^(hi|hello|hey|你好|您好)[!！.。\s]*$/i.test(text)) intent = 'greeting';
    else intent = 'unknown';
  }
  return { intent, categories, minutes };
}

export function replyLocale(request: SupportRequest): Locale {
  return /[\u3400-\u9fff]/u.test(request.message) ? 'zh' : request.locale;
}

export function renderSupportReply(query: SupportQuery, locale: Locale, mode: SupportMode): SupportReply {
  const t = (en: string, zh: string) => locale === 'zh' ? zh : en;
  const result: SupportReply = { text: '', locale, mode, handoff: false, bookingLink: false, sources: [] };
  const handoff: Partial<Record<SupportIntent, string>> = {
    hours: t('Staff must confirm the current opening hours. The local demo’s operating hours are not approved support information.', '当前营业时间请向店员确认。本地演示的营业时间尚未作为已核实的客服信息。'),
    policy: t('Please contact staff about policies, cancellations, refunds or complaints. I cannot approve exceptions or change an appointment.', '有关规定、取消、退款或投诉，请联系店员。我无法批准特殊申请或更改预约。'),
    safety: t('I cannot diagnose a condition or confirm that a treatment is medically suitable or safe for you. Please consult a qualified healthcare professional and discuss the treatment with staff. Do not send medical records here.', '我无法诊断疾病，也无法确认某项疗程是否适合您的身体状况或是否安全。请咨询合资格的医疗专业人士，并与店员讨论疗程。请勿在此发送医疗记录。'),
    private: t('I can only read the public service catalogue. I cannot access customer records, staff earnings, financial reports, passwords or the database.', '我只能查询公开的服务菜单，无法访问客户记录、员工收入、财务报表、密码或数据库。'),
    discount: t('I cannot invent or change prices, discounts or promotions. Published menu prices are the only prices I can quote; please ask staff about any other offer.', '我不能编造或更改价格、折扣或促销。我只能提供菜单标价，其他优惠请向店员确认。'),
    unknown: t('I do not have approved information to answer that. Please ask staff, or ask me about the services, durations and prices in the menu.', '我没有已核实的信息来回答此问题。请联系店员，或询问菜单中的服务、时长和价格。'),
  };
  if (handoff[query.intent]) return { ...result, text: handoff[query.intent]!, handoff: true };
  if (query.intent === 'booking') return { ...result, bookingLink: true, text: t('Please use the existing booking form to choose a therapist, treatment and available time. I cannot check live availability, create, confirm, cancel or change bookings. No booking has been made in this chat.', '请使用现有预约表格选择按摩师、疗程和可预约时间。我无法查看实时空位、创建、确认、取消或更改预约。本次聊天没有创建预约。') };
  if (query.intent === 'greeting') return { ...result, text: t('Hello! Ask me about the massage menu, durations, prices or add-ons. I provide information only; bookings stay in the booking form.', '您好！您可以询问按摩菜单、时长、价格或附加项目。我只提供信息，预约仍需通过预约表格。') };
  const categories = query.categories.length ? catalog.filter((category) => query.categories.includes(category.id)) : catalog;
  result.sources = ['app/catalog.ts'];
  result.text = categories.map((category) => {
    const heading = category.name[locale];
    if (query.intent === 'services' || query.intent === 'differences') return `${heading}\n${category.intro[locale]}`;
    if (query.intent === 'addons') return `${heading}\n${category.addOns.map((extra) => `• ${extra.name[locale]} — RM ${extra.price}`).join('\n')}`;
    // Session lengths are taken from existing treatment IDs/names, not invented
    // package timing estimates. Packages are listed as named in the catalogue.
    const items = query.minutes ? category.treatments.filter((item) => item.id.endsWith(`-${query.minutes}`)) : [...category.treatments, ...category.packages];
    return `${heading}\n${items.length ? items.map((item) => `• ${item.name[locale]} — RM ${item.price}`).join('\n') : t('No menu session listed for that duration. Please ask staff.', '菜单未列出此时长的疗程，请向店员确认。')}`;
  }).join('\n\n');
  return result;
}
