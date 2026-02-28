import type { Metadata } from "next";
import { fetchHealth } from "@/shared/api/health";
import { HomeRouteContent } from "./home-route-content";

export const metadata: Metadata = {
  title: "Home",
};

export default async function Home() {
  const health = await fetchHealth();

  return (
    <HomeRouteContent health={health} />
  );
}
