import type { UserData, CostCode } from "@/shared/types/domain";
export type { UserData, CostCode } from "@/shared/types/domain";

export type ApiResponse = {
  data?: UserData | CostCode[] | CostCode;
  error?: { code?: string; message?: string; fields?: Record<string, string[]> };
};
