# Manual Actions Checklist

> Everything Elias must do himself — Claude Code cannot do these autonomously.
> Last updated: 2026-03-23

---

## 1. Do Now (Before Next Weekend — Unblocks Automated Work)

### Twingate: Verify Remote Access to Mac Mini
- **What:** Confirm Twingate lets you SSH into the Mac Mini from your laptop and access localhost ports (4200, 4201, 4202). Test from outside your home network.
- **Why:** All Week 2-3 development assumes stable remote access. If it breaks mid-week you lose a day.
- **Time:** 15 min
- **How:** Open Twingate client on laptop, SSH to Mac Mini, curl localhost:4201/health.

### GitHub: Create Public Repo  ✅ DONE
- **Status:** Complete — public repo lives at https://github.com/Axios-AI-Innovations/axip
- **Note:** Org slug is `Axios-AI-Innovations`, not `elibot0395` or `axiosai`. Use this URL in all docs and examples.

### Stripe Connect: Enable on Existing Stripe Account
- **What:** Go to Stripe Dashboard > Connect > Get Started. Choose Express onboarding. Enable in test mode first.
- **Why:** Unblocks all Week 3 payment work (PAY-2, PAY-3, PAY-4). The Stripe Connect API keys are different from standard Stripe keys.
- **Time:** 15 min
- **How:** https://dashboard.stripe.com/connect/overview — click "Get started with Connect". Select platform type, fill business details.

### PM2: Confirm Startup Script and pm2 save
- **What:** Run `pm2 startup` (follow its output to register the launch daemon), then `pm2 save`. Verify with `pm2 list` after a reboot.
- **Why:** Without this, a Mac Mini power loss kills all agents and they do not come back. PM2 resurrect depends on a saved process list.
- **Time:** 10 min
- **How:** `pm2 startup` then copy/paste the command it outputs, then `pm2 save`. Optionally reboot to verify.

---

## 2. Do Week 3-4 (Before Public Launch Infrastructure)

### Hetzner: Provision VPS
- **What:** Create a Hetzner Cloud account and provision a CX22 instance (2 vCPU, 4GB RAM, 40GB NVMe). Choose Falkenstein or Helsinki DC. Install Ubuntu 22.04.
- **Why:** The public relay runs here. All Week 4 deployment (VPS-1 through VPS-4) depends on having a server. Claude Code can automate the setup once SSH access exists.
- **Time:** 20 min
- **How:** https://console.hetzner.cloud — sign up, create project, add server. Copy the root SSH key/password. Add your SSH public key.

### Hetzner: Share SSH Access for Automation
- **What:** After provisioning, add your SSH public key to the VPS and confirm you can SSH in. Share the IP with Claude Code (paste it in chat).
- **Why:** Claude Code can then automate Node.js install, PM2, nginx, Let's Encrypt, and relay deployment.
- **Time:** 5 min
- **How:** `ssh root@<VPS_IP>` — confirm it works.

### Vercel DNS: Add Relay and Portal Subdomains
- **What:** In Vercel dashboard, go to your `axiosaiinnovations.com` domain settings. Add three A records pointing to the Hetzner VPS IP:
  - `relay.axiosaiinnovations.com` -> VPS IP
  - `portal.axiosaiinnovations.com` -> VPS IP
  - `dashboard.axiosaiinnovations.com` -> VPS IP
- **Why:** Without DNS records, Let's Encrypt cert issuance fails and WSS does not work. Blocks the entire public relay.
- **Time:** 10 min
- **How:** https://vercel.com/dashboard > Domains > axiosaiinnovations.com > DNS Records > Add A records.

### npm: Authenticate for Publishing
- **What:** Run `npm login` on the Mac Mini (or wherever you publish from). Confirm with `npm whoami`.
- **Why:** Claude Code cannot authenticate to npm. Publishing @axip/sdk and @axip/mcp-server requires a valid npm session.
- **Time:** 5 min
- **How:** `npm login` — enter username, password, OTP if enabled. Then `npm whoami` to verify.

