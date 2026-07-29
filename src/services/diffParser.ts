import { ParsedFile, ParsedAddedLine } from '../types';

/**
 * Parse a unified diff string into structured file data.
 * Extracts added lines with their new-file line numbers.
 */
export function parseDiff(diff: string): ParsedFile[] {
  const files: ParsedFile[] = [];
  const lines = diff.split('\n');

  let currentPath: string | null = null;
  let currentAddedLines: ParsedAddedLine[] = [];
  let currentRaw: string[] = [];
  let newLineNumber = 0;

  // Track where each file's diff starts in the lines array
  let fileStartIndex = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Detect start of a new file diff via "diff --git" or "---"/"+++" pair
    if (line.startsWith('diff --git ')) {
      // Save previous file if exists
      if (currentPath !== null) {
        files.push({
          path: currentPath,
          addedLines: currentAddedLines,
          rawContent: currentRaw.join('\n'),
        });
      }
      currentPath = null;
      currentAddedLines = [];
      currentRaw = [line];
      fileStartIndex = i;
      continue;
    }

    // The +++ line gives us the new file path
    if (line.startsWith('+++ ')) {
      // Extract path: "+++ b/src/foo.ts" → "src/foo.ts"
      let path = line.substring(4);
      if (path.startsWith('b/')) {
        path = path.substring(2);
      }
      // Handle /dev/null for deleted files
      if (path === '/dev/null') {
        currentRaw.push(line);
        continue;
      }
      currentPath = path;
      currentRaw.push(line);
      continue;
    }

    // --- line: just add to raw content
    if (line.startsWith('--- ')) {
      // If we haven't seen a "diff --git" line but we see --- and there's a pending file, save it
      if (currentPath !== null && fileStartIndex === -1) {
        files.push({
          path: currentPath,
          addedLines: currentAddedLines,
          rawContent: currentRaw.join('\n'),
        });
        currentPath = null;
        currentAddedLines = [];
        currentRaw = [];
      }
      currentRaw.push(line);
      continue;
    }

    // Hunk header: @@ -oldStart,oldCount +newStart,newCount @@
    const hunkMatch = line.match(/^@@\s+-\d+(?:,\d+)?\s+\+(\d+)(?:,\d+)?\s+@@/);
    if (hunkMatch) {
      newLineNumber = parseInt(hunkMatch[1], 10);
      currentRaw.push(line);
      continue;
    }

    // Added line
    if (line.startsWith('+')) {
      if (currentPath !== null) {
        currentAddedLines.push({
          path: currentPath,
          line: newLineNumber,
          content: line.substring(1), // remove the leading +
        });
      }
      newLineNumber++;
      currentRaw.push(line);
      continue;
    }

    // Removed line (doesn't affect new file line numbering)
    if (line.startsWith('-')) {
      currentRaw.push(line);
      continue;
    }

    // Context line (unchanged)
    if (line.startsWith(' ') || line === '') {
      newLineNumber++;
      currentRaw.push(line);
      continue;
    }

    // Other lines (e.g., "\ No newline at end of file", index lines, etc.)
    currentRaw.push(line);
  }

  // Save the last file
  if (currentPath !== null) {
    files.push({
      path: currentPath,
      addedLines: currentAddedLines,
      rawContent: currentRaw.join('\n'),
    });
  }

  return files;
}

/**
 * Validate that a string is a parseable unified diff.
 * Returns true if it looks like a valid unified diff.
 */
export function isValidDiff(diff: string): boolean {
  // A valid unified diff must contain at least one hunk header
  return /^@@\s+-\d+/m.test(diff);
}
