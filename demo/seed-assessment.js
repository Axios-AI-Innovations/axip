#!/usr/bin/env node
/**
 * Seed a realistic completed assessment into Eli's DB.
 *
 * This creates a demo assessment for "Summit Plumbing & HVAC" —
 * a 22-employee service business with 10 workflows scored against
 * the Axios Automation Assessment Rubric (5 dimensions, 1-5 scale).
 *
 * The data is designed to look real when shown on the dashboard
 * as a sample client engagement. All numbers are plausible for
 * a mid-size service company.
 *
 * Usage:
 *   node demo/seed-assessment.js          # seed
 *   node demo/seed-assessment.js --clean  # remove seeded data
 */

import Database from 'better-sqlite3';
import { existsSync } from 'fs';

const ELI_DB = '/Users/elias/eli-agent/data/eli.db';
const CLIENT_NAME = 'Summit Plumbing & HVAC';

if (!existsSync(ELI_DB)) {
  console.error('Eli DB not found at', ELI_DB);
  process.exit(1);
}

const db = new Database(ELI_DB);

// ── Clean mode ──────────────────────────────────────────────
if (process.argv.includes('--clean')) {
  const assessment = db.prepare('SELECT id FROM assessments WHERE client_name = ?').get(CLIENT_NAME);
  if (assessment) {
    db.prepare('DELETE FROM assessment_workflows WHERE assessment_id = ?').run(assessment.id);
    db.prepare('DELETE FROM assessments WHERE id = ?').run(assessment.id);
    console.log(`Removed assessment for "${CLIENT_NAME}" (id: ${assessment.id})`);
  } else {
    console.log(`No assessment found for "${CLIENT_NAME}"`);
  }
  db.close();
  process.exit(0);
}

// ── Check if already seeded ─────────────────────────────────
const existing = db.prepare('SELECT id FROM assessments WHERE client_name = ?').get(CLIENT_NAME);
if (existing) {
  console.log(`Assessment for "${CLIENT_NAME}" already exists (id: ${existing.id}). Use --clean to remove.`);
  db.close();
  process.exit(0);
}

// ── Seed assessment ─────────────────────────────────────────
const now = new Date().toISOString().replace('T', ' ').slice(0, 19);
const threeDaysAgo = new Date(Date.now() - 3 * 86400000).toISOString().replace('T', ' ').slice(0, 19);

