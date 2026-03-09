import path from "node:path";

export type PromptTemplateSections = {
  system: string;
  user: string;
};

const SYSTEM_HEADING = "# {{SYSTEM}}";
const USER_HEADING = "# {{USER}}";
const VARIABLE_PATTERN = /{{([A-Z0-9_]+)}}/g;

export function resolveBuiltInPromptPath(
  kind: "digest" | "merge" | "report",
): string {
  return path.resolve(import.meta.dir, "..", "prompts", `${kind}.md`);
}

export function parsePromptTemplateMarkdown(
  markdown: string,
  sourceName = "prompt template",
): PromptTemplateSections {
  const lines = markdown.split("\n");
  let systemLine = -1;
  let userLine = -1;

  for (let index = 0; index < lines.length; index += 1) {
    const line = (lines[index] ?? "").trim();
    if (line === SYSTEM_HEADING) {
      if (systemLine !== -1) {
        throw new Error(
          `${sourceName} contains duplicate section heading: ${SYSTEM_HEADING}`,
        );
      }
      systemLine = index;
      continue;
    }

    if (line === USER_HEADING) {
      if (userLine !== -1) {
        throw new Error(
          `${sourceName} contains duplicate section heading: ${USER_HEADING}`,
        );
      }
      userLine = index;
    }
  }

  if (systemLine === -1 || userLine === -1) {
    const missing = [
      ...(systemLine === -1 ? [SYSTEM_HEADING] : []),
      ...(userLine === -1 ? [USER_HEADING] : []),
    ].join(", ");
    throw new Error(
      `${sourceName} is missing required section heading(s): ${missing}`,
    );
  }

  const sectionRanges = [
    { kind: "system" as const, start: systemLine },
    { kind: "user" as const, start: userLine },
  ].sort((left, right) => left.start - right.start);

  const sections: Partial<PromptTemplateSections> = {};
  for (let index = 0; index < sectionRanges.length; index += 1) {
    const current = sectionRanges[index];
    if (!current) {
      continue;
    }
    const next = sectionRanges[index + 1];
    const sectionLines = lines.slice(current.start + 1, next?.start);
    const sectionText = sectionLines.join("\n").trim();
    if (sectionText.length === 0) {
      throw new Error(
        `${sourceName} has empty section body for heading: ${current.kind === "system" ? SYSTEM_HEADING : USER_HEADING}`,
      );
    }
    sections[current.kind] = sectionText;
  }

  return {
    system: sections.system ?? "",
    user: sections.user ?? "",
  };
}

export async function loadPromptTemplateFromFile(
  filePath: string,
): Promise<PromptTemplateSections> {
  const templateFile = Bun.file(filePath);
  const exists = await templateFile.exists();
  if (!exists) {
    throw new Error(`Prompt template file not found: ${filePath}`);
  }
  const markdown = await templateFile.text();
  return parsePromptTemplateMarkdown(markdown, filePath);
}

export function renderPromptTemplate(
  template: string,
  variables: Record<string, string>,
  sourceName = "prompt template",
): string {
  const rendered = template.replace(
    VARIABLE_PATTERN,
    (_match, variableName) => {
      const value = variables[variableName];
      if (value === undefined) {
        throw new Error(
          `${sourceName} references unresolved variable: {{${variableName}}}`,
        );
      }
      return value;
    },
  );

  const unresolved = rendered.match(VARIABLE_PATTERN);
  if (unresolved && unresolved.length > 0) {
    throw new Error(
      `${sourceName} has unresolved variable(s): ${unresolved.join(", ")}`,
    );
  }

  return rendered;
}
