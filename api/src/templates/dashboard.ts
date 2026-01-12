/**
 * Dashboard HTML template generator
 * Orchestrates dashboard components for comprehensive analytics view
 */

import type { Metrics } from "../interfaces";
import {
  generatePageWrapper,
  generateCard,
  generateGrid,
  generateEmptyState,
} from "./components/layout";
import {
  generateDashboardMetrics,
  calculateQualityScore,
  calculateSuccessRate,
} from "./components/metrics";
import {
  generateBarChart,
  generateRepoChart,
  generateQualityBoxes,
  generateDonutChart,
} from "./components/charts";
import {
  generateQueriesTable,
  generateToolCallsTable,
} from "./components/tables";

/**
 * Generate the complete dashboard HTML page
 */
export function generateDashboardHtml(metrics: Metrics): string {
  const content =
    metrics.totalQueries === 0 && (metrics.totalToolCalls || 0) === 0
      ? generateEmptyState("No activity recorded yet", {
          icon: "📊",
          action: { label: "Refresh", onclick: "location.reload()" },
        })
      : generateDashboardContent(metrics);

  return generatePageWrapper(content, {
    title: "MCP Analytics",
    description: "Midnight MCP Server Analytics Dashboard",
    refreshable: true,
    lastUpdated: metrics.lastUpdated,
  });
}

/**
 * Generate the main dashboard content
 */
function generateDashboardContent(metrics: Metrics): string {
  const totalToolCalls = metrics.totalToolCalls || 0;
  const toolCallsByName = metrics.toolCallsByName || {};
  const recentToolCalls = metrics.recentToolCalls || [];

  // Calculate derived metrics
  const qualityScore = calculateQualityScore(metrics.scoreDistribution);
  const successRate = calculateSuccessRate(recentToolCalls);

  return `
    ${generateDashboardMetrics({
      totalToolCalls,
      totalQueries: metrics.totalQueries,
      qualityScore,
      successRate,
    })}
    
    ${generateOverviewSection(metrics, totalToolCalls, toolCallsByName)}
    
    ${generateActivitySection(metrics, recentToolCalls)}
    
    ${generateInsightsSection(metrics, qualityScore)}
  `;
}

/**
 * Generate overview section with charts
 */
function generateOverviewSection(
  metrics: Metrics,
  totalToolCalls: number,
  toolCallsByName: Record<string, number>
): string {
  const toolUsageCard = generateCard(
    generateBarChart(toolCallsByName, totalToolCalls, {
      maxItems: 8,
      emptyMessage: "No tool usage data",
    }),
    { title: "Tool Usage" }
  );

  const searchByTypeCard = generateCard(
    generateBarChart(metrics.queriesByEndpoint, metrics.totalQueries, {
      maxItems: 5,
      emptyMessage: "No search data",
    }),
    { title: "Search by Type" }
  );

  const qualityCard = generateCard(
    generateQualityBoxes(metrics.scoreDistribution),
    { title: "Search Quality Distribution" }
  );

  const repoCard = generateCard(
    generateRepoChart(metrics.documentsByRepo, {
      maxItems: 5,
      emptyMessage: "No repositories indexed",
    }),
    { title: "Top Repositories" }
  );

  return generateGrid([toolUsageCard, searchByTypeCard, qualityCard, repoCard]);
}

/**
 * Generate activity section with recent data tables
 */
function generateActivitySection(
  metrics: Metrics,
  recentToolCalls: Metrics["recentToolCalls"]
): string {
  const toolCallsCard = generateCard(
    generateToolCallsTable(recentToolCalls || [], {
      maxRows: 10,
      emptyMessage: "No recent tool calls",
    }),
    { title: "Recent Tool Calls" }
  );

  const queriesCard = generateCard(
    generateQueriesTable(metrics.recentQueries, {
      maxRows: 10,
      emptyMessage: "No recent searches",
    }),
    { title: "Recent Searches" }
  );

  return generateGrid([toolCallsCard, queriesCard]);
}

/**
 * Generate insights section with analytics
 */
function generateInsightsSection(
  metrics: Metrics,
  qualityScore: number
): string {
  // Calculate additional insights
  const totalSearches = metrics.totalQueries;
  const highQualitySearches = metrics.scoreDistribution.high;
  const highQualityRate =
    totalSearches > 0
      ? Math.round((highQualitySearches / totalSearches) * 100)
      : 0;

  // Most used tools
  const toolCallsByName = metrics.toolCallsByName || {};
  const topTools = Object.entries(toolCallsByName)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  // Most searched types
  const topEndpoints = Object.entries(metrics.queriesByEndpoint)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3);

  const insightsHtml = `
    <div class="insights-grid">
      <div class="insight-card">
        ${generateDonutChart(qualityScore, "Quality", { color: getQualityColor(qualityScore) })}
        <div class="insight-details">
          <h4>Search Quality</h4>
          <p>${getQualityMessage(qualityScore)}</p>
        </div>
      </div>
      
      <div class="insight-card">
        <div class="insight-stats">
          <div class="insight-stat">
            <span class="stat-number">${highQualityRate}%</span>
            <span class="stat-desc">High Quality Rate</span>
          </div>
          <div class="insight-stat">
            <span class="stat-number">${metrics.scoreDistribution.low}</span>
            <span class="stat-desc">Low Quality Searches</span>
          </div>
        </div>
      </div>
      
      <div class="insight-card">
        <h4>Top Tools</h4>
        <ul class="insight-list">
          ${topTools.map(([name, count]) => `<li><span>${name}</span><span class="tag info">${count}</span></li>`).join("")}
        </ul>
      </div>
      
      <div class="insight-card">
        <h4>Top Search Types</h4>
        <ul class="insight-list">
          ${topEndpoints.map(([name, count]) => `<li><span>${name}</span><span class="tag info">${count}</span></li>`).join("")}
        </ul>
      </div>
    </div>
  `;

  return generateCard(insightsHtml, {
    title: "Insights",
    fullWidth: true,
    className: "insights-section",
  });
}

/**
 * Get quality color based on score
 */
function getQualityColor(score: number): string {
  if (score >= 70) return "var(--success)";
  if (score >= 40) return "var(--warning)";
  return "var(--error)";
}

/**
 * Get quality message based on score
 */
function getQualityMessage(score: number): string {
  if (score >= 80) return "Excellent! Searches are highly effective.";
  if (score >= 60) return "Good quality. Most searches find relevant content.";
  if (score >= 40) return "Fair quality. Consider improving query patterns.";
  return "Needs improvement. Review indexing and query strategies.";
}
