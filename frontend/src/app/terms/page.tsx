import type { Metadata } from "next";
import styles from "./terms.module.css";

export const metadata: Metadata = {
  title: "Terms of Service",
};

export default function TermsPage() {
  return (
    <div className={styles.page}>
      <main className={styles.content}>
        <h1>Terms of Service</h1>
        <p className={styles.effective}>Effective: March 28, 2026</p>

        <section>
          <h2>1. Beta Notice</h2>
          <p>
            Bill n Chill is currently in <strong>early access beta</strong>. The
            service is provided as-is while we actively develop and improve it.
            Features may change, be added, or be removed. We will make
            reasonable efforts to notify you of significant changes, but we
            cannot guarantee uninterrupted availability during this period.
          </p>
        </section>

        <section>
          <h2>2. What Bill n Chill Does</h2>
          <p>
            Bill n Chill is a construction finance management tool. It helps
            contractors create estimates, invoices, change orders, and track
            payments. It is a record-keeping and workflow tool — not an
            accounting system, tax advisor, or legal service.
          </p>
        </section>

        <section>
          <h2>3. Your Account</h2>
          <p>
            You are responsible for maintaining the security of your account
            credentials. You are responsible for all activity that occurs under
            your account. If you suspect unauthorized access, contact us
            immediately.
          </p>
        </section>

        <section>
          <h2>4. Your Data</h2>
          <p>
            You own your data. We do not sell, share, or monetize your business
            data. We store it to provide the service to you. You can request
            deletion of your account and associated data at any time by
            contacting us.
          </p>
        </section>

        <section>
          <h2>5. Electronic Signatures</h2>
          <p>
            Bill n Chill facilitates electronic signatures on estimates, change
            orders, and invoices through a verification and consent process. By
            using these features, you acknowledge that electronic signatures
            carry legal weight under applicable laws (ESIGN Act / UETA). You
            are responsible for ensuring that your use of electronic signatures
            complies with the requirements of your jurisdiction and contracts.
          </p>
        </section>

        <section>
          <h2>6. Acceptable Use</h2>
          <p>
            Do not use Bill n Chill for unlawful purposes, to transmit harmful
            content, or to interfere with the service or other users. We reserve
            the right to suspend accounts that violate these terms.
          </p>
        </section>

        <section>
          <h2>7. Limitation of Liability</h2>
          <p>
            Bill n Chill is provided &ldquo;as is&rdquo; and &ldquo;as
            available&rdquo; without warranties of any kind, express or implied.
            We are not liable for any indirect, incidental, or consequential
            damages arising from your use of the service. Our total liability is
            limited to the amount you have paid us in the 12 months preceding
            any claim. During the free beta period, this amount is zero.
          </p>
        </section>

        <section>
          <h2>8. Changes to These Terms</h2>
          <p>
            We may update these terms as the product evolves. We will notify
            registered users of material changes via email. Continued use of the
            service after changes take effect constitutes acceptance.
          </p>
        </section>

        <section>
          <h2>9. Contact</h2>
          <p>
            Questions about these terms? Email us at{" "}
            <a href="mailto:nicholasmtakemori@gmail.com">nicholasmtakemori@gmail.com</a>.
          </p>
        </section>
      </main>
    </div>
  );
}
