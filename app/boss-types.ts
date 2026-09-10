import type { LocalizedText } from './catalog.ts';

// Monetary values returned by the boss API are integer sen (RM 1 = 100 sen).
export type BossSales = {
  completedTreatments: number;
  serviceCents: number;
  bookedExtrasCents: number;
  laterExtrasCents: number;
  grossCents: number;
};

export type BossTotals = BossSales & {
  commissionCents: number;
  shopShareCents: number;
  rentalCents: number;
  electricityCents: number;
  netCents: number;
};

export type BossSaleLine = BossSales & {
  bookingId: string;
  reference: string;
  guestId: string;
  guestName: string;
  start: string;
  service: LocalizedText;
  extras: { name: LocalizedText; priceCents: number; source: 'booking' | 'counter' | 'during_service' }[];
};

export type BossDay = BossSales & { date: string; lines: BossSaleLine[] };
export type BossTherapistMonth = BossTotals & {
  therapistId: string;
  staffNumber: string;
  name: LocalizedText;
  imageUrl: string;
  active: boolean;
  days: BossDay[];
};

export type BossStatementSummary = { id: string; month: string; savedAt: string; savedBy: string; grossCents: number; netCents: number };
export type BossAudit = { id: string; month: string; at: string; actor: string; action: string };
export type BossMonthReport = {
  month: string;
  generatedAt: string;
  status: 'open' | 'closed';
  savedAt: string | null;
  statementId: string | null;
  revision: string;
  commissionPercent: 50;
  therapists: BossTherapistMonth[];
  totals: BossTotals;
  availableMonths: string[];
  statementHistory: BossStatementSummary[];
  audit: BossAudit[];
};

export type BossDeductionInput = {
  rental: number;
  electricity: number;
  applyToFutureMonths: boolean;
  expectedRevision: string;
};
