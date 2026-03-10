# SaaS Billing Plan

## Decision: Self-Dogfood for Early Billing

For the first wave of users, bill-n-chill will use itself to manage its own subscription billing.

### How it works
- Each paying user/org is a **Customer** in Nick's own bill-n-chill org
- A **Project** per customer tracks their subscription
- **Invoices** sent on whatever cadence via the existing sent-email + public preview flow
- **Payments** recorded manually when they pay

### Why
- Zero subscription infrastructure to build
- Constant dogfooding surfaces UX issues organically
- Direct relationship with early users for feedback
- Flexibility to experiment with pricing without rebuilding billing logic

### When to revisit
- Somewhere around 10-20 paying customers, when manual invoice creation and payment tracking becomes a time sink
- At that point, evaluate Stripe Billing or similar for automated recurring billing

### Not needed for MVP
- Payment gateway integration (Stripe, etc.)
- Self-serve subscription management portal
- Automated recurring invoice generation
