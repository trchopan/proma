import {
  DIGEST_SOURCES,
  type DigestCategory,
  type DigestSource,
} from "$/domain/digest/types";

export type CanonicalReference = { source: DigestSource; link: string };

export type CanonicalTopicData = {
  summary: string;
  keyPoints: string[];
  timeline: string[];
  references: CanonicalReference[];
};

export type DecisionTopicData = {
  summary: string;
  decision: string[];
  context: string[];
  optionsConsidered: string[];
  rationaleTradeoffs: string[];
  stakeholders: string[];
  references: CanonicalReference[];
};

export type ResearchTopicData = {
  summary: string;
  problemStatement: string[];
  researchPlan: string[];
  keyFindings: string[];
  personInCharge: string[];
  references: CanonicalReference[];
};

export type PlanningTopicData = {
  summary: string;
  objectivesSuccessCriteria: string[];
  scope: string[];
  deliverables: string[];
  plan: string[];
  timeline: string[];
  teamsIndividualsInvolved: string[];
  references: CanonicalReference[];
};

export type TopicDataByCategory =
  | DecisionTopicData
  | ResearchTopicData
  | PlanningTopicData;

export type TopicSignalData = {
  summary: string;
  keyPoints: string[];
  timeline: string[];
  references: CanonicalReference[];
};

export function extractTopicTitle(markdown: string): string {
  const titleLine = markdown
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /^#\s+.+$/.test(line));

  return titleLine?.replace(/^#\s+/, "").trim() ?? "";
}

const TIMELINE_ENTRY_PATTERN = /^\d{4}-\d{2}-\d{2}\s+-\s+.+$/;

export function uniqueOrdered(values: string[]): string[] {
  const seen = new Set<string>();
  const ordered: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    ordered.push(normalized);
  }

  return ordered;
}

function parseReferenceKeyWithAllowedSources(
  value: string,
  allowedSources: readonly string[],
): CanonicalReference | null {
  const match = value.match(/^([a-z]+):\s*(.+)$/i);
  if (!match?.[1] || !match[2]) {
    return null;
  }

  const source = match[1].trim().toLowerCase();
  const link = match[2].trim();
  if (!allowedSources.includes(source) || !link) {
    return null;
  }

  return { source: source as DigestSource, link };
}

function parseBulletValue(line: string): string | null {
  const bullet = line.match(/^-\s+(.+)$/);
  if (!bullet?.[1] || bullet[1] === "None") {
    return null;
  }
  return bullet[1].trim();
}

function buildBulletList(values: string[]): string {
  if (values.length === 0) {
    return "- None";
  }
  return values.map((value) => `- ${value}`).join("\n");
}

function buildReferencesList(values: CanonicalReference[]): string {
  if (values.length === 0) {
    return "- None";
  }
  return values.map((value) => `- ${value.source}: ${value.link}`).join("\n");
}

function dedupeReferences(
  references: CanonicalReference[],
  allowedSources: readonly string[],
): CanonicalReference[] {
  return uniqueOrdered(
    references.map((reference) => `${reference.source}: ${reference.link}`),
  )
    .map((value) => parseReferenceKeyWithAllowedSources(value, allowedSources))
    .filter((value): value is CanonicalReference => Boolean(value));
}

type SectionCollector = {
  summary: string;
  sections: Record<string, string[]>;
  references: CanonicalReference[];
};

