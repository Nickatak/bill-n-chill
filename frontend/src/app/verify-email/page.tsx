import type { Metadata } from "next";
import { VerifyEmailConsole } from "@/features/session/components/verify-email-console";
import homeStyles from "../page.module.css";

export const metadata: Metadata = {
  title: "Verify Email",
};

/** Route page that processes an email verification token from the `?token=` query param. */
export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className={homeStyles.page}>
      <main className={homeStyles.main}>
        <h1 className={homeStyles.title}>Bill n&apos; Chill</h1>
        <VerifyEmailConsole token={params.token} />
      </main>
    </div>
  );
}