const insertAssessment = db.prepare(`
  INSERT INTO assessments (client_name, industry, employee_count, tool_stack, ai_maturity, decision_maker, raw_intake, status, created_at, completed_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const result = insertAssessment.run(
  CLIENT_NAME,
  'Home Services',
  '22',
  'ServiceTitan, QuickBooks, Google Workspace, Podium (reviews), Housecall Pro (backup scheduling)',
  'None',
  'Dave Kowalski, Owner',
  JSON.stringify({
    company: CLIENT_NAME,
    industry: 'Home Services (Plumbing & HVAC)',
    employees: 22,
    departments: ['Field Technicians (12)', 'Office/Dispatch (4)', 'Sales (2)', 'Management (2)', 'Accounting (2)'],
    tools: ['ServiceTitan', 'QuickBooks', 'Google Workspace', 'Podium', 'Housecall Pro'],
    budget_signal: '$800-1200/month on software tools',
    concerns: ['Doesn\'t want to lose the personal touch', 'Worried about tech breaking mid-day', 'Had a bad experience with a CRM migration 2 years ago'],
    pain_quote: 'My dispatcher spends half her day on the phone just confirming appointments that people already booked online.'
  }),
  'scored',
  threeDaysAgo,
  now
);

const assessmentId = result.lastInsertRowid;
console.log(`Created assessment id: ${assessmentId}`);

// ── Seed workflows ──────────────────────────────────────────
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

// Blended hourly rate for home services: $40/hr
const RATE = 40;

const workflows = [
  {
    name: 'Appointment Confirmation Calls',
    owner: 'Dispatcher',
    frequency: 'Daily',
    hoursPerOcc: 2.5,
    people: 1,
    freqPerYear: 260,
    scores: { rep: 5, rule: 5, error: 3, integ: 4, roi: 5 },
    approach: 'Automated SMS/voice confirmation 24hr before appointment. Customer replies Y/N. Only no-responses escalate to dispatcher. ServiceTitan API integration for schedule sync.',
    complexity: 'Low',
    timeline: '1-2 weeks',
    risks: JSON.stringify(['Some older customers prefer phone calls — need opt-out list', 'ServiceTitan API rate limits during peak booking hours']),
    justifications: JSON.stringify({
      repetition_density: '260 days/year, every single day without exception. Core operational rhythm.',
      rule_based_potential: 'Fully templated: pull tomorrow\'s appointments, send confirmation message, log response. Zero judgment needed.',
      error_impact: 'Missed confirmations lead to no-shows ($150-300 per missed appointment). Moderate but frequent impact.',
      integration_readiness: 'ServiceTitan has REST API. SMS via Twilio is straightforward. Schedule data is structured.',
      roi_accessibility: 'Time savings immediately visible in dispatcher hours. No-show rate directly measurable week over week.'
    })
  },
  {
    name: 'Review Request Follow-ups',
    owner: 'Office Manager',
    frequency: 'Daily',
    hoursPerOcc: 1.0,
    people: 1,
    freqPerYear: 260,
    scores: { rep: 4, rule: 5, error: 2, integ: 4, roi: 4 },
    approach: 'Automated review request via SMS 2 hours after job completion. Positive sentiment routes to Google/Yelp. Negative sentiment triggers internal alert for follow-up. Podium API integration.',
    complexity: 'Low',
    timeline: '1-2 weeks',
    risks: JSON.stringify(['Over-solicitation fatigue — need frequency caps per customer', 'Negative review routing must be reliable — missed negative = public complaint']),
    justifications: JSON.stringify({
      repetition_density: 'Every completed job triggers a review request. 8-12 jobs/day average.',
      rule_based_potential: 'Completely rule-based: job completed → wait 2hrs → send template → route by sentiment.',
      error_impact: 'Low direct impact if missed, but cumulative — fewer reviews = lower search ranking over time.',
      integration_readiness: 'Podium has API. ServiceTitan job completion status available. Google Business Profile API exists.',
      roi_accessibility: 'Review count and average rating measurable weekly. Direct correlation to new customer acquisition.'
    })
  },
  {
    name: 'Dispatching & Job Assignment',
    owner: 'Dispatcher',
    frequency: 'Daily',
    hoursPerOcc: 3.0,
    people: 2,
    freqPerYear: 260,
    scores: { rep: 5, rule: 3, error: 4, integ: 3, roi: 4 },
    approach: 'Semi-automated dispatch: system suggests optimal tech based on location, skill match, and availability. Dispatcher confirms or overrides. Reduces decision time from 5-10 min to 30 sec per job.',
    complexity: 'Medium',
    timeline: '4-6 weeks',
    risks: JSON.stringify(['Dispatcher override patterns need monitoring — if overriding >30%, algorithm needs tuning', 'Emergency/priority jobs need manual override path', 'Technician skill profiles must be maintained accurately']),
    justifications: JSON.stringify({
      repetition_density: 'Every job requires dispatch. 8-12 dispatches per day, 5 days/week minimum.',
      rule_based_potential: 'Mixed — proximity and skill matching are rule-based, but priority judgment and customer preferences require human input.',
      error_impact: 'Wrong dispatch = wasted drive time ($50-100), delayed customer, technician frustration. Significant cumulative cost.',
      integration_readiness: 'ServiceTitan has dispatch data but routing optimization requires additional logic layer. GPS data available.',
      roi_accessibility: 'Drive time reduction and jobs-per-day increase measurable within 30 days.'
    })
  },
  {
    name: 'Invoice Generation & Delivery',
    owner: 'Office Manager',
    frequency: 'Daily',
    hoursPerOcc: 1.5,
    people: 1,
    freqPerYear: 260,
    scores: { rep: 5, rule: 4, error: 4, integ: 4, roi: 5 },
    approach: 'Auto-generate invoice from ServiceTitan job record on completion. Pull parts, labor, and pricing from catalog. Send to customer via email/SMS. Flag exceptions (custom pricing, warranty claims) for human review.',
    complexity: 'Low',
    timeline: '2-3 weeks',
    risks: JSON.stringify(['Custom/negotiated pricing must be flagged — can\'t auto-send incorrect amounts', 'Warranty and insurance jobs have different billing paths']),
    justifications: JSON.stringify({
      repetition_density: 'Every completed job needs an invoice. 8-12 per day.',
      rule_based_potential: 'Standard jobs are fully templated. Only exceptions (custom pricing, warranties) need human review. ~80% automatable.',
      error_impact: 'Billing errors damage customer trust and create accounting reconciliation problems. Collections delays hurt cash flow.',
      integration_readiness: 'ServiceTitan to QuickBooks integration exists. Invoice templates are structured. Email delivery is standard.',
      roi_accessibility: 'Time to invoice (currently 24-48hrs) drops to same-day. Cash flow improvement measurable immediately.'
    })
  },
  {
    name: 'Missed Call Follow-up',
    owner: 'Receptionist',
    frequency: 'Daily',
    hoursPerOcc: 1.0,
    people: 1,
    freqPerYear: 260,
    scores: { rep: 4, rule: 5, error: 3, integ: 3, roi: 5 },
    approach: 'Automated SMS response to missed calls within 60 seconds: "Thanks for calling Summit! We missed your call. Reply with your issue and we\'ll get back to you ASAP, or book online at [link]." Log all in CRM.',
    complexity: 'Low',
    timeline: '1 week',
    risks: JSON.stringify(['Spam calls will trigger auto-response — need known-spam number filtering', 'Must comply with TCPA texting regulations']),
    justifications: JSON.stringify({
      repetition_density: 'Average 15-20 missed calls per day during business hours.',
      rule_based_potential: 'Fully rule-based: missed call → immediate SMS → log. No judgment required.',
      error_impact: 'Every missed call is a potential lost customer ($500-2000 job value). Moderate individual impact, high cumulative.',
      integration_readiness: 'Phone system may need VoIP upgrade for API access. SMS integration straightforward via Twilio.',
      roi_accessibility: 'Callback rate from auto-SMS vs. no follow-up measurable immediately. Direct revenue attribution possible.'
    })
  },
  {
    name: 'Estimate Follow-up Sequence',
    owner: 'Sales',
    frequency: 'Weekly',
    hoursPerOcc: 4.0,
    people: 2,
    freqPerYear: 52,
    scores: { rep: 3, rule: 4, error: 3, integ: 3, roi: 4 },
    approach: 'Automated drip sequence after estimate delivery: Day 1 (thank you + FAQ), Day 3 (check-in), Day 7 (soft close with limited-time offer). Human sales rep engaged only on replies or at Day 10 for personal call.',
    complexity: 'Low',
    timeline: '2 weeks',
    risks: JSON.stringify(['Must not feel like spam — personalization from original estimate is key', 'Sales team needs visibility into sequence status to avoid duplicate outreach']),
    justifications: JSON.stringify({
      repetition_density: 'Weekly batch of 10-15 open estimates. Each needs 3-touch follow-up sequence.',
      rule_based_potential: 'Follow-up cadence and messaging are fully templatable. Only escalation to sales rep requires judgment.',
      error_impact: 'Dropped follow-ups = lost revenue. Average estimate $1,200-3,500. Even 10% conversion improvement is significant.',
      integration_readiness: 'ServiceTitan has estimate data. Email/SMS sequences need automation tool (could use built-in or external).',
      roi_accessibility: 'Estimate-to-close rate measurable monthly. Revenue impact directly attributable.'
    })
  },
  {
    name: 'Technician Timesheet Processing',
    owner: 'Accounting',
    frequency: 'Weekly',
    hoursPerOcc: 3.0,
    people: 1,
    freqPerYear: 52,
    scores: { rep: 3, rule: 4, error: 4, integ: 3, roi: 3 },
    approach: 'Auto-pull clock-in/out from ServiceTitan. Cross-reference with job completion times. Flag discrepancies >15 min for review. Auto-generate payroll summary for QuickBooks import.',
    complexity: 'Medium',
    timeline: '3-4 weeks',
    risks: JSON.stringify(['Union or labor law compliance for overtime calculation varies by state', 'Technicians may resist GPS-based time verification']),
    justifications: JSON.stringify({
      repetition_density: 'Weekly payroll cycle for 12 technicians. Consistent cadence.',
      rule_based_potential: 'Time calculation is math. Exception flagging follows rules. Only dispute resolution needs judgment.',
      error_impact: 'Payroll errors cause immediate employee dissatisfaction and potential labor violations. High stakes.',
      integration_readiness: 'ServiceTitan has time tracking. QuickBooks payroll integration exists but may need custom mapping.',
      roi_accessibility: 'Processing time reduction measurable immediately. Error rate reduction measurable within 2 pay periods.'
    })
  },
  {
    name: 'Parts Inventory Reordering',
    owner: 'Warehouse Manager',
    frequency: 'Weekly',
    hoursPerOcc: 2.0,
    people: 1,
    freqPerYear: 52,
    scores: { rep: 3, rule: 4, error: 3, integ: 2, roi: 3 },
    approach: 'Threshold-based reorder alerts when common parts fall below minimum stock. Auto-generate PO drafts for top 20 SKUs. Manager approves or modifies before submission.',
    complexity: 'Medium',
    timeline: '4-6 weeks',
    risks: JSON.stringify(['Seasonal demand variation (HVAC in summer, plumbing in winter) complicates threshold setting', 'Supplier lead times change — thresholds need periodic review']),
    justifications: JSON.stringify({
      repetition_density: 'Weekly inventory check and order cycle.',
      rule_based_potential: 'Reorder points and quantities are rule-based. Only non-standard parts or new suppliers need judgment.',
      error_impact: 'Stockouts delay jobs and frustrate customers. Overstock ties up cash. Moderate impact either way.',
      integration_readiness: 'Inventory tracking may be partially manual (spreadsheet). ServiceTitan has some parts tracking but may not cover warehouse inventory fully.',
      roi_accessibility: 'Stockout frequency and carrying cost measurable, but requires baseline measurement period.'
    })
  },
  {
    name: 'New Customer Onboarding',
    owner: 'Office Staff',
    frequency: 'Daily',
    hoursPerOcc: 0.5,
    people: 1,
    freqPerYear: 260,
    scores: { rep: 4, rule: 4, error: 2, integ: 4, roi: 3 },
    approach: 'Auto-create customer profile in ServiceTitan from booking form data. Send welcome SMS with what to expect, tech arrival window, and preparation checklist. No manual data entry needed.',
    complexity: 'Low',
    timeline: '1-2 weeks',
    risks: JSON.stringify(['Duplicate customer detection needed — same person, different phone/email', 'Commercial vs residential customers may need different onboarding flows']),
    justifications: JSON.stringify({
      repetition_density: '3-5 new customers per day. Every booking triggers onboarding.',
      rule_based_potential: 'Data entry and welcome messaging are fully templatable. Customer profile fields are structured.',
      error_impact: 'Low individual impact — misspelled name or wrong address corrected easily. But cumulative data quality matters.',
      integration_readiness: 'ServiceTitan has customer management API. Booking form data is structured. SMS integration exists.',
      roi_accessibility: 'Time savings are real but small per occurrence. Customer experience improvement harder to quantify.'
    })
  },
  {
    name: 'Monthly Financial Reporting',
    owner: 'Owner/Accounting',
    frequency: 'Monthly',
    hoursPerOcc: 6.0,
    people: 2,
    freqPerYear: 12,
    scores: { rep: 2, rule: 3, error: 4, integ: 3, roi: 2 },
    approach: 'Auto-pull revenue, expense categories, and job margins from QuickBooks + ServiceTitan. Generate draft P&L summary, job profitability ranking, and technician performance metrics. Owner reviews and adds commentary.',
    complexity: 'High',
    timeline: '6-8 weeks',
    risks: JSON.stringify(['Financial reporting accuracy is critical — must validate against actual QuickBooks data', 'Custom chart of accounts varies by business — needs per-client configuration', 'Owner may not trust automated numbers initially — requires parallel run period']),
    justifications: JSON.stringify({
      repetition_density: 'Monthly only. Low frequency reduces automation urgency.',
      rule_based_potential: 'Data aggregation is mechanical. But interpretation and commentary require owner judgment.',
      error_impact: 'Incorrect financial reports could drive bad business decisions. High stakes when wrong.',
      integration_readiness: 'QuickBooks API available. ServiceTitan reporting exists. But cross-system reconciliation is complex.',
      roi_accessibility: 'Hard to put a dollar value on faster reporting. Value is in better decisions, not time savings alone.'
    })
  }
];

// Apply scoring, tier classification, and financial estimates
const insertMany = db.transaction(() => {
  for (const w of workflows) {
    const annualHours = w.hoursPerOcc * w.freqPerYear * w.people;
    const scores = w.scores;
    const composite = (scores.rep + scores.rule + scores.error + scores.integ + scores.roi) / 5;

    // Tier classification
    let tier;
    if (composite >= 4.0) tier = 'Quick Win';
    else if (composite >= 3.0) tier = 'Strategic Play';
    else if (composite >= 2.0) tier = 'Long-Term';
    else tier = 'Deprioritize';

    // Override rules
    let override = null;
    if (scores.error === 5 && scores.rule >= 3) {
      if (tier === 'Strategic Play') { tier = 'Quick Win'; override = 'error_impact_upgrade'; }
      else if (tier === 'Long-Term') { tier = 'Strategic Play'; override = 'error_impact_upgrade'; }
    }
    if (scores.integ === 1) {
      if (tier === 'Quick Win') { tier = 'Strategic Play'; override = 'integration_downgrade'; }
      else if (tier === 'Strategic Play') { tier = 'Long-Term'; override = 'integration_downgrade'; }
    }
    if (scores.roi === 1) {
      if (tier === 'Quick Win') { tier = 'Strategic Play'; override = 'roi_downgrade'; }
      else if (tier === 'Strategic Play') { tier = 'Long-Term'; override = 'roi_downgrade'; }
    }

    // Automation rate by tier
    const automationRate = {
      'Quick Win': 0.75,
      'Strategic Play': 0.50,
      'Long-Term': 0.30,
      'Deprioritize': 0.10
    }[tier];

    const hoursRecoverable = annualHours * automationRate;
    const estimatedValue = hoursRecoverable * RATE;

    insertWorkflow.run(
      assessmentId,
      w.name,
      w.owner,
      w.frequency,
      w.hoursPerOcc,
      w.people,
      annualHours,
      scores.rep,
      scores.rule,
      scores.error,
      scores.integ,
      scores.roi,
      composite,
      tier,
      override,
      hoursRecoverable,
      estimatedValue,
      w.approach,
      w.complexity,
      w.timeline,
      w.risks,
      w.recommendation || `${tier}: ${w.name} — composite ${composite.toFixed(1)}/5.0`,
      w.justifications,
      now
    );
  }
});

insertMany();

// Summary
const wfCount = db.prepare('SELECT COUNT(*) as c FROM assessment_workflows WHERE assessment_id = ?').get(assessmentId).c;
const totalValue = db.prepare('SELECT SUM(estimated_annual_value) as v FROM assessment_workflows WHERE assessment_id = ?').get(assessmentId).v;
const totalHours = db.prepare('SELECT SUM(annual_hours_recoverable) as h FROM assessment_workflows WHERE assessment_id = ?').get(assessmentId).h;

console.log(`\nSeeded assessment for "${CLIENT_NAME}"`);
console.log(`  Workflows: ${wfCount}`);
console.log(`  Total recoverable hours: ${totalHours.toFixed(0)}/year`);
console.log(`  Estimated annual value: $${totalValue.toFixed(0)}`);

db.close();
