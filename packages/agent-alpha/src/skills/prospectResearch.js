/**
 * Agent Alpha — Prospect Research Report Compiler
 *
 * Takes raw search results and compiles them into a structured
 * prospect research report. For the demo, uses template-based
 * generation. Future: Claude Sonnet/Opus call for intelligent synthesis.
 */

/**
 * Compile search results into a prospect research report.
 *
 * @param {string} companyName - The company being researched
 * @param {Object} searchData - Raw search results from Beta
 * @param {Object} metadata - AXIP task metadata
 * @returns {Object} Structured report
 */
export function compileReport(companyName, searchData, metadata = {}) {
  const results = searchData?.results || [];
  const sources = results.map(r => ({
    title: r.title,
    url: r.url,
    summary: r.summary,
    relevance: r.relevance
  }));

  // Extract key themes from the search results
  const allText = results.map(r => r.summary).join(' ');
  const hasFunding = allText.toLowerCase().includes('funding') || allText.toLowerCase().includes('series');
  const hasPartnership = allText.toLowerCase().includes('partner');
  const hasAI = allText.toLowerCase().includes('ai') || allText.toLowerCase().includes('agent');

  const keyFindings = [];
  if (hasFunding) keyFindings.push('Active funding history — indicates growth trajectory');
  if (hasPartnership) keyFindings.push('Strategic partnerships with major platforms');
  if (hasAI) keyFindings.push('Operating in AI/agent technology space');
  if (results.length > 0) keyFindings.push(`${results.length} recent sources found — company has media presence`);

  const report = {
    company: companyName,
    generated_at: new Date().toISOString(),
    generated_by: metadata.agentId || 'Agent Alpha',
    protocol: 'AXIP v0.1.0',

    sources,

    synthesis: {
      summary: `Based on ${results.length} sources, ${companyName} appears to be an active player in the enterprise AI space. ` +
        (hasFunding ? 'Recent funding activity suggests strong investor confidence. ' : '') +
        (hasPartnership ? 'Strategic partnerships indicate market traction and enterprise credibility. ' : '') +
        'The company represents a potential prospect for AI operating layer consultation.',
      key_findings: keyFindings,
      outreach_angle: `AI agent orchestration and enterprise integration — aligned with ${companyName}'s public strategy`,
      confidence: results.length >= 3 ? 0.85 : results.length >= 1 ? 0.65 : 0.3
    },

    axip_metadata: {
      search_delegated_to: metadata.searchAgentId || 'unknown',
      search_cost_usd: metadata.searchCost || 0,
      search_time_seconds: metadata.searchTime || 0,
      total_task_cost_usd: metadata.totalCost || 0,
      reputation_update: metadata.reputationUpdate || null
    }
  };

  return report;
}
