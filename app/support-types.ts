import type { Locale } from './catalog.ts';

export const SUPPORT_MAX_MESSAGE = 800;
export const SUPPORT_MAX_HISTORY = 6;
export type SupportRequest = { message: string; history: string[]; locale: Locale };
export type SupportMode = 'mock' | 'openai' | 'disabled';
export type SupportReply = {
  text: string;
  locale: Locale;
  mode: SupportMode;
  handoff: boolean;
  bookingLink: boolean;
  sources: string[];
};
