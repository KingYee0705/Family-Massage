export type Locale = 'en' | 'zh';

export type LocalizedText = {
  en: string;
  zh: string;
};

export type MenuItem = {
  id: string;
  name: LocalizedText;
  detail: LocalizedText;
  price: number;
  kind: 'treatment' | 'package';
};

export type AddOn = {
  id: string;
  name: LocalizedText;
  price: number;
};

export type Category = {
  id: string;
  number: string;
  name: LocalizedText;
  intro: LocalizedText;
  treatments: MenuItem[];
  packages: MenuItem[];
  addOns: AddOn[];
};

export type GuestSelection = {
  id: string;
  name: string;
  categoryId: string;
  itemId: string;
  addOnIds: string[];
  therapistPreference: string;
};

export const business = {
  name: 'Serene Family Massage',
  whatsappNumber: '6589160743', // International format without the leading plus sign.
  hours: {
    en: 'Opening hours to be added',
    zh: '营业时间待补充',
  },
  address: {
    en: 'Shop address to be added',
    zh: '店铺地址待补充',
  },
} as const;

// Temporary test hours. Replace these with the shop's real opening hours and
// last-booking rules before the site is made public.
export const bookingSettings = {
  firstTime: '10:00',
  lastTime: '21:30',
  intervalMinutes: 30,
} as const;

const duration = (id: string, en: string, zh: string, price: number): MenuItem => ({
  id,
  name: { en, zh },
  detail: { en: 'Massage session', zh: '按摩疗程' },
  price,
  kind: 'treatment',
});

const bundle = (id: string, en: string, zh: string, price: number): MenuItem => ({
  id,
  name: { en, zh },
  detail: { en: 'Value package', zh: '优惠配套' },
  price,
  kind: 'package',
});

const addOn = (id: string, en: string, zh: string, price: number): AddOn => ({
  id,
  name: { en, zh },
  price,
});