function parseSections(options: {
  body: string;
  headingMap: Record<string, string>;
  timelineSectionKeys?: string[];
  allowedSources: readonly string[];
}): SectionCollector {
  const lines = options.body.split("\n");
  let sectionKey: string | null = null;
  const sectionValues: Record<string, string[]> = {};
  let summary = "";
  const references: CanonicalReference[] = [];
  const timelineSectionKeys = new Set(options.timelineSectionKeys ?? []);

  for (const rawLine of lines) {
    const line = rawLine.trim();
    const heading = line
      .match(/^##\s+(.+)$/i)?.[1]
      ?.trim()
      .toLowerCase();

    if (heading && options.headingMap[heading]) {
      sectionKey = options.headingMap[heading] ?? null;
      if (sectionKey && !sectionValues[sectionKey]) {
        sectionValues[sectionKey] = [];
      }
      continue;
    }

    if (!sectionKey) {
      continue;
    }

    if (sectionKey === "summary") {
      if (line.length > 0 && !line.startsWith("#") && !summary) {
        summary = line;
      }
      continue;
    }

    if (sectionKey === "references") {
      const bulletValue = parseBulletValue(line);
      if (!bulletValue) {
        continue;
      }
      const parsed = parseReferenceKeyWithAllowedSources(
        bulletValue,
        options.allowedSources,
      );
      if (parsed) {
        references.push(parsed);
      }
      continue;
    }

    const bulletValue = parseBulletValue(line);
    if (!bulletValue) {
      continue;
    }

    if (timelineSectionKeys.has(sectionKey)) {
      const parsedTimeline = parseTimelineEntry(bulletValue);
      if (parsedTimeline) {
        sectionValues[sectionKey]?.push(parsedTimeline);
      }
      continue;
    }

    sectionValues[sectionKey]?.push(bulletValue);
  }

  for (const key of Object.keys(sectionValues)) {
    const values = sectionValues[key] ?? [];
    sectionValues[key] = timelineSectionKeys.has(key)
      ? [...new Set(values)].sort((a, b) => a.localeCompare(b))
      : uniqueOrdered(values);
  }

  return {
    summary,
    sections: sectionValues,
    references: dedupeReferences(references, options.allowedSources),
  };
}

export function emptyTopicDataByCategory(
  category: DigestCategory,
): TopicDataByCategory {
  if (category === "decision") {
    return {
      summary: "",
      decision: [],
      context: [],
      optionsConsidered: [],
      rationaleTradeoffs: [],
      stakeholders: [],
      references: [],
    };
  }

  if (category === "research") {
    return {
      summary: "",
      problemStatement: [],
      researchPlan: [],
      keyFindings: [],
      personInCharge: [],
      references: [],
    };
  }

  return {
    summary: "",
    objectivesSuccessCriteria: [],
    scope: [],
    deliverables: [],
    plan: [],
    timeline: [],
    teamsIndividualsInvolved: [],
    references: [],
  };
}

export function parseReferenceKey(value: string): CanonicalReference | null {
  return parseReferenceKeyWithAllowedSources(value, DIGEST_SOURCES);
}

export function parseTimelineEntry(value: string): string | null {
  const normalized = value.trim();
  if (!normalized || !TIMELINE_ENTRY_PATTERN.test(normalized)) {
    return null;
  }

  return normalized;
}

export function extractCanonicalTopicData(
  body: string,
  options?: { allowedSources?: readonly string[] },
): CanonicalTopicData {
  const allowedSources =
    options?.allowedSources && options.allowedSources.length > 0
      ? [...options.allowedSources]
      : [...DIGEST_SOURCES];
  const lines = body.split("\n");
  let section: "summary" | "keyPoints" | "timeline" | "references" | null =
    null;
  let summary = "";
  const keyPoints: string[] = [];
  const timeline: string[] = [];
  const references: CanonicalReference[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (/^##\s+Summary\s*$/i.test(line)) {
      section = "summary";
      continue;
    }
    if (/^##\s+Key Points\s*$/i.test(line)) {
      section = "keyPoints";
      continue;
    }
    if (/^##\s+Timeline\s*$/i.test(line)) {
      section = "timeline";
      continue;
    }
    if (/^##\s+References\s*$/i.test(line)) {
      section = "references";
      continue;
    }

    if (section === "summary" && line.length > 0 && !line.startsWith("#")) {
      if (!summary) {
        summary = line;
      }
      continue;
    }

    if (section === "keyPoints") {
      const bullet = line.match(/^-\s+(.+)$/);
      if (bullet?.[1] && bullet[1] !== "None") {
        keyPoints.push(bullet[1].trim());
      }
      continue;
    }

    if (section === "timeline") {
      const bullet = line.match(/^-\s+(.+)$/);
      if (!bullet?.[1] || bullet[1] === "None") {
        continue;
      }
      const parsed = parseTimelineEntry(bullet[1]);
      if (parsed) {
        timeline.push(parsed);
      }
      continue;
    }

    if (section === "references") {
      const bullet = line.match(/^-\s+(.+)$/);
      if (!bullet?.[1] || bullet[1] === "None") {
        continue;
      }
      const parsed = parseReferenceKeyWithAllowedSources(
        bullet[1],
        allowedSources,
      );
      if (parsed) {
        references.push(parsed);
      }
    }
  }

  const uniqueRefs = dedupeReferences(references, allowedSources);

  return {
    summary,
    keyPoints: uniqueOrdered(keyPoints),
    timeline: [...new Set(timeline)].sort((a, b) => a.localeCompare(b)),
    references: uniqueRefs,
  };
}

function decisionHeadingMap(): Record<string, string> {
  return {
    summary: "summary",
    decision: "decision",
    context: "context",
    "options considered": "optionsConsidered",
    "rationale / tradeoffs": "rationaleTradeoffs",
    "rationale/tradeoffs": "rationaleTradeoffs",
    "rationale and tradeoffs": "rationaleTradeoffs",
    stakeholders: "stakeholders",
    references: "references",
    "key points": "decision",
  };
}

function researchHeadingMap(): Record<string, string> {
  return {
    summary: "summary",
    "problem statement": "problemStatement",
    "research plan": "researchPlan",
    "key findings": "keyFindings",
    "person in charge": "personInCharge",
    references: "references",
    "key points": "keyFindings",
    timeline: "researchPlan",
  };
}

function planningHeadingMap(): Record<string, string> {
  return {
    summary: "summary",
    "objectives / success criteria": "objectivesSuccessCriteria",
    scope: "scope",
    deliverables: "deliverables",
    plan: "plan",
    timeline: "timeline",
    "teams/individuals involved": "teamsIndividualsInvolved",
    references: "references",
    "key points": "objectivesSuccessCriteria",
  };
}

export function extractTopicDataByCategory(
  body: string,
  category: DigestCategory,
  options?: { allowedSources?: readonly string[] },
): TopicDataByCategory {
  const allowedSources =
    options?.allowedSources && options.allowedSources.length > 0
      ? [...options.allowedSources]
      : [...DIGEST_SOURCES];

  if (category === "decision") {
    const parsed = parseSections({
      body,
      headingMap: decisionHeadingMap(),
      allowedSources,
    });
    return {
      summary: parsed.summary,
      decision: parsed.sections.decision ?? [],
      context: parsed.sections.context ?? [],
      optionsConsidered: parsed.sections.optionsConsidered ?? [],
      rationaleTradeoffs: parsed.sections.rationaleTradeoffs ?? [],
      stakeholders: parsed.sections.stakeholders ?? [],
      references: parsed.references,
    };
  }

  if (category === "research") {
    const parsed = parseSections({
      body,
      headingMap: researchHeadingMap(),
      allowedSources,
      timelineSectionKeys: ["researchPlan"],
    });
    return {
      summary: parsed.summary,
      problemStatement: parsed.sections.problemStatement ?? [],
      researchPlan: parsed.sections.researchPlan ?? [],
      keyFindings: parsed.sections.keyFindings ?? [],
      personInCharge: parsed.sections.personInCharge ?? [],
      references: parsed.references,
    };
  }

  const parsed = parseSections({
    body,
    headingMap: planningHeadingMap(),
    allowedSources,
    timelineSectionKeys: ["timeline"],
  });
  return {
    summary: parsed.summary,
    objectivesSuccessCriteria: parsed.sections.objectivesSuccessCriteria ?? [],
    scope: parsed.sections.scope ?? [],
    deliverables: parsed.sections.deliverables ?? [],
    plan: parsed.sections.plan ?? [],
    timeline: parsed.sections.timeline ?? [],
    teamsIndividualsInvolved: parsed.sections.teamsIndividualsInvolved ?? [],
    references: parsed.references,
  };
}

export function buildTopicBodyByCategory(
  topic: string,
  category: DigestCategory,
  data: TopicDataByCategory,
): string {
  const summary = data.summary || "No summary yet.";

  if (category === "decision") {
    const values = data as DecisionTopicData;
    return [
      `# ${topic}`,
      "",
      "## Summary",
      summary,
      "",
      "## Decision",
      buildBulletList(values.decision),
      "",
      "## Context",
      buildBulletList(values.context),
      "",
      "## Options Considered",
      buildBulletList(values.optionsConsidered),
      "",
      "## Rationale / Tradeoffs",
      buildBulletList(values.rationaleTradeoffs),
      "",
      "## Stakeholders",
      buildBulletList(values.stakeholders),
      "",
      "## References",
      buildReferencesList(values.references),
      "",
    ].join("\n");
  }

  if (category === "research") {
    const values = data as ResearchTopicData;
    return [
      `# ${topic}`,
      "",
      "## Summary",
      summary,
      "",
      "## Problem Statement",
      buildBulletList(values.problemStatement),
      "",
      "## Research Plan",
      buildBulletList(values.researchPlan),
      "",
      "## Key Findings",
      buildBulletList(values.keyFindings),
      "",
      "## Person in Charge",
      buildBulletList(values.personInCharge),
      "",
      "## References",
      buildReferencesList(values.references),
      "",
    ].join("\n");
  }

  const values = data as PlanningTopicData;
  return [
    `# ${topic}`,
    "",
    "## Summary",
    summary,
    "",
    "## Objectives / Success Criteria",
    buildBulletList(values.objectivesSuccessCriteria),
    "",
    "## Scope",
    buildBulletList(values.scope),
    "",
    "## Deliverables",
    buildBulletList(values.deliverables),
    "",
    "## Plan",
    buildBulletList(values.plan),
    "",
    "## Timeline",
    buildBulletList(values.timeline),
    "",
    "## Teams/Individuals Involved",
    buildBulletList(values.teamsIndividualsInvolved),
    "",
    "## References",
    buildReferencesList(values.references),
    "",
  ].join("\n");
}

export function topicSignalsFromCategoryData(
  category: DigestCategory,
  data: TopicDataByCategory,
): TopicSignalData {
  if (category === "decision") {
    const values = data as DecisionTopicData;
    return {
      summary: values.summary,
      keyPoints: uniqueOrdered([
        ...values.decision,
        ...values.context,
        ...values.optionsConsidered,
        ...values.rationaleTradeoffs,
        ...values.stakeholders,
      ]),
      timeline: [],
      references: values.references,
    };
  }

  if (category === "research") {
    const values = data as ResearchTopicData;
    return {
      summary: values.summary,
      keyPoints: uniqueOrdered([
        ...values.problemStatement,
        ...values.researchPlan,
        ...values.keyFindings,
        ...values.personInCharge,
      ]),
      timeline: [],
      references: values.references,
    };
  }

  const values = data as PlanningTopicData;
  return {
    summary: values.summary,
    keyPoints: uniqueOrdered([
      ...values.objectivesSuccessCriteria,
      ...values.scope,
      ...values.deliverables,
      ...values.plan,
      ...values.teamsIndividualsInvolved,
    ]),
    timeline: values.timeline,
    references: values.references,
  };
}

export function buildCanonicalBody(
  topic: string,
  data: CanonicalTopicData,
): string {
  const summary = data.summary || "No summary yet.";
  const keyPoints =
    data.keyPoints.length > 0
      ? data.keyPoints.map((value) => `- ${value}`).join("\n")
      : "- None";
  const timeline =
    data.timeline.length > 0
      ? data.timeline.map((value) => `- ${value}`).join("\n")
      : "- None";
  const references =
    data.references.length > 0
      ? data.references
          .map((value) => `- ${value.source}: ${value.link}`)
          .join("\n")
      : "- None";

  return [
    `# ${topic}`,
    "",
    "## Summary",
    summary,
    "",
    "## Key Points",
    keyPoints,
    "",
    "## Timeline",
    timeline,
    "",
    "## References",
    references,
    "",
  ].join("\n");
}

export function firstMeaningfulLine(markdown: string): string {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));

  return lines[0] ?? "";
}
