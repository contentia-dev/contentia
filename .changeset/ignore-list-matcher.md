---
"contentia": minor
"@contentia/cli": patch
---

Storage repositories no longer depend on minimatch. `ignoreList` patterns are now matched by a
built-in matcher that doesn't use regular expressions, so no pattern can make it backtrack
exponentially. It's also exported as `compileIgnoreList` from `contentia/storage`, for custom
storage repositories.

**Breaking:** an `ignoreList` pattern that uses character classes (`[abc]`), extglobs (`@(a|b)`),
brace ranges (`{1..3}`), nested braces, or negation (`!pattern`) now throws when the repository is
constructed. A pattern for a nested path, such as `drafts/secret.md`, no longer also hides its
parent folder (`drafts`) from listings.
