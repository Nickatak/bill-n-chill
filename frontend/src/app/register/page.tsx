import type { Metadata } from "next";
import { HomeRegisterConsole } from "@/features/session/components/home-register-console";
import { fetchHealth } from "@/shared/api/health";
import homeStyles from "../page.module.css";

export const metadata: Metadata = {
  title: "Register",
};

export default async function RegisterPage() {
  const health = await fetchHealth();

  return (
    <div className={homeStyles.page}>
      <main className={homeStyles.main}>
        <h1 className={homeStyles.title}>bill-n-chill</h1>
        <p className={homeStyles.subtitle}>Create a temporary account for this preview environment.</p>
        <HomeRegisterConsole health={health} />
      </main>
    </div>
  );
}
