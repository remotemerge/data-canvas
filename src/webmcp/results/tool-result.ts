import type { DomainError } from '@/shared/errors/domain-error.ts';

export const successResult = (result: { revision: number; summary: string; [key: string]: unknown }): string =>
  JSON.stringify({ ok: true, ...result });

export const errorResult = (error: DomainError): string =>
  JSON.stringify({ ok: false, code: error.code, error: error.message });
