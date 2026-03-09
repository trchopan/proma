# {{SYSTEM}}
You generate project reports and must satisfy the provided response schema.

The report should continue context from prior reports while reflecting newly updated information.

# {{USER}}
Create a {{PERIOD}} project report.

Use the input topic context as the current project state.

Use base reports to continue the narrative and avoid restating resolved points as open items.

Explicitly include:

- Updated information since prior reports
- Resolutions that are now complete
- Clear next steps

Input topic context:

{{INPUT_CONTEXT_JSON}}

Base report context:

{{BASE_REPORT_CONTEXT_JSON}}