export const catalog: Category[] = [
  {
    id: 'aromatherapy',
    number: '01',
    name: { en: 'Aromatherapy Body Massage', zh: '精油全身按摩' },
    intro: {
      en: 'A soothing full-body ritual with your choice of aromatic oil.',
      zh: '自选芳香精油，享受舒缓放松的全身按摩。',
    },
    treatments: [
      duration('aroma-60', '1 hour', '1 小时', 85),
      duration('aroma-90', '90 minutes', '1 小时半', 125),
      duration('aroma-120', '2 hours', '2 小时', 150),
    ],
    addOns: [
      addOn('ear-candling', 'Ear candling', '耳烛', 20),
      addOn('gua-sha', 'Gua Sha', '刮痧', 35),
      addOn('cupping', 'Cupping', '拔罐', 35),
      addOn('fire-cupping', 'Fire cupping', '拔火罐', 45),
      addOn('bleeding-cupping', 'Bleeding cupping', '放血罐', 55),
      addOn('body-scrubbing', 'Body scrubbing', '全身海盐磨砂', 55),
    ],
    packages: [
      bundle('aroma-pkg-ear', '90 min aromatherapy + ear candling', '1 小时半精油全身按摩 + 耳烛', 140),
      bundle('aroma-pkg-cupping', '90 min aromatherapy + cupping', '1 小时半精油全身按摩 + 拔罐', 150),
      bundle('aroma-pkg-guasha', '90 min aromatherapy + Gua Sha', '1 小时半精油全身按摩 + 刮痧', 150),
      bundle('aroma-pkg-foot', '1 hour aromatherapy + 1 hour foot massage', '1 小时精油全身按摩 + 1 小时足部按摩', 125),
    ],
  },
  {
    id: 'thai',
    number: '02',
    name: { en: 'Traditional Thai Massage', zh: '泰式全身按摩' },
    intro: {
      en: 'Traditional pressure and stretching techniques for a lighter, looser body.',
      zh: '结合传统按压与拉伸手法，舒展身体、释放紧绷。',
    },
    treatments: [
      duration('thai-60', '1 hour', '1 小时', 80),
      duration('thai-90', '90 minutes', '1 小时半', 110),
      duration('thai-120', '2 hours', '2 小时', 140),
    ],
    addOns: [
      addOn('thai-balm', 'Thai balm', '泰风油', 8),
      addOn('ear-candling', 'Ear candling', '耳烛', 20),
      addOn('gua-sha', 'Gua Sha', '刮痧', 35),
      addOn('cupping', 'Cupping', '拔罐', 35),
      addOn('fire-cupping', 'Fire cupping', '拔火罐', 45),
      addOn('bleeding-cupping', 'Bleeding cupping', '放血罐', 55),
      addOn('body-scrubbing', 'Body scrubbing', '全身海盐磨砂', 55),
    ],
    packages: [
      bundle('thai-pkg-cupping', '1 hour Thai massage + cupping', '1 小时泰式全身按摩 + 拔罐', 105),
      bundle('thai-pkg-guasha', '1 hour Thai massage + Gua Sha', '1 小时泰式全身按摩 + 刮痧', 105),
      bundle('thai-pkg-foot', '1 hour Thai massage + 1 hour foot massage', '1 小时泰式全身按摩 + 1 小时足部按摩', 120),
      bundle('thai-pkg-ear', '90 min Thai massage + ear candling', '1 小时半泰式全身按摩 + 耳烛', 120),
      bundle('thai-pkg-scrub', '1 hour Thai massage + body scrubbing', '1 小时泰式全身按摩 + 全身海盐磨砂', 125),
    ],
  },
  {
    id: 'full-body',
    number: '03',
    name: { en: 'Full Body Massage', zh: '全身按摩' },
    intro: {
      en: 'A classic head-to-toe massage, tailored to the time you have.',
      zh: '经典全身按摩，按您的时间灵活选择疗程长度。',
    },
    treatments: [
      duration('body-30', '30 minutes', '30 分钟', 45),
      duration('body-60', '1 hour', '1 小时', 68),
      duration('body-90', '90 minutes', '1 小时半', 100),
      duration('body-120', '2 hours', '2 小时', 130),
    ],
    addOns: [
      addOn('thai-balm', 'Thai balm', '泰风油', 8),
      addOn('coconut-oil', 'Coconut oil', '椰油', 10),
      addOn('aroma-oil', 'Aroma oil', '芳香按摩油', 15),
      addOn('ear-candling', 'Ear candling', '耳烛', 20),
      addOn('gua-sha', 'Gua Sha', '刮痧', 35),
      addOn('cupping', 'Cupping', '拔罐', 35),
      addOn('fire-cupping', 'Fire cupping', '拔火罐', 45),
      addOn('bleeding-cupping', 'Bleeding cupping', '放血罐', 55),
      addOn('body-scrubbing', 'Body scrubbing', '全身海盐磨砂', 55),
    ],
    packages: [
      bundle('body-pkg-cupping', '1 hour body massage + cupping', '1 小时全身按摩 + 拔罐', 95),
      bundle('body-pkg-guasha', '1 hour body massage + Gua Sha', '1 小时全身按摩 + 刮痧', 95),
      bundle('body-pkg-foot', '1 hour body massage + 1 hour foot massage', '1 小时全身按摩 + 1 小时足部按摩', 110),
      bundle('body-pkg-ear', '90 min body massage + ear candling', '1 小时半全身按摩 + 耳烛', 110),
      bundle('body-pkg-scrub', '1 hour body massage + body scrubbing', '1 小时全身按摩 + 全身海盐磨砂', 115),
    ],
  },
  {
    id: 'foot',
    number: '04',
    name: { en: 'Foot Massage', zh: '足部按摩' },
    intro: {
      en: 'Focused care for tired feet, with easy add-ons for shoulders or body.',
      zh: '专注舒缓疲惫双足，并可轻松搭配肩颈或全身按摩。',
    },
    treatments: [
      duration('foot-30', '30 minutes', '30 分钟', 38),
      duration('foot-60', '1 hour', '1 小时', 50),
      duration('foot-90', '90 minutes', '1 小时半', 75),
      duration('foot-120', '2 hours', '2 小时', 98),
    ],
    addOns: [
      addOn('herbal-bag', 'Herbal foot bath bag', '草药足浴包', 8),
      addOn('thai-balm', 'Thai balm', '泰风油', 8),
      addOn('coconut-oil', 'Coconut oil', '椰油', 10),
      addOn('ear-candling', 'Ear candling', '耳烛', 20),
      addOn('foot-scrubbing', 'Foot scrubbing', '足部磨砂', 20),
      addOn('gua-sha', 'Gua Sha', '刮痧', 35),
      addOn('cupping', 'Cupping · foot or body', '拔罐 · 足部或身体', 35),
      addOn('fire-cupping', 'Fire cupping · foot or body', '拔火罐 · 足部或身体', 45),
      addOn('shoulder-15', 'Shoulder massage · 15 min', '肩部按摩 · 15 分钟', 20),
      addOn('shoulder-30', 'Shoulder massage · 30 min', '肩部按摩 · 30 分钟', 40),
    ],
    packages: [
      bundle('foot-pkg-scrub', '1 hour foot massage + foot scrubbing', '1 小时足部按摩 + 足部磨砂', 65),
      bundle('foot-pkg-cupping', '1 hour foot massage + foot cupping', '1 小时足部按摩 + 足部拔罐', 80),
      bundle('foot-pkg-shoulder', '1 hour foot massage + 30 min shoulder massage', '1 小时足部按摩 + 30 分钟肩部按摩', 85),
      bundle('foot-pkg-body-30', '1 hour foot massage + 30 min body massage', '1 小时足部按摩 + 30 分钟全身按摩', 85),
      bundle('foot-pkg-body-first', '1 hour body massage + 30 min foot massage', '1 小时全身按摩 + 30 分钟足部按摩', 95),
      bundle('foot-pkg-body-60', '1 hour foot massage + 1 hour body massage', '1 小时足部按摩 + 1 小时全身按摩', 110),
    ],
  },
];

