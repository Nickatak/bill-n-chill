import type { Metadata } from "next";
import styles from "../terms/terms.module.css";

export const metadata: Metadata = {
  title: "Privacy Policy",
};

export default function PrivacyPage() {
  return (
    <div className={styles.page}>
      <main className={styles.content}>
        <h1>Privacy Policy</h1>
        <p className={styles.effective}>Effective: March 28, 2026</p>

        <section>
          <h2>1. What We Collect</h2>
          <p>
            When you create an account, we collect your email address and a
            hashed password. As you use the service, we store the business data
            you enter: organization details, customer information, project
            records, financial documents (estimates, invoices, change orders,
            vendor bills), and payment records.
          </p>
          <p>
            When your customers interact with public document links, we collect
            their email address (for verification), IP address, browser user
            agent, and signing ceremony data (name, consent, timestamp).
          </p>
        </section>

        <section>
          <h2>2. How We Use Your Data</h2>
          <p>
            We use your data to provide and operate the service. Specifically:
          </p>
          <ul>
            <li>Authenticate your identity and secure your account.</li>
            <li>Store and display your business records.</li>
            <li>Send transactional emails (verification, password reset, document notifications).</li>
            <li>Facilitate electronic signature workflows with your customers.</li>
          </ul>
          <p>
            We do not use your data for advertising, profiling, or any purpose
            unrelated to delivering the service.
          </p>
        </section>

        <section>
          <h2>3. What We Do Not Do</h2>
          <p>
            We do not sell your data. We do not share your data with third
            parties for their marketing purposes. We do not train AI models on
            your business data.
          </p>
        </section>

        <section>
          <h2>4. Third-Party Services</h2>
          <p>We use the following third-party services to operate:</p>
          <ul>
            <li><strong>Mailgun</strong> — transactional email delivery.</li>
            <li><strong>Sentry</strong> — error monitoring and diagnostics (no business data is sent, only technical error context).</li>
            <li><strong>Google Gemini</strong> — document scanning / OCR for vendor bill data extraction. Uploaded images are processed and not retained by Google beyond the API request.</li>
          </ul>
        </section>

        <section>
          <h2>5. Data Storage and Security</h2>
          <p>
            Your data is stored on infrastructure we operate. We use encrypted
            connections (HTTPS/TLS), hashed passwords, and standard security
            practices to protect your information. No system is perfectly
            secure — we are transparent about that — but we take reasonable
            measures appropriate to the sensitivity of the data.
          </p>
        </section>

        <section>
          <h2>6. Data Retention and Deletion</h2>
          <p>
            We retain your data for as long as your account is active. If you
            request account deletion, we will remove your account and associated
            business data. Immutable audit records (signing ceremonies, status
            event logs) may be retained for legal compliance purposes.
          </p>
        </section>

        <section>
          <h2>7. Cookies</h2>
          <p>
            We use localStorage for session management (authentication tokens).
            We do not use tracking cookies, analytics cookies, or any
            third-party cookie-based tracking.
          </p>
        </section>

        <section>
          <h2>8. Changes to This Policy</h2>
          <p>
            We may update this policy as the product evolves. We will notify
            registered users of material changes via email. The effective date
            at the top reflects the latest version.
          </p>
        </section>

        <section>
          <h2>9. Contact</h2>
          <p>
            Questions about your data? Email us at{" "}
            <a href="mailto:nicholasmtakemori@gmail.com">nicholasmtakemori@gmail.com</a>.
          </p>
        </section>
      </main>
    </div>
  );
}
