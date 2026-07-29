import { Finding, ParsedFile, ReviewOptions, ReviewProvider, Severity, Category } from '../types';

interface MockRule {
  ruleId: string;
  severity: Severity;
  category: Category;
  title: string;
  test: (line: string, allLines?: string[]) => boolean;
}

/**
 * Check if a line is inside a string concatenated with + and contains SQL keywords.
 * Looks for patterns like: "SELECT * FROM " + variable
 * or: variable + "SELECT * FROM users"
 */
function hasSqlConcatenation(line: string): boolean {
  const sqlKeywords = /\b(SELECT|INSERT|UPDATE|DELETE)\b/i;
  if (!sqlKeywords.test(line)) return false;

  // Extract string literals (double quotes, single quotes, backticks)
  const stringLiteralRegex = /"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
  
  let hasSqlInString = false;
  const strippedLine = line.replace(stringLiteralRegex, (match) => {
    if (sqlKeywords.test(match)) {
      hasSqlInString = true;
    }
    return '__STR__';
  });

  // Must have a SQL keyword inside a string literal AND a '+' operator outside strings
  return hasSqlInString && strippedLine.includes('+');
}

const MOCK_RULES: MockRule[] = [
  {
    ruleId: 'MOCK-001',
    severity: 'critical',
    category: 'security',
    title: 'eval usage',
    test: (line) => line.includes('eval('),
  },
  {
    ruleId: 'MOCK-002',
    severity: 'critical',
    category: 'security',
    title: 'secret',
    test: (line) => /(api[_-]?key)/i.test(line),
  },
  {
    ruleId: 'MOCK-003',
    severity: 'high',
    category: 'security',
    title: 'SQL string concatenation',
    test: (line) => hasSqlConcatenation(line),
  },
  {
    ruleId: 'MOCK-004',
    severity: 'high',
    category: 'correctness',
    title: 'swallowed exception',
    test: (_line, _allLines) => false, // handled separately in the multi-line scan
  },
  {
    ruleId: 'MOCK-005',
    severity: 'medium',
    category: 'correctness',
    title: 'loose null comparison',
    test: (line) => /(^|[^=])([!=]=)\s*null\b/.test(line) || /\bnull\s*([!=]=)(?!=)/.test(line),
  },
  {
    ruleId: 'MOCK-006',
    severity: 'medium',
    category: 'performance',
    title: 'deep-clone via JSON',
    test: (line) => line.includes('JSON.parse(JSON.stringify('),
  },
  {
    ruleId: 'MOCK-007',
    severity: 'low',
    category: 'style',
    title: 'console.log left in',
    test: (line) => line.includes('console.log('),
  },
  {
    ruleId: 'MOCK-008',
    severity: 'low',
    category: 'style',
    title: 'unresolved marker',
    test: (line) => line.includes('TODO') || line.includes('FIXME'),
  },
  {
    ruleId: 'MOCK-INJ',
    severity: 'critical',
    category: 'security',
    title: 'prompt-injection content',
    test: (line) => {
      const lower = line.toLowerCase();
      return (
        lower.includes('ignore previous instructions') ||
        lower.includes('disregard all prior') ||
        lower.includes('you are now')
      );
    },
  },
];

/**
 * Detect empty catch blocks that may span multiple added lines.
 * Reports the line number of the `catch` line.
 */
function detectEmptyCatch(files: ParsedFile[]): Finding[] {
  const findings: Finding[] = [];

  for (const file of files) {
    const addedLines = file.addedLines;

    for (let i = 0; i < addedLines.length; i++) {
      const line = addedLines[i];
      const content = line.content;

      // Check for catch block patterns
      // Pattern 1: catch(...) { } or catch { } on single line (empty body)
      if (/\bcatch\b(?:\s*\([^)]*\))?\s*\{\s*\}/.test(content)) {
        findings.push({
          id: `MOCK-004:${line.path}:${line.line}`,
          ruleId: 'MOCK-004',
          path: line.path,
          line: line.line,
          severity: 'high',
          category: 'correctness',
          title: 'swallowed exception',
          evidence: content,
        });
        continue;
      }

      // Pattern 2: catch header on one line, } on a subsequent line with no statements in between
      if (/\bcatch\b(?:\s*\([^)]*\))?\s*\{\s*$/.test(content)) {
        let isEmpty = true;
        let foundClose = false;

        for (let j = i + 1; j < addedLines.length; j++) {
          const nextContent = addedLines[j].content.trim();
          if (nextContent === '}' || nextContent.startsWith('}')) {
            foundClose = true;
            break;
          }
          if (nextContent !== '' && !nextContent.startsWith('//') && !nextContent.startsWith('/*')) {
            isEmpty = false;
            break;
          }
        }

        if (isEmpty && foundClose) {
          findings.push({
            id: `MOCK-004:${line.path}:${line.line}`,
            ruleId: 'MOCK-004',
            path: line.path,
            line: line.line,
            severity: 'high',
            category: 'correctness',
            title: 'swallowed exception',
            evidence: content,
          });
        }
      }
    }
  }

  return findings;
}

/**
 * Sort findings by path (lexicographic), then line (ascending), then ruleId.
 */
function sortFindings(findings: Finding[]): Finding[] {
  return findings.sort((a, b) => {
    if (a.path !== b.path) return a.path < b.path ? -1 : 1;
    if (a.line !== b.line) return a.line - b.line;
    return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
  });
}

/**
 * Deduplicate findings by id.
 */
function deduplicateFindings(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  return findings.filter((f) => {
    if (seen.has(f.id)) return false;
    seen.add(f.id);
    return true;
  });
}

export const mockProvider: ReviewProvider = {
  name: 'mock',

  async analyze(files: ParsedFile[], _options: ReviewOptions): Promise<Finding[]> {
    const findings: Finding[] = [];

    // Apply single-line rules
    for (const file of files) {
      for (const addedLine of file.addedLines) {
        for (const rule of MOCK_RULES) {
          if (rule.ruleId === 'MOCK-004') continue; // handled separately

          if (rule.test(addedLine.content)) {
            findings.push({
              id: `${rule.ruleId}:${addedLine.path}:${addedLine.line}`,
              ruleId: rule.ruleId,
              path: addedLine.path,
              line: addedLine.line,
              severity: rule.severity,
              category: rule.category,
              title: rule.title,
              evidence: addedLine.content,
            });
          }
        }
      }
    }

    // Apply multi-line rules (empty catch detection)
    const catchFindings = detectEmptyCatch(files);
    findings.push(...catchFindings);

    // Deduplicate and sort
    return sortFindings(deduplicateFindings(findings));
  },
};
