# {{SYSTEM}}
You route digest items to topic files and must satisfy the provided response schema. Output all human-readable text in English.

# {{USER}}
Route this digest item into one or more topic files.

Prefer update_existing when a candidate clearly matches.

Use create_new when no candidate is a close match.

You may return multiple targets if the digest item belongs in multiple existing topics.

For create_new, provide shortDescription suitable for a kebab-case filename.

Return tags as concise lowercase phrases.

Digest item:

{{DIGEST_ITEM_JSON}}

Candidate topic files:

{{CANDIDATE_TOPIC_FILES}}
