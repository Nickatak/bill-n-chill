import type { Metadata } from "next";
import { HomeRegisterConsole } from "@/shared/session/components/home-register-console";
import { fetchHealth } from "@/shared/api/health";
import homeStyles from "../page.module.css";

export const metadata: Metadata = {
  title: "Register",
};

/** Route page for new user registration. Accepts an optional `?token=` invite param. */
export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const [health, params] = await Promise.all([fetchHealth(), searchParams]);

  return (
    <div className={homeStyles.page}>
      <main className={homeStyles.main}>
        <HomeRegisterConsole health={health} inviteToken={params.token} />
      </main>
    </div>
  );
}