### Stripe Connect: Complete Platform Profile (Production)
- **What:** Switch Stripe Connect from test mode to live mode. Complete the platform profile (business type, support info, branding). This triggers Stripe's review.
- **Why:** Cannot process real payments without live-mode Connect. Stripe review can take 1-3 business days.
- **Time:** 30 min (plus 1-3 day wait for Stripe review)
- **How:** Stripe Dashboard > Connect > Settings > fill all required fields > submit for review.

---

## 3. Do Before Launch (Legal, Marketing, Compliance)

### Legal: Draft Terms of Service
- **What:** Write or commission a Terms of Service covering: limitation of liability (capped at credit value), indemnification, disclaimer of warranties, dispute resolution, acceptable use, and bot/AI disclosure requirements.
- **Why:** P0 legal requirement. Cannot accept real money or user registrations without ToS. Also needed to establish that credits are non-transferable (avoids money transmission issues).
- **Time:** 2-5 hours DIY with template, or 1 week if using attorney ($2,000-5,000).
- **How:** Option A: Use Clerky/Stripe Atlas templates as starting point. Option B: Hire via LegalZoom or a startup attorney. Key clauses listed in `/Users/elias/axios-axip/docs/product-spec/LEGAL-CHECKLIST.md` section 3.

### Legal: Draft Developer Agreement
- **What:** A supplemental agreement for agent operators establishing them as independent entities, not AXIP employees. Covers IP ownership of agent code and outputs.
- **Why:** P0. Protects AXIP from liability for agent outputs. Typically bundled with ToS drafting.
- **Time:** Included with ToS work.
- **How:** Same attorney or template as ToS.

### Legal: Draft Privacy Policy
- **What:** Privacy policy covering what data AXIP collects (agent IDs, public keys, task descriptions, settlement amounts, reputation scores), retention periods, GDPR/CCPA basis, and deletion process.
- **Why:** P0. Required before collecting any user data. AXIP collects minimal PII (Stripe handles most), but the policy is still legally required.
- **Time:** 1-2 hours with template, or $500-1,000 with attorney.
- **How:** Use a privacy policy generator as a base (e.g., Termly, iubenda), customize for AXIP's minimal data footprint.

### Legal: Draft Acceptable Use Policy
- **What:** Define prohibited uses: no illegal activity, no PII processing without consent, no adversarial agents, no market manipulation of reputation scores.
- **Why:** P0. Referenced by ToS. Gives you grounds to remove bad actors.
- **Time:** 1 hour with template.
- **How:** Model after Stripe's or AWS's acceptable use policy.

### Legal: Consider Delaware C-Corp Formation
- **What:** Decide whether to incorporate as a Delaware C-Corp before launch (vs. operating as sole proprietor or existing LLC).
- **Why:** Limits personal liability. Required by most VCs. QSBS tax benefit on first $10M capital gains. Cost increases if you convert later after revenue.
- **Time:** 30 min decision + 1-2 weeks processing if you proceed.
- **How:** Clerky ($500) or Stripe Atlas ($500). See LEGAL-CHECKLIST.md corporate structure section.

### Marketing: Set Up Discord Community
- **What:** Create a Discord server with channels: announcements, general, agent-dev, support, showcase.
- **Why:** LCH-5. Primary community channel for launch. Developers expect Discord for open-source/dev-tool projects.
- **Time:** 30 min
- **How:** discord.com > Create Server > Community template.

### Marketing: Create Product Hunt Listing
- **What:** Create a Product Hunt maker account, draft the listing (tagline, description, screenshots, demo video link), and schedule for launch day.
- **Why:** LCH-2. Product Hunt is a primary launch channel. Listings need to be drafted days before launch.
- **Time:** 1-2 hours
- **How:** producthunt.com > Dashboard > Post a Product. Claude Code can draft the copy.

### Marketing: Record Demo Video (60s)
- **What:** Screen-record a 60-second demo showing an agent-to-agent task lifecycle: request, bid, accept, result, settlement.
- **Why:** LCH-4. Required for Product Hunt listing and blog post. Video converts much better than text.
- **Time:** 1-2 hours (recording + editing)
- **How:** Use QuickTime screen recording or OBS. Show the dashboard during a live task.

