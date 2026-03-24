#!/usr/bin/env node
/**
 * Seed a real assessment for American Heritage Financial (Pensacola, FL)
 * into Eli's DB with proper rubric-scored workflows.
 *
 * Based on public research of AHF — an independent marketing organization (IMO)
 * with ~20 corporate staff + 200+ independent agents across 8+ offices in FL/AL/AR.
 *
 * Industry rate: $75/hr (financial services / professional services)
 *
 * Usage:
 *   node demo/seed-ahf-assessment.js          # seed
 *   node demo/seed-ahf-assessment.js --clean  # remove
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';

const ELI_DB = '/Users/elias/eli-agent/data/eli.db';
const CLIENT_NAME = 'American Heritage Financial';

if (!existsSync(ELI_DB)) {
  console.error('Eli DB not found at', ELI_DB);
  process.exit(1);
}

const db = new Database(ELI_DB);

// ── Clean mode ──────────────────────────────────────────────
if (process.argv.includes('--clean')) {
  const rows = db.prepare('SELECT id FROM assessments WHERE client_name = ?').all(CLIENT_NAME);
  for (const row of rows) {
    db.prepare('DELETE FROM assessment_workflows WHERE assessment_id = ?').run(row.id);
    db.prepare('DELETE FROM assessments WHERE id = ?').run(row.id);
    console.log(`Removed assessment id: ${row.id}`);
  }
  if (rows.length === 0) console.log('No assessment found.');
  db.close();
  process.exit(0);
}

// ── Check existing ──────────────────────────────────────────
const existing = db.prepare("SELECT id FROM assessments WHERE client_name = ? AND status IN ('scored','reported')").get(CLIENT_NAME);
if (existing) {
  console.log(`Assessment already exists (id: ${existing.id}). Use --clean to remove.`);
  db.close();
  process.exit(0);
}

// ── Create assessment ───────────────────────────────────────
const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
const fiveDaysAgo = new Date(Date.now() - 5 * 86400000).toISOString().replace('T', ' ').slice(0, 19);

const result = db.prepare(`
  INSERT INTO assessments (client_name, industry, employee_count, tool_stack, ai_maturity, decision_maker, raw_intake, status, created_at, completed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`).run(
  CLIENT_NAME,
  'Financial Services / Insurance Distribution',
  '~20 staff + 200+ agents',
  'Microsoft 365, WordPress, CRM (Redtail/Wealthbox), OneAmerica Securities compliance, Firelight/iPipeline e-apps, NIPR, carrier portals, Facebook Pixel',
  'None',
  'Craig Jernigan (CEO/Founder), Capt. Terrence Shashaty (President)',
  JSON.stringify({
    company: CLIENT_NAME,
    type: 'Independent Marketing Organization (IMO)',
    hq: 'Cantonment, FL (Pensacola area)',
    offices: 8,
    revenue: '$6.2M',
    agent_model: '100% commission, 1099 independent contractors',
    pain_quote: "My dispatcher spends half her day on the phone just confirming appointments that people already booked online.",
    concerns: [
      'Craig has been CEO since 2013 — needs his buy-in',
      'New president (Navy Captain) may bring operational discipline',
      'FINRA compliance means any automation touching client data must be vetted',
      '200+ independent contractors — cannot mandate tool adoption',
      'Agent population skews older in some offices'
    ]
  }),
  'scored',
  fiveDaysAgo,
  now
);

const assessmentId = result.lastInsertRowid;
console.log(`Created assessment id: ${assessmentId}`);

// ── Insert scored workflows ─────────────────────────────────
const RATE = 75; // Financial services professional rate

const insertWorkflow = db.prepare(`
  INSERT INTO assessment_workflows (
    assessment_id, workflow_name, owner_role, frequency,
    hours_per_occurrence, people_involved, annual_hours_consumed,
    repetition_density, rule_based_potential, error_impact,
    integration_readiness, roi_accessibility,
    composite_score, tier, tier_override_applied,
    annual_hours_recoverable, estimated_annual_value,
    automation_approach, implementation_complexity,
    estimated_implementation_time, risks, recommendation,
    score_justifications, created_at
  ) VALUES (
    ?, ?, ?, ?,
    ?, ?, ?,
    ?, ?, ?,
    ?, ?,
    ?, ?, ?,
    ?, ?,
    ?, ?,
    ?, ?, ?,
    ?, ?
  )
`);

const workflows = [
  {
    name: 'Commission Processing & Reconciliation',
    owner: 'Accounting / Operations',
    frequency: 'Weekly',
    hoursPerOcc: 6, people: 2, freqPerYear: 52,
    scores: { rep: 3, rule: 4, error: 5, integ: 2, roi: 4 },
    approach: 'Automated carrier statement ingestion with OCR/CSV parsing. Rule-based reconciliation engine matches payments to agent production records. Override calculations automated per managing partner hierarchy. Discrepancies flagged for human review. Charge-back detection alerts.',
    complexity: 'High',
    timeline: '6-8 weeks',
    risks: JSON.stringify([
      'Each carrier statement format requires custom parser — 5-10 carrier formats to support',
      'Override hierarchy is complex — managing partner splits vary by product and agent tier',
      'Charge-back timing varies by carrier (30-365 days) — must track long-tail adjustments'
    ]),
    justifications: JSON.stringify({
      repetition_density: 'Weekly processing for 200+ agents across multiple carriers. Consistent cadence, moderate volume.',
      rule_based_potential: 'Commission calculation is math. Override rules are codifiable. Only dispute resolution needs judgment.',
      error_impact: 'Wrong commission payments cause agent distrust and potential legal issues. Override errors affect managing partner compensation. Critical financial impact.',
      integration_readiness: 'Carrier statements arrive in different formats (PDF, CSV, portal-only). No unified data pipeline exists. Significant integration work needed.',
      roi_accessibility: 'Processing time reduction measurable immediately. Error rate reduction trackable within 2 pay cycles. Agent satisfaction measurable.'
    })
  },
  {
    name: 'Lead Distribution & Follow-up Tracking',
    owner: 'Managing Partners / Office Managers',
    frequency: 'Daily',
    hoursPerOcc: 1.5, people: 3, freqPerYear: 260,
    scores: { rep: 4, rule: 4, error: 3, integ: 3, roi: 5 },
    approach: 'Automated lead routing based on geography, agent specialization, and capacity. CRM integration for real-time follow-up tracking. Alerts to managing partners when leads go untouched >24 hours. Attribution tracking from seminar/web inquiry to closed policy.',
    complexity: 'Medium',
    timeline: '3-4 weeks',
    risks: JSON.stringify([
      'Agent adoption of CRM follow-up logging may be inconsistent — 1099 contractors cannot be forced',
      'Lead routing rules need managing partner buy-in per office',
      'Attribution tracking requires consistent tagging across seminar and web channels'
    ]),
    justifications: JSON.stringify({
      repetition_density: 'Daily across all 8 offices. Every seminar attendee and web inquiry needs routing. High volume.',
      rule_based_potential: 'Geography + specialty matching is rule-based. Follow-up cadence is templatable. Only priority judgment needs human input.',
      error_impact: 'Lost leads = lost revenue. At $1,200-3,500 per average policy, even 10% improvement is significant. But individual miss is recoverable.',
      integration_readiness: 'CRM exists but usage is inconsistent. Web form data is structured. Some API availability.',
      roi_accessibility: 'Lead-to-appointment conversion rate directly measurable. Revenue per lead attributable within 30 days.'
    })
  },
  {
    name: 'Post-Event Follow-up Sequences',
    owner: 'Agents / Office Staff',
    frequency: 'Monthly',
    hoursPerOcc: 3, people: 2, freqPerYear: 36, // ~3 events/month
    scores: { rep: 3, rule: 5, error: 3, integ: 3, roi: 5 },
    approach: 'Automated 4-touch drip sequence triggered by seminar attendance. Day 1: thank-you + recap. Day 3: check-in. Day 7: specific follow-up based on interest noted. Day 14: personal call from agent (task assigned in CRM). Only replies and Day 14 calls require human involvement.',
    complexity: 'Low',
    timeline: '2-3 weeks',
    risks: JSON.stringify([
      'Must not feel like spam — personalization from seminar notes is critical',
      'Agents need visibility into sequence status to avoid duplicate outreach',
      'Compliance review needed on automated financial services communications'
    ]),
    justifications: JSON.stringify({
      repetition_density: '2-4 seminars per month across offices. Each generates 20-40 attendees needing follow-up. Monthly cadence.',
      rule_based_potential: 'Drip sequence timing and content are fully templatable. Only Day 14 personal call requires judgment.',
      error_impact: 'Dropped follow-ups lose warm prospects. Seminar cost ($500-2000/event) wasted if attendees are not converted.',
      integration_readiness: 'CRM and email/SMS tools available. RSVP data exists in spreadsheets that can be imported.',
      roi_accessibility: 'Seminar-to-appointment conversion rate directly measurable. ROI per event calculable within 30 days.'
    })
  },
  {
    name: 'Agent Licensing & CE Tracking',
    owner: 'Agent Support',
    frequency: 'Monthly',
    hoursPerOcc: 3, people: 1, freqPerYear: 12,
    scores: { rep: 2, rule: 4, error: 5, integ: 3, roi: 3 },
    approach: 'Automated NIPR license status monitoring for all 200+ agents across 9+ states. CE deadline alerts at 90, 60, 30 days. E&O insurance expiration tracking. Dashboard view of all agent compliance status. Automatic holds on agent selling ability when licenses lapse.',
    complexity: 'Medium',
    timeline: '4-6 weeks',
    risks: JSON.stringify([
      'NIPR API access may have per-query costs that scale with agent count',
      'State-by-state CE requirement rules are complex and change periodically',
      'Securities licenses (Series 6/63/65) tracked separately via OneAmerica — integration needed'
    ]),
    justifications: JSON.stringify({
      repetition_density: 'Monthly monitoring cycle. But alerts are event-triggered throughout the month.',
      rule_based_potential: 'License expiration dates are data. CE requirements are rules. Alerts are automated. Only exception handling needs judgment.',
      error_impact: 'Agent selling with expired license is a regulatory violation — fines, E&O claims, potential agency sanctions. Critical.',
      integration_readiness: 'NIPR has an API. State DOI data is partially accessible. Some manual checking still required for edge cases.',
      roi_accessibility: 'Compliance violation prevention is valuable but hard to quantify in dollars until an incident occurs.'
    })
  },
  {
    name: 'Client Seminar & Event Coordination',
    owner: 'Event Coordinator (Christine Schrader)',
    frequency: 'Monthly',
    hoursPerOcc: 8, people: 3, freqPerYear: 36, // ~3/month
    scores: { rep: 3, rule: 3, error: 3, integ: 2, roi: 3 },
    approach: 'Semi-automated event workflow: venue booking templates, RSVP management system (web form + SMS confirmation), invitation mail merge from prospect lists, post-event task automation. Manual: venue selection, menu choices, speaker coordination.',
    complexity: 'Medium',
    timeline: '4-6 weeks',
    risks: JSON.stringify([
      'Venue relationships are personal — automation can augment but not replace the coordinator',
      'RSVP accuracy critical for catering counts — overbooking wastes money, underbooking loses prospects',
      'Compliance review needed for seminar invitation language'
    ]),
    justifications: JSON.stringify({
      repetition_density: '2-4 events per month across 8 offices. Consistent monthly cadence.',
      rule_based_potential: 'Mixed — RSVPs and invitations are templatable, but venue selection and event design need judgment.',
      error_impact: 'Overbooking wastes $500-2000. No-shows reduce ROI. But individual event failure is recoverable.',
      integration_readiness: 'Mostly manual today — spreadsheets, email, phone. No event management platform in place.',
      roi_accessibility: 'Event cost vs. policies sold is measurable but requires tracking pipeline from event to close.'
    })
  },
  {
    name: 'Agent Onboarding & Contracting',
    owner: 'Agent Support Manager',
    frequency: 'Weekly',
    hoursPerOcc: 4, people: 2, freqPerYear: 52,
    scores: { rep: 3, rule: 4, error: 4, integ: 3, roi: 3 },
    approach: 'Digital onboarding checklist with automated carrier contracting submissions. NIPR license verification on intake. Automated appointment tracking across carriers. Status dashboard showing each new agent\'s contracting progress. Reduces onboarding from 2-3 weeks to under 1 week.',
    complexity: 'Medium',
    timeline: '4-6 weeks',
    risks: JSON.stringify([
      'Each carrier has unique contracting requirements — may need carrier-specific adapters',
      'State licensing reciprocity rules vary and change',
      'Compliance review of agent backgrounds must remain manual (FINRA requirement)'
    ]),
    justifications: JSON.stringify({
      repetition_density: '3-5 new agents per month. Weekly processing of in-progress onboardings.',
      rule_based_potential: 'Checklist steps are defined. Carrier appointment requirements are documented. License verification is data lookup.',
      error_impact: 'Agent selling before fully appointed means policies rejected. Missed license renewals = regulatory violation. Significant.',
      integration_readiness: 'OneAmerica contracting portal, NIPR, and carrier portals have varying API availability. Some manual bridging needed.',
      roi_accessibility: 'Time-to-production reduction measurable. But ROI depends on agent retention which takes months to prove.'
    })
  },
  {
    name: 'Agent Production Reporting',
    owner: 'Operations Manager',
    frequency: 'Monthly',
    hoursPerOcc: 5, people: 1, freqPerYear: 12,
    scores: { rep: 2, rule: 4, error: 3, integ: 2, roi: 3 },
    approach: 'Automated carrier portal data aggregation across 5-10 carriers. Standardized production dashboard with agent rankings, managing partner roll-ups, and Eagle Campaign incentive tracking. Auto-distributed to managing partners on the 5th of each month.',
    complexity: 'High',
    timeline: '6-8 weeks',
    risks: JSON.stringify([
      'Carrier portal scraping is fragile — portals change without notice',
      'Production attribution disputes between agents/offices need manual resolution',
      'Eagle Campaign rules may change annually — incentive logic must be configurable'
    ]),
    justifications: JSON.stringify({
      repetition_density: 'Monthly reporting cycle only. Low frequency.',
      rule_based_potential: 'Data aggregation and ranking are rule-based. Report formatting is templatable. Only production attribution disputes need judgment.',
      error_impact: 'Incorrect production numbers affect agent compensation perception and incentive qualification. Moderate impact.',
      integration_readiness: 'Carrier portals have different access methods — some API, some portal-only, some CSV export. Significant integration effort.',
      roi_accessibility: 'Time savings measurable but modest (5 hrs/month). Value is in data timeliness and accuracy, harder to quantify.'
    })
  },
  {
    name: 'Compliance Documentation & Audit Prep',
    owner: 'Compliance / Operations',
    frequency: 'Weekly',
    hoursPerOcc: 3, people: 2, freqPerYear: 52,
    scores: { rep: 3, rule: 3, error: 5, integ: 3, roi: 2 },
    approach: 'Document management system with automated filing rules. Suitability documentation templates pre-filled from CRM data. Quarterly audit prep automated — gap analysis report showing which agent files are incomplete. OneAmerica compliance portal integration.',
    complexity: 'High',
    timeline: '8-10 weeks',
    risks: JSON.stringify([
      'FINRA suitability requirements evolve — rules engine must be updateable',
      'Agent-filed documents may have inconsistent formats — standardization needed',
      'Compliance review itself cannot be fully automated — auditor judgment required'
    ]),
    justifications: JSON.stringify({
      repetition_density: 'Weekly ongoing documentation plus quarterly intensive audit prep.',
      rule_based_potential: 'Document filing rules are defined. Gap detection is data-driven. But suitability review requires human compliance judgment.',
      error_impact: 'Missing suitability docs = FINRA deficiency. E&O insurance gaps = agency liability. Critical regulatory risk.',
      integration_readiness: 'OneAmerica compliance portal available. CRM has some data. But multi-system document tracking is fragmented.',
      roi_accessibility: 'Compliance value is in risk avoidance — hard to quantify until a violation occurs. Audit prep time is measurable.'
    })
  },
  {
    name: 'Policy Service & Status Inquiries',
    owner: 'Office Staff / Agent Support',
    frequency: 'Daily',
    hoursPerOcc: 2, people: 2, freqPerYear: 260,
    scores: { rep: 4, rule: 3, error: 3, integ: 2, roi: 3 },
    approach: 'Unified client policy dashboard pulling status from multiple carrier portals. Self-service agent portal for common status checks (policy status, underwriting stage, payment history). Automated alerts for policy lapses and underwriting requirements.',
    complexity: 'High',
    timeline: '8-10 weeks',
    risks: JSON.stringify([
      'Carrier portal integration is the bottleneck — each requires separate authentication and data mapping',
      'Real-time data may not be available from all carriers — some update daily, some weekly',
      'HIPAA and financial privacy rules limit what can be displayed in a unified view'
    ]),
    justifications: JSON.stringify({
      repetition_density: 'Daily inquiries from agents and clients. High volume phone traffic.',
      rule_based_potential: 'Status lookup is data retrieval. But interpreting underwriting requirements and advising on next steps needs judgment.',
      error_impact: 'Incorrect status information given to clients damages trust. Missed policy lapse notifications can cause coverage gaps.',
      integration_readiness: 'Multiple carrier portals with different access methods. No unified API layer exists. Heavy integration work.',
      roi_accessibility: 'Phone time reduction measurable. Agent satisfaction improvable. But hard to tie directly to revenue.'
    })
  },
  {
    name: 'New Client Application Processing',
    owner: 'Office Staff / Agents',
    frequency: 'Daily',
    hoursPerOcc: 1.5, people: 2, freqPerYear: 260,
    scores: { rep: 4, rule: 4, error: 4, integ: 3, roi: 4 },
    approach: 'Standardized application intake form that validates required fields before submission. Smart routing to correct carrier e-app platform based on product type. NIGO (Not In Good Order) pre-screening to catch common errors. Automated status tracking and agent notification.',
    complexity: 'Medium',
    timeline: '4-6 weeks',
    risks: JSON.stringify([
      'Carrier e-app platforms (Firelight, iPipeline) have different integration capabilities',
      'Product-specific requirements mean routing logic is complex',
      'Replacement/1035 exchange paperwork has additional regulatory requirements'
    ]),
    justifications: JSON.stringify({
      repetition_density: 'Daily application submissions across all offices. Core business process.',
      rule_based_potential: 'Field validation is rule-based. Product routing follows decision tree. NIGO screening has defined criteria. Only complex cases need judgment.',
      error_impact: 'Application errors cause underwriting delays (days to weeks). NIGO rejections frustrate agents and clients. Replacement paperwork errors = compliance violation.',
      integration_readiness: 'Carrier e-app platforms exist with some API access. CRM can feed client data. Some manual bridging needed.',
      roi_accessibility: 'NIGO rate reduction measurable immediately. Time-to-issue trackable. Agent productivity impact clear within 30 days.'
    })
  },
  {
    name: 'Marketing Material Compliance Review',
    owner: 'Graphic Designer + Compliance',
    frequency: 'Weekly',
    hoursPerOcc: 6, people: 2, freqPerYear: 52,
    scores: { rep: 3, rule: 3, error: 4, integ: 2, roi: 2 },
    approach: 'Version-controlled marketing asset library with compliance status tracking. Automated distribution of approved materials to offices. Expiration dates on rate-sensitive materials with auto-archival. Template system for agent-customizable materials within approved guardrails.',
    complexity: 'Medium',
    timeline: '4-6 weeks',
    risks: JSON.stringify([
      'Compliance review itself cannot be automated — requires human judgment on financial claims',
      'Agent adoption of central library vs. using old materials is a change management challenge',
      'Rate changes from carriers require rapid material updates across 8 offices'
    ]),
    justifications: JSON.stringify({
      repetition_density: 'Weekly creation and review cycle for materials across 8 offices.',
      rule_based_potential: 'Distribution and version control are rule-based. But compliance review of financial claims requires human judgment.',
      error_impact: 'Non-compliant materials distributed to clients = FINRA violation, potential fines, reputational damage. Significant.',
      integration_readiness: 'Design tools and file storage are digital but disconnected. No asset management platform in place.',
      roi_accessibility: 'Time savings modest. Value is in risk avoidance and brand consistency — hard to quantify directly.'
    })
  },
  {
    name: 'Carrier Appointment Management',
    owner: 'Agent Support / Contracting',
    frequency: 'Weekly',
    hoursPerOcc: 2, people: 1, freqPerYear: 52,
    scores: { rep: 3, rule: 4, error: 4, integ: 2, roi: 3 },
    approach: 'Centralized appointment database tracking which agents are appointed with which carriers at which compensation levels. Automated appointment renewal reminders. Alerts when agents write business with unappointed carriers. Appointment-level commission tier verification.',
    complexity: 'Medium',
    timeline: '4-6 weeks',
    risks: JSON.stringify([
      'Carrier appointment data must be manually verified initially — no single source of truth exists',
      'Appointment termination notifications from carriers arrive inconsistently',
      'Compensation tier changes require carrier confirmation — cannot be assumed'
    ]),
    justifications: JSON.stringify({
      repetition_density: 'Weekly processing of new appointments, renewals, and terminations across 200+ agents.',
      rule_based_potential: 'Appointment tracking is data management. Renewal dates are calendar-driven. Commission tier lookup is structured.',
      error_impact: 'Writing business without appointment = policy rejected. Wrong compensation tier = agent paid incorrectly. Significant.',
      integration_readiness: 'Carrier portals and SureLC have data but are siloed. No unified appointment database exists.',
      roi_accessibility: 'Error prevention value is real but occurs irregularly. Processing time savings modest but consistent.'
    })
  }
];

// ── Apply scoring, classification, financials ───────────────
const insertMany = db.transaction(() => {
  for (const w of workflows) {
    const annualHours = w.hoursPerOcc * w.freqPerYear * w.people;
    const s = w.scores;
    const composite = (s.rep + s.rule + s.error + s.integ + s.roi) / 5;

    // Tier classification
    let tier;
    if (composite >= 4.0) tier = 'Quick Win';
    else if (composite >= 3.0) tier = 'Strategic Play';
    else if (composite >= 2.0) tier = 'Long-Term';
    else tier = 'Deprioritize';

    // Override rules
    let override = null;
    if (s.error === 5 && s.rule >= 3) {
      const tiers = ['Deprioritize', 'Long-Term', 'Strategic Play', 'Quick Win'];
      const idx = tiers.indexOf(tier);
      if (idx < 3) { tier = tiers[idx + 1]; override = 'error_impact=5 + rules>=3 → tier UP'; }
    }
    if (s.integ === 1) {
      const tiers = ['Deprioritize', 'Long-Term', 'Strategic Play', 'Quick Win'];
      const idx = tiers.indexOf(tier);
      if (idx > 0) { tier = tiers[idx - 1]; override = (override ? override + '; ' : '') + 'integration=1 → tier DOWN'; }
    }
    if (s.roi === 1) {
      const tiers = ['Deprioritize', 'Long-Term', 'Strategic Play', 'Quick Win'];
      const idx = tiers.indexOf(tier);
      if (idx > 0) { tier = tiers[idx - 1]; override = (override ? override + '; ' : '') + 'roi=1 → tier DOWN'; }
    }

    const automationRate = { 'Quick Win': 0.75, 'Strategic Play': 0.50, 'Long-Term': 0.30, 'Deprioritize': 0.10 }[tier];
    const hoursRecoverable = annualHours * automationRate;
    const estimatedValue = hoursRecoverable * RATE;

    insertWorkflow.run(
      assessmentId, w.name, w.owner, w.frequency,
      w.hoursPerOcc, w.people, annualHours,
      s.rep, s.rule, s.error, s.integ, s.roi,
      composite, tier, override,
      hoursRecoverable, estimatedValue,
      w.approach, w.complexity, w.timeline,
      w.risks, `${tier}: ${w.name} — composite ${composite.toFixed(1)}/5.0`,
      w.justifications, now
    );
  }
});

insertMany();

// ── Summary ─────────────────────────────────────────────────
const wfCount = db.prepare('SELECT COUNT(*) as c FROM assessment_workflows WHERE assessment_id = ?').get(assessmentId).c;
const totalValue = db.prepare('SELECT SUM(estimated_annual_value) as v FROM assessment_workflows WHERE assessment_id = ?').get(assessmentId).v;
const totalHours = db.prepare('SELECT SUM(annual_hours_recoverable) as h FROM assessment_workflows WHERE assessment_id = ?').get(assessmentId).h;
const quickWins = db.prepare("SELECT COUNT(*) as c FROM assessment_workflows WHERE assessment_id = ? AND tier = 'Quick Win'").get(assessmentId).c;
const strategic = db.prepare("SELECT COUNT(*) as c FROM assessment_workflows WHERE assessment_id = ? AND tier = 'Strategic Play'").get(assessmentId).c;

console.log(`\nAssessment seeded for "${CLIENT_NAME}"`);
console.log(`  Workflows:      ${wfCount}`);
console.log(`  Quick Wins:     ${quickWins}`);
console.log(`  Strategic Plays: ${strategic}`);
console.log(`  Hours/year:     ${totalHours.toFixed(0)} recoverable`);
console.log(`  Annual value:   $${Math.round(totalValue).toLocaleString()}`);
console.log(`  Industry rate:  $${RATE}/hr`);

db.close();
