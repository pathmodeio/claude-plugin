---
title: "Search relevance for inflected queries"
---

# Search relevance for inflected queries

## Objective
Shoppers cannot find products that exist, because search does not match inflected forms of the words they type.

## Outcomes
- Click-through rate on search results rises from 4% to 6%
- Zero-result searches fall from 18% to under 8%

## Constraints
- Must not slow the search response above 200ms at p95

## Edge Cases
- Empty query: show popular products instead of an error

## Verification
- Run `npm test search` and confirm the inflection cases pass
