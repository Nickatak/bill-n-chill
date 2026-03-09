import type { Metadata } from "next";
import { HomeRouteContent } from "./home-route-content";

export const metadata: Metadata = {
  title: "Dashboard | Bill n Chill",
};

export default function Home() {
  return <HomeRouteContent />;
}
