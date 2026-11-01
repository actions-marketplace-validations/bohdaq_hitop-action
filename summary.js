// Writes the job summary from hitop's report.json (spec: https://github.com/bohdaq/hitop/blob/main/spec/run-report.md)
// and sets the action's outcome from hitop's exit code.
const fs = require('fs');

const esc = (s) =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const ms = (n) => (n == null ? '' : n >= 1000 ? `${(n / 1000).toFixed(2)} s` : `${n} ms`);
const MAX_ROWS = 500;

function readReport(file) {
  if (!file) return { report: null, note: null };
  try {
    const report = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (report.reportVersion !== 1) {
      return { report: null, note: `report.json has reportVersion ${report.reportVersion}; this action reads version 1, so the summary only shows the exit code. Update the action.` };
    }
    return { report, note: null };
  } catch (e) {
    return { report: null, note: `Could not read report.json: ${e.message}` };
  }
}

function table(head, rows) {
  const th = head.map((h) => `<th>${esc(h)}</th>`).join('');
  const trs = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('\n');
  return `<table><thead><tr>${th}</tr></thead><tbody>\n${trs}\n</tbody></table>\n`;
}

function render(report) {
  const s = report.summary;
  let md = table(
    ['', 'Total', 'Passed', 'Failed'],
    [
      ['Requests', s.requests.total, s.requests.passed, s.requests.failed],
      ['Assertions', s.assertions.total, s.assertions.passed, s.assertions.failed],
    ],
  );
  md += `\n${s.collections} collection(s), ${s.iterations} iteration(s), ${ms(report.durationMs)}, hitop ${esc(report.tool?.version)}.`;
  if (report.bailed) md += ' Stopped at the first failure (--bail): later requests did not run.';
  md += '\n\n';

  const rows = [];
  const failed = [];
  for (const c of report.collections || []) {
    for (const it of c.iterations || []) {
      const where = (c.iterations.length > 1 ? `${c.name} (iteration ${it.iteration})` : c.name) +
        (c.environment ? `, env ${c.environment}` : '');
      for (const r of it.requests || []) {
        const row = [
          r.passed ? '✅' : '❌',
          esc(where),
          `${esc(r.method)} ${esc(r.name)}`,
          r.status ?? '',
          ms(r.responseTimeMs),
          esc(r.failure ?? ''),
        ];
        rows.push(row);
        if (!r.passed) {
          failed.push({ where, r });
        }
      }
    }
  }

  if (failed.length) {
    md += `### Failed requests\n\n`;
    for (const { where, r } of failed.slice(0, MAX_ROWS)) {
      md += `**${esc(r.name)}** <sub>${esc(where)}</sub>: <code>${esc(r.method)} ${esc(r.url)}</code>\n\n`;
      if (r.error) md += `- Error: ${esc(r.error)}\n`;
      else if (r.status != null && r.status >= 400) md += `- HTTP ${r.status}\n`;
      for (const a of r.assertions || []) {
        if (!a.passed) md += `- ✗ ${esc(a.name)}${a.message ? `: ${esc(a.message)}` : ''}\n`;
      }
      md += '\n';
    }
    if (failed.length > MAX_ROWS) md += `…and ${failed.length - MAX_ROWS} more.\n\n`;
  }

  const shown = rows.slice(0, MAX_ROWS);
  md += `<details${failed.length ? '' : ' open'}><summary>All requests (${rows.length})</summary>\n\n`;
  md += table(['', 'Collection', 'Request', 'Status', 'Time', 'Failure'], shown);
  if (rows.length > MAX_ROWS) md += `\n…and ${rows.length - MAX_ROWS} more; see the JUnit artifact.\n`;
  md += '\n</details>\n';
  return md;
}

module.exports = async function finish({ core, env }) {
  const code = env.HITOP_EXIT_CODE === undefined || env.HITOP_EXIT_CODE === '' ? null : Number(env.HITOP_EXIT_CODE);
  const { report, note } = readReport(env.HITOP_REPORT_FILE);

  let verdict;
  if (code === 0) verdict = 'passed';
  else if (code === 1) verdict = report ? `failed: ${report.summary.requests.failed} of ${report.summary.requests.total} requests` : 'failed';
  else if (code === 2) verdict = 'usage or configuration error (exit code 2), see the log';
  else if (code === null) verdict = 'did not run';
  else verdict = `stopped with exit code ${code} (docker or runner error), see the log`;

  if (env.HITOP_SUMMARY !== 'false') {
    let md = `## ${code === 0 ? '✅' : '❌'} hitop run ${esc(verdict)}\n\n`;
    if (report) md += render(report);
    else if (note) md += `${esc(note)}\n`;
    else if (code === 0 || code === 1) md += 'Add json to the reporter input for a per request summary.\n';
    await core.summary.addRaw(md).write();
  }

  if (code !== 0) core.setFailed(`hitop run ${verdict}`);
};
