import type { Metadata } from "next";
import { fetchHealth } from "@/shared/api/health";
import { LoginRouteContent } from "./login-route-content";

export const metadata: Metadata = {
  title: "Sign In | Bill n Chill",
};

/** Route page for user login. */
export default async function LoginPage() {
  const health = await fetchHealth();

  return <LoginRouteContent health={health} />;
}
