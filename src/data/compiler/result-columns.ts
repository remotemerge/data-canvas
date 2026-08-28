import type { LogicalType } from '@/domain/logical-type.ts';

export interface ResultColumn {
  key: string;
  name: string;
  logicalType: LogicalType;
}