export const ui = {
  en: {
    language: 'Language',
    navMenu: 'Treatments',
    navBook: 'Book a visit',
    eyebrow: 'REST · RESTORE · RECONNECT',
    heroTitle: 'Make time for',
    heroAccent: 'feeling good.',
    heroBody: 'Thoughtful massage treatments for you and your loved ones. Choose your favourites and request a time in just a few minutes.',
    chooseTreatment: 'Choose your treatment',
    payShop: 'Pay at the shop',
    groupBooking: 'Groups up to 6',
    staffConfirmation: 'Staff confirmation',
    treatmentsEyebrow: 'THE TREATMENT MENU',
    treatmentsTitle: 'Find your kind of calm.',
    regularSessions: 'Massage sessions',
    packages: 'Packages',
    addOns: 'Available add-ons',
    from: 'From',
    addToBooking: 'Choose this',
    bookingEyebrow: 'YOUR VISIT',
    bookingTitle: 'Build your booking.',
    bookingIntro: 'Add each guest, choose their treatment, then request one shared arrival time.',
    guests: 'Guests',
    guest: 'Guest',
    addGuest: 'Add guest',
    guestName: 'Guest name (optional)',
    treatmentType: 'Treatment type',
    selectTreatment: 'Select a treatment or package',
    extras: 'Add a little extra',
    therapist: 'Preferred therapist (optional)',
    therapistHint: 'A preference is not guaranteed',
    removeGuest: 'Remove guest',
    appointment: 'Appointment request',
    preferredDate: 'Preferred date',
    preferredTime: 'Preferred time',
    chooseTime: 'Choose a preferred time',
    timeRequestNote: 'This is a time request, not a reserved slot. Staff will confirm it or suggest the nearest available time in WhatsApp.',
    contactName: 'Contact name',
    whatsappPhone: 'WhatsApp phone number',
    notes: 'Notes (optional)',
    notesHint: 'Health considerations, requests, or anything staff should know',
    summary: 'Your request',
    notSelected: 'Treatment not selected',
    subtotal: 'Subtotal',
    total: 'Estimated total',
    review: 'Review request',
    payNote: 'No payment now. Your time is not reserved until staff confirms it in WhatsApp.',
    reviewTitle: 'One last look.',
    reference: 'Reference',
    sendWhatsApp: 'Send in WhatsApp',
    sendHint: 'WhatsApp will open with your request ready. Staff will reply to confirm it or offer another time.',
    copySummary: 'Copy request',
    copied: 'Request copied',
    close: 'Close',
    configureNotice: 'The shop WhatsApp number has not been added yet. You can copy the request now; add the number in the business configuration before launch.',
    invalidForm: 'Please complete the highlighted booking details.',
    pastTime: 'Please choose a future appointment time.',
    footerLine: 'A quieter moment starts here.',
    medicalNote: 'Please tell staff about pregnancy, injuries, allergies, or medical concerns before treatment. Services are subject to staff confirmation.',
    addressPending: 'Business details are ready to be replaced before launch.',
  },
  zh: {
    language: '语言',
    navMenu: '按摩疗程',
    navBook: '预约到店',
    eyebrow: '休息 · 恢复 · 重拾平衡',
    heroTitle: '给自己一点时间，',
    heroAccent: '感受身心舒畅。',
    heroBody: '为您与家人精心准备的按摩疗程。选择心仪服务，只需几分钟即可预约。',
    chooseTreatment: '选择您的疗程',
    payShop: '到店付款',
    groupBooking: '最多 6 人同行',
    staffConfirmation: '店员确认预约',
    treatmentsEyebrow: '按摩疗程菜单',
    treatmentsTitle: '找到属于您的放松方式。',
    regularSessions: '按摩疗程',
    packages: '优惠配套',
    addOns: '可选附加项目',
    from: '起价',
    addToBooking: '选择此项目',
    bookingEyebrow: '您的到店安排',
    bookingTitle: '建立您的预约。',
    bookingIntro: '添加每位客人并选择疗程，然后共同选择一个希望到店的时间。',
    guests: '客人',
    guest: '客人',
    addGuest: '添加客人',
    guestName: '客人姓名（选填）',
    treatmentType: '按摩类型',
    selectTreatment: '选择按摩疗程或优惠配套',
    extras: '添加附加项目',
    therapist: '偏好按摩师（选填）',
    therapistHint: '偏好无法保证，店员将回复确认',
    removeGuest: '移除此客人',
    appointment: '预约要求',
    preferredDate: '希望日期',
    preferredTime: '希望时间',
    chooseTime: '选择希望时间',
    timeRequestNote: '这只是时间要求，并非已保留时段。店员会通过 WhatsApp 确认，或建议最接近的可用时间。',
    contactName: '联系人姓名',
    whatsappPhone: 'WhatsApp 手机号码',
    notes: '备注（选填）',
    notesHint: '健康注意事项、特别要求或其他需要告知店员的内容',
    summary: '您的预约要求',
    notSelected: '尚未选择疗程',
    subtotal: '小计',
    total: '预计总额',
    review: '查看预约要求',
    payNote: '现在无需付款。所选时间在店员通过 WhatsApp 确认前并未保留。',
    reviewTitle: '最后确认。',
    reference: '参考编号',
    sendWhatsApp: '通过 WhatsApp 发送',
    sendHint: 'WhatsApp 将打开并显示您的预约要求。店员会回复确认，或建议其他时间。',
    copySummary: '复制预约要求',
    copied: '已复制预约要求',
    close: '关闭',
    configureNotice: '尚未添加店铺 WhatsApp 号码。您可以先复制预约要求；正式发布前请在商家设置中添加号码。',
    invalidForm: '请填写标记的预约资料。',
    pastTime: '请选择未来的预约时间。',
    footerLine: '宁静时光，由此开始。',
    medicalNote: '如有怀孕、受伤、过敏或健康疑虑，请在疗程前告知店员。所有服务以店员确认为准。',
    addressPending: '商家资料可在正式发布前替换。',
  },
} as const;
