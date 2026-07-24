#!/usr/bin/env node

import { readFile, writeFile } from 'node:fs/promises';

const [input = '/results/results.json', output = '/results/report.md'] = process.argv.slice(2);
const data = JSON.parse(await readFile(input, 'utf8'));
const rows = data?.results?.results ?? [];
const stats = data?.results?.stats ?? {};

const clean = (value) => String(value ?? '')
  .replaceAll('\r', '')
  .replaceAll('```', "''' ");
const oneLine = (value) => clean(value).replaceAll('\n', ' ').replaceAll('|', '\\|');
const count = rows.length || (stats.successes ?? 0) + (stats.failures ?? 0) + (stats.errors ?? 0);
const passes = stats.successes ?? rows.filter((row) => row.success).length;
const failures = stats.failures ?? rows.filter((row) => !row.success && !row.error).length;
const errors = stats.errors ?? rows.filter((row) => row.error).length;
const percent = count ? `${((passes / count) * 100).toFixed(2)}%` : 'n/a';
const duration = stats.durationMs == null ? 'n/a' : `${(stats.durationMs / 1000).toFixed(1)} seconds`;

const groups = new Map();
for (const row of rows) {
  const plugin = row?.metadata?.pluginId ?? row?.testCase?.metadata?.pluginId ?? 'unknown';
  const current = groups.get(plugin) ?? { pass: 0, fail: 0, error: 0 };
  if (row.success) current.pass += 1;
  else current.fail += 1;
  groups.set(plugin, current);
}

const lines = [
  '# OpenClaw Red-Team Report', '',
  `Generated from Promptfoo evaluation \`${oneLine(data.evalId ?? 'unknown')}\`.`, '',
  '## Summary', '',
  '| Outcome | Count |', '|---|---:|',
  `| Passed | ${passes} |`, `| Failed | ${failures} |`, `| Errors | ${errors} |`,
  `| Total | ${count} |`, `| Pass rate | ${percent} |`, `| Duration | ${duration} |`, '',
  '## Results by plugin', '',
  '| Plugin | Passed | Failed | Errors | Total |', '|---|---:|---:|---:|---:|',
];

for (const [plugin, value] of [...groups].sort(([a], [b]) => a.localeCompare(b))) {
  lines.push(`| ${oneLine(plugin)} | ${value.pass} | ${value.fail} | ${value.error} | ${value.pass + value.fail + value.error} |`);
}

lines.push('', '## Failures and errors', '');
const findings = rows.filter((row) => !row.success);
if (!findings.length) lines.push('No failures or errors were recorded.', '');
for (const [index, row] of findings.entries()) {
  const plugin = row?.metadata?.pluginId ?? row?.testCase?.metadata?.pluginId ?? 'unknown';
  const severity = row?.metadata?.severity ?? row?.testCase?.metadata?.severity ?? 'unspecified';
  const prompt = row?.prompt?.raw ?? row?.vars?.prompt ?? '';
  const response = row?.response?.output ?? row?.error ?? '';
  const reason = row?.gradingResult?.reason ?? row?.failureReason ?? 'No grading reason supplied.';
  lines.push(
    `### ${index + 1}. ${oneLine(plugin)} (${oneLine(severity)})`, '',
    '**Prompt**', '', '```text', clean(prompt), '```', '',
    '**Response**', '', '```text', clean(response), '```', '',
    `**Grading reason:** ${oneLine(reason)}`, '',
  );
}

lines.push(
  '## Handling note', '',
  'This report may contain sensitive prompts, model responses, or evidence of side effects. Review access before sharing it. Correlate findings with gateway logs, traces, network activity, filesystem changes, and agent memory.', '',
);

await writeFile(output, `${lines.join('\n')}\n`, { mode: 0o600 });
console.log(`Wrote human-readable report to ${output}`);
