export type UserData = {
  token?: string;
  email?: string;
};

export type CostCode = {
  id: number;
  code: string;
  name: string;
  is_active: boolean;
};

export type CsvImportRowResult = {
  row_number: number;
  code?: string;
  name?: string;
  is_active?: boolean | null;
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
