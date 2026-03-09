type DiffOp = {
  type: "context" | "add" | "remove";
  text: string;
  oldLine: number | null;
  newLine: number | null;
};

function splitLinesForDiff(content: string): string[] {
  if (content.length === 0) {
    return [];
  }

  const lines = content.split("\n");
  if (content.endsWith("\n") && lines[lines.length - 1] === "") {
    lines.pop();
  }
  return lines;
}

function computeLineDiff(
  currentLines: string[],
  proposedLines: string[],
): DiffOp[] {
  const currentCount = currentLines.length;
  const proposedCount = proposedLines.length;
  const lcs: number[][] = Array.from({ length: currentCount + 1 }, () =>
    Array(proposedCount + 1).fill(0),
  );

  for (let i = currentCount - 1; i >= 0; i -= 1) {
    const row = lcs[i];
    const nextRow = lcs[i + 1];
    if (!row) {
      continue;
    }
    for (let j = proposedCount - 1; j >= 0; j -= 1) {
      if (currentLines[i] === proposedLines[j]) {
        row[j] = (nextRow?.[j + 1] ?? 0) + 1;
      } else {
        row[j] = Math.max(nextRow?.[j] ?? 0, row[j + 1] ?? 0);
      }
    }
  }

  const operations: DiffOp[] = [];
  let currentIndex = 0;
  let proposedIndex = 0;

  while (currentIndex < currentCount || proposedIndex < proposedCount) {
    const currentLine = currentLines[currentIndex];
    const proposedLine = proposedLines[proposedIndex];

    if (
      currentIndex < currentCount &&
      proposedIndex < proposedCount &&
      currentLine === proposedLine
    ) {
      operations.push({
        type: "context",
        text: currentLine ?? "",
        oldLine: currentIndex + 1,
        newLine: proposedIndex + 1,
      });
      currentIndex += 1;
      proposedIndex += 1;
      continue;
    }

    const addScore = lcs[currentIndex]?.[proposedIndex + 1] ?? -1;
    const removeScore = lcs[currentIndex + 1]?.[proposedIndex] ?? -1;

    if (proposedIndex < proposedCount && addScore >= removeScore) {
      operations.push({
        type: "add",
        text: proposedLine ?? "",
        oldLine: null,
        newLine: proposedIndex + 1,
      });
      proposedIndex += 1;
      continue;
    }

    if (currentIndex < currentCount) {
      operations.push({
        type: "remove",
        text: currentLine ?? "",
        oldLine: currentIndex + 1,
        newLine: null,
      });
      currentIndex += 1;
    }
  }

  return operations;
}

function getHunkStartLine(
  operations: DiffOp[],
  hunkStart: number,
  key: "oldLine" | "newLine",
): number {
  for (let i = hunkStart; i < operations.length; i += 1) {
    const lineNumber = operations[i]?.[key];
    if (lineNumber !== null && lineNumber !== undefined) {
      return lineNumber;
    }
  }

  for (let i = hunkStart - 1; i >= 0; i -= 1) {
    const lineNumber = operations[i]?.[key];
    if (lineNumber !== null && lineNumber !== undefined) {
      return lineNumber + 1;
    }
  }

  return 1;
}

export function renderDiffPreview(
  currentContent: string,
  proposedContent: string,
): string {
  const currentLines = splitLinesForDiff(currentContent);
  const proposedLines = splitLinesForDiff(proposedContent);
  const operations = computeLineDiff(currentLines, proposedLines);
  const contextWindow = 3;
  const changeIndices = operations
    .map((operation, index) => (operation.type === "context" ? null : index))
    .filter((index): index is number => index !== null);

  const addedCount = operations.filter(
    (operation) => operation.type === "add",
  ).length;
  const removedCount = operations.filter(
    (operation) => operation.type === "remove",
  ).length;

  if (changeIndices.length === 0) {
    return ["--- current", "+++ proposed", "No textual changes."].join("\n");
  }

  const hunkRanges: Array<{ start: number; end: number }> = [];
  const firstChange = changeIndices[0] ?? 0;
  let rangeStart = Math.max(firstChange - contextWindow, 0);
  let rangeEnd = Math.min(firstChange + contextWindow, operations.length - 1);

  for (let i = 1; i < changeIndices.length; i += 1) {
    const index = changeIndices[i] ?? 0;
    const nextStart = Math.max(index - contextWindow, 0);
    const nextEnd = Math.min(index + contextWindow, operations.length - 1);

    if (nextStart <= rangeEnd + 1) {
      rangeEnd = Math.max(rangeEnd, nextEnd);
      continue;
    }

    hunkRanges.push({ start: rangeStart, end: rangeEnd });
    rangeStart = nextStart;
    rangeEnd = nextEnd;
  }
  hunkRanges.push({ start: rangeStart, end: rangeEnd });

  const output: string[] = [
    "--- current",
    "+++ proposed",
    `Changes: +${addedCount} -${removedCount}`,
  ];

  for (const hunk of hunkRanges) {
    const hunkOperations = operations.slice(hunk.start, hunk.end + 1);
    const oldStart = getHunkStartLine(operations, hunk.start, "oldLine");
    const newStart = getHunkStartLine(operations, hunk.start, "newLine");
    const oldCount = hunkOperations.filter(
      (operation) => operation.oldLine !== null,
    ).length;
    const newCount = hunkOperations.filter(
      (operation) => operation.newLine !== null,
    ).length;

    output.push(`@@ -${oldStart},${oldCount} +${newStart},${newCount} @@`);

    for (const operation of hunkOperations) {
      const marker =
        operation.type === "add"
          ? "+"
          : operation.type === "remove"
            ? "-"
            : " ";
      output.push(`${marker} ${operation.text}`);
    }
  }

  return output.join("\n");
}

export function supportsAnsiColor(): boolean {
  return Boolean(process.stdout.isTTY) && process.env.NO_COLOR === undefined;
}

export function colorizeDiffPreview(preview: string): string {
  const ANSI = {
    dim: "\u001b[2m",
    red: "\u001b[31m",
    green: "\u001b[32m",
    cyan: "\u001b[36m",
    reset: "\u001b[0m",
  };

  return preview
    .split("\n")
    .map((line) => {
      if (line.startsWith("@@")) {
        return `${ANSI.cyan}${line}${ANSI.reset}`;
      }
      if (line.startsWith("---") || line.startsWith("+++")) {
        return `${ANSI.dim}${line}${ANSI.reset}`;
      }
      if (line.startsWith("+ ")) {
        return `${ANSI.green}${line}${ANSI.reset}`;
      }
      if (line.startsWith("- ")) {
        return `${ANSI.red}${line}${ANSI.reset}`;
      }
      return line;
    })
    .join("\n");
}
