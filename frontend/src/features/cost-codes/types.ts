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

export type ApiResponse = {
  data?: UserData | CostCode[] | CostCode;
};
