import type {
  DataEnginePort,
  DistinctValuesRequest,
  DistinctValuesResult,
} from '@/application/ports/data-engine-port.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { Result } from '@/shared/result/result.ts';

export const getDistinctValues = (
  engine: DataEnginePort,
  request: DistinctValuesRequest,
): Promise<Result<DistinctValuesResult, DomainError>> => engine.getDistinctValues(request);
