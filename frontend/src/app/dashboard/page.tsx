import type { Metadata } from "next";
import { DashboardRouteContent } from "./dashboard-route-content";

export const metadata: Metadata = {
  title: "Dashboard | Bill n Chill",
};

export default function DashboardPage() {
  return <DashboardRouteContent />;
}
