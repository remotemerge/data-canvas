import type { DataEnginePort, TableWindow, TableWindowRequest } from '@/application/ports/data-engine-port.ts';
import type { DomainError } from '@/shared/errors/domain-error.ts';
import type { Result } from '@/shared/result/result.ts';

export const fetchTableWindow = (
  engine: DataEnginePort,
  request: TableWindowRequest,
): Promise<Result<TableWindow, DomainError>> => engine.fetchTableWindow(request);
