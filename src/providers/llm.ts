import { Finding, ParsedFile, ReviewOptions, ReviewProvider } from '../types';
import { config } from '../config';
import OpenAI from 'openai';

const LLM_SYSTEM_PROMPT = `You are a code review assistant. You analyze unified diffs and produce structured findings.

For each issue you find, output a JSON object with these fields:
- ruleId: a short identifier for the rule (e.g., "LLM-SEC-001")
- path: the file path where the issue was found
- line: the line number in the new file
- severity: one of "critical", "high", "medium", "low"
- category: one of "security", "correctness", "performance", "style"
- title: a short description of the issue
- evidence: the offending line of code, verbatim

Output ONLY a JSON array of finding objects. No markdown, no explanation text.
If there are no issues, output an empty array: []`;

export const llmProvider: ReviewProvider = {
  name: 'llm',

  async analyze(files: ParsedFile[], options: ReviewOptions): Promise<Finding[]> {
    if (!config.llm.apiKey) {
      throw new Error('LLM provider is not configured: missing LLM_API_KEY environment variable');
    }

    const client = new OpenAI({
      apiKey: config.llm.apiKey,
      baseURL: config.llm.baseUrl,
    });

    const allFindings: Finding[] = [];

    // Build the diff content to send to the LLM
    const diffContent = files.map((f) => f.rawContent).join('\n');

    try {
      const response = await client.chat.completions.create({
        model: config.llm.model,
        messages: [
          { role: 'system', content: LLM_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Review the following diff and report any issues:\n\n${diffContent}`,
          },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return [];
      }

      // Parse the JSON response
      let parsed: any[];
      try {
        // Try to extract JSON array from the response (handle markdown code blocks)
        const jsonMatch = content.match(/\[[\s\S]*\]/);
        if (!jsonMatch) {
          return [];
        }
        parsed = JSON.parse(jsonMatch[0]);
      } catch {
        console.error('Failed to parse LLM response as JSON:', content);
        return [];
      }

      // Convert to Finding objects
      for (const item of parsed) {
        if (!item.path || !item.line || !item.ruleId) continue;

        const finding: Finding = {
          id: `${item.ruleId}:${item.path}:${item.line}`,
          ruleId: item.ruleId,
          path: item.path,
          line: item.line,
          severity: item.severity || 'medium',
          category: item.category || 'correctness',
          title: item.title || 'Issue found',
          evidence: item.evidence || '',
        };
        allFindings.push(finding);
      }
    } catch (error: any) {
      // Graceful failure: wrap the error
      const msg = error?.message || 'Unknown LLM error';
      throw new Error(`LLM provider error: ${msg}`);
    }

    // Sort findings
    return allFindings.sort((a, b) => {
      if (a.path !== b.path) return a.path < b.path ? -1 : 1;
      if (a.line !== b.line) return a.line - b.line;
      return a.ruleId < b.ruleId ? -1 : a.ruleId > b.ruleId ? 1 : 0;
    });
  },
};
