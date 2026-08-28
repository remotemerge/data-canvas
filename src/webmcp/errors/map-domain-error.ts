import type { DomainError } from '@/shared/errors/domain-error.ts';
import { errorResult } from '@/webmcp/results/tool-result.ts';

export const mapDomainError = (error: DomainError): string => errorResult(error);
