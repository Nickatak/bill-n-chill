import type { Metadata } from "next";
import { ResetPasswordConsole } from "@/shared/session/components/reset-password-console";
import homeStyles from "../page.module.css";

export const metadata: Metadata = {
  title: "Reset Password | Bill n Chill",
};

/** Route page that processes a password reset token from the `?token=` query param. */
export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className={homeStyles.page}>
      <main className={homeStyles.main}>
        <ResetPasswordConsole token={params.token} />
      </main>
    </div>
  );
}
