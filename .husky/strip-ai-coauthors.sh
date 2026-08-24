#!/usr/bin/env sh
# Strip AI-agent co-author trailers (Claude / Sisyphus / Clio) from a commit
# message so bot accounts don't surface as GitHub co-authors.
#
# Usage: strip-ai-coauthors.sh <commit-msg-file>

msg_file="${1:?usage: strip-ai-coauthors.sh <commit-msg-file>}"
tmp="${msg_file}.strip.tmp"

# Remove "Co-authored-by:" / "Co-Authored-By:" trailers for Claude and Sisyphus,
# plus "Ultraworked with [Sisyphus]..." attribution lines.
grep -viE '^(co-authored-by:.*(claude|anthropic\.com|sisyphus|sisyphuslabs\.ai|clio-agent)|ultraworked with)' \
  "$msg_file" > "$tmp"

mv -f "$tmp" "$msg_file"

# Trim trailing blank lines left behind by the removals.
perl -0pi -e 's/\s+\z/\n/' "$msg_file"
