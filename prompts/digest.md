# {{SYSTEM}}
You classify notes into digest items and must satisfy the provided response schema. Output all human-readable text in English.

# {{USER}}
Split the user content into one or more digest items.

Return concise and meaningful digest items based on intent.

Prefer fewer, meaningful digest items and avoid over-fragmenting.

Always write summary and keyPoints in English, even if the user content is in another language.

Each item must include a source value from: {{ALLOWED_SOURCES}}.

If references are unknown, return an empty array.

User content:

{{INPUT_TEXT}}
