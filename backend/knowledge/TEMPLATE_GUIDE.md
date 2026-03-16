---
title: KnowHive Template Guide
category: Meta
tags: [template, guide, documentation]
difficulty: null
pack_id: null
---

# KnowHive Template Guide

This guide defines the standardized Markdown format for knowledge files ingested by KnowHive. Following these templates ensures optimal heading-aware chunking, frontmatter extraction, and metadata-filtered retrieval.

## Frontmatter Schema

Every `.md` file should begin with a YAML frontmatter block:

```yaml
---
title: Document Title
category: Category Name
tags: [tag-one, tag-two, tag-three]
difficulty: easy | medium | hard | null
pack_id: pack-identifier
---
```

### Field Reference

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `title` | string | yes | Human-readable document title |
| `category` | string | yes | Topic category (e.g., "Dynamic Programming", "Arrays") |
| `tags` | list | yes | Lowercase hyphenated tags for search and filtering |
| `difficulty` | string | no | Problem difficulty: `easy`, `medium`, `hard`, or `null` |
| `pack_id` | string | yes | Knowledge pack identifier (e.g., `leetcode-basics`) |

## Tag Vocabulary

Use consistent tags across documents. Preferred tags:

**Algorithm types**: `bfs`, `dfs`, `dijkstra`, `dynamic-programming`, `interval-dp`, `digit-dp`, `rerooting-dp`, `two-pointer`, `greedy`, `heap`, `priority-queue`, `binary-search`, `backtracking`, `divide-and-conquer`, `sliding-window`, `union-find`, `trie`, `segment-tree`, `difference-array`, `topological-sort`

**Data structures**: `array`, `hash-map`, `linked-list`, `stack`, `queue`, `tree`, `binary-tree`, `graph`, `matrix`, `string`, `heap`

**Concepts**: `math`, `bit-manipulation`, `recursion`, `memoization`, `sorting`, `simulation`

**Difficulty tags**: `easy`, `medium`, `hard`

## Directory Structure

```
knowledge/<pack-id>/
  algorithms/     # Algorithm concept docs
  problems/       # Individual problem solutions
  companies/      # Company-specific prep docs
```

## Template 1: Algorithm Concept

```markdown
---
title: Algorithm Name
category: Category
tags: [tag-one, tag-two]
difficulty: null
pack_id: pack-id
---

# Algorithm Name

## Core Idea

Brief description of the algorithm's purpose and when to use it.

## Key Properties

1. **Property One** - explanation
2. **Property Two** - explanation

## Use Cases

### Case Category 1

- Example problem type
- Example problem type

### Case Category 2

- Example problem type

## Code Template

\```python
def algorithm_template():
    pass
\```

## Complexity

- **Time**: O(?)
- **Space**: O(?)

## Related Topics

- Topic One - brief connection
- Topic Two - brief connection
```

## Template 2: Problem Solution

```markdown
---
title: LC XXXX - Problem Title
category: Primary Algorithm Category
tags: [algorithm-tag, data-structure-tag]
difficulty: easy | medium | hard
pack_id: pack-id
---

# LC XXXX - Problem Title

## Problem

Problem description in English.

## Approach

### Core Idea

- Key insight for solving this problem

### Solution

\```python
def solve():
    pass
\```

## Complexity

- **Time**: O(?)
- **Space**: O(?)

## Key Points

1. Important observation
2. Edge case to watch for

## Related Problems

- LC YYYY - Related Problem - brief connection
```

## Template 3: Company Prep

```markdown
---
title: Company Name
category: Company
tags: [company-name, interview-prep]
difficulty: null
pack_id: pack-id
---

# Company Name

## Interview Focus Areas

- Primary topic areas

## Frequently Asked Problems

| Problem | Difficulty | Category |
|---------|-----------|----------|
| LC XXXX | Medium | Topic |

## Key Patterns

- Pattern description
```

## Formatting Rules

1. **No wiki links** - use plain text references, not `[[link]]` syntax
2. **No emoji in headings** - use plain `## Heading`, not `## Heading`
3. **Headings for structure** - KnowHive chunks by headings; each `##` section becomes a retrievable unit
4. **Code blocks** - always specify language (e.g., ` ```python `)
5. **Keep sections focused** - each heading section should cover one concept for optimal RAG retrieval