---

## 4. Nice to Have (Can Wait Until Post-Launch)

### Legal: Formal Attorney Review of ToS
- **What:** Have a startup attorney review DIY-drafted ToS, Privacy Policy, and Developer Agreement.
- **Why:** Catches issues a template misses. Especially important for the credit system (money transmission) and AI disclosure requirements.
- **Time:** 1-2 week turnaround, $2,000-5,000.
- **How:** Contact Cooley, Wilson Sonsini, or a local startup attorney.

### Legal: Securities Opinion Letter
- **What:** Get a formal opinion letter confirming AXIP credits are not securities under the Howey test.
- **Why:** Belt-and-suspenders protection if the credit system grows large. Not needed at MVP scale.
- **Time:** 2-4 weeks, $3,000-5,000.
- **How:** Engage a securities attorney. The Howey analysis is already in LEGAL-CHECKLIST.md.

### Legal: E&O / Cyber Liability Insurance
- **What:** Get Errors & Omissions and cyber liability insurance.
- **Why:** Protects against lawsuits from agent output causing harm. P1 priority per legal checklist.
- **Time:** 1 week to get quotes, $2,000-5,000/year.
- **How:** Contact an insurance broker specializing in tech startups (e.g., Embroker, Vouch).

### Legal: Provisional Patent on AXIP Protocol
- **What:** File a provisional patent on novel AXIP protocol elements (signed capability discovery, reputation-weighted settlement).
- **Why:** 12-month priority window. Low cost. Only matters if the protocol gains traction.
- **Time:** 2-4 hours to draft, $150 filing fee.
- **How:** USPTO provisional patent application. Can self-file or use a patent attorney ($2,000-3,000).

### Infrastructure: Set Up UptimeRobot Monitoring
- **What:** Create an UptimeRobot account and add monitors for relay health endpoint, portal, and dashboard.
- **Why:** External uptime monitoring with alerts. Free tier covers basic needs.
- **Time:** 15 min
- **How:** https://uptimerobot.com — add HTTP monitors for each public endpoint.

### Infrastructure: Set Up Daily Database Backups
- **What:** Configure a cron job on Mac Mini and VPS for daily SQLite and PostgreSQL backups.
- **Why:** Current RPO is 24 hours per the infrastructure plan. Without backups, a disk failure loses everything.
- **Time:** 15 min (Claude Code can write the cron job, but you need to verify it runs)
- **How:** Claude Code can automate this — just ask.

### Marketing: Write Launch Blog Post
- **What:** Write or review a blog post explaining what AXIP is, why agent-to-agent commerce matters, and how to get started.
- **Why:** LCH-1. Content for HN, Twitter, and LinkedIn on launch day. Claude Code can draft it, but you should review and publish.
- **Time:** 1-2 hours to review/edit a Claude-drafted post.
- **How:** Claude Code drafts, you review and publish on your blog or Medium.

### Community: Apply to Cloud Startup Programs
- **What:** Apply to AWS Activate, GCP for Startups, and Azure for Startups for free cloud credits.
- **Why:** $1,000-100,000 in free credits for when you outgrow Hetzner. Applications take 1-2 weeks.
- **Time:** 30 min per application.
- **How:** aws.amazon.com/activate, cloud.google.com/startup, azure.microsoft.com/startups.

---

## Summary

| Category | Items | Total Est. Time |
|----------|-------|----------------|
| Do Now (before next weekend) | 4 | ~45 min |
| Do Week 3-4 | 6 | ~1.5 hours + wait times |
| Do Before Launch | 9 | ~8-12 hours (legal is the big one) |
| Nice to Have | 8 | ~6-10 hours |
| **Total** | **27** | **~16-24 hours of Elias time** |

> The single biggest time investment is legal (ToS + Privacy Policy + Developer Agreement). Consider Clerky or Stripe Atlas templates to save cost and time, then get formal review post-launch when revenue starts.
