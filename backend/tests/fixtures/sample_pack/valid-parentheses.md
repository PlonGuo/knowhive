---
title: Valid Parentheses
category: Stacks
tags: [stack, string, matching]
difficulty: easy
pack_id: leetcode-fundamentals
---

# Valid Parentheses

## Problem

Given a string `s` containing just the characters `(`, `)`, `{`, `}`, `[` and `]`, determine if the input string is valid.

A string is valid if:
1. Open brackets must be closed by the same type of brackets.
2. Open brackets must be closed in the correct order.
3. Every close bracket has a corresponding open bracket of the same type.

## Examples

- Input: `s = "()"` → Output: `true`
- Input: `s = "()[]{}"` → Output: `true`
- Input: `s = "(]"` → Output: `false`

## Approach: Stack

Push opening brackets onto a stack. When encountering a closing bracket, check if the top of the stack is the matching opening bracket.

```python
def is_valid(s):
    stack = []
    pairs = {')': '(', '}': '{', ']': '['}
    for char in s:
        if char in pairs:
            if not stack or stack[-1] != pairs[char]:
                return False
            stack.pop()
        else:
            stack.append(char)
    return len(stack) == 0
```

## Complexity

- **Time**: O(n) — single pass
- **Space**: O(n) — stack may hold all characters
