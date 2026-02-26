import type { Metadata } from "next";
import { OrganizationConsole } from "@/features/organization/components/organization-console";

export const metadata: Metadata = {
  title: "Organization",
};

export default function OrganizationPage() {
  return <OrganizationConsole />;
}
