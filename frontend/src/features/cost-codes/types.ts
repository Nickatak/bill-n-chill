import type { UserData, CostCode } from "@/shared/types/domain";
export type { UserData, CostCode } from "@/shared/types/domain";

export type CsvImportRowResult = {
  row_number: number;
  code?: string;
  name?: string;
  status: string;
  message: string;
};

export type CsvImportResult = {
  entity: "cost_codes";
  mode: "preview" | "apply";
  total_rows: number;
  created_count: number;
  updated_count: number;
  error_count: number;
  rows: CsvImportRowResult[];
};

export type ApiResponse = {
  data?: UserData | CostCode[] | CostCode | CsvImportResult;
  error?: { code?: string; message?: string; fields?: Record<string, string[]> };
};
