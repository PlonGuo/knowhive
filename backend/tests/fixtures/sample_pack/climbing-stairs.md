---
title: Climbing Stairs
category: Dynamic Programming
tags: [dynamic-programming, fibonacci, memoization]
difficulty: easy
pack_id: leetcode-fundamentals
---

# Climbing Stairs

## Problem

You are climbing a staircase. It takes `n` steps to reach the top. Each time you can climb 1 or 2 steps. In how many distinct ways can you climb to the top?

## Examples

- Input: `n = 2` → Output: `2` (1+1 or 2)
- Input: `n = 3` → Output: `3` (1+1+1, 1+2, 2+1)

## Approach: Dynamic Programming (Fibonacci)

The number of ways to reach step `n` is the sum of ways to reach step `n-1` and step `n-2`, which is the Fibonacci sequence.

```python
def climb_stairs(n):
    if n <= 2:
        return n
    a, b = 1, 2
    for _ in range(3, n + 1):
        a, b = b, a + b
    return b
```

## Complexity

- **Time**: O(n) — single loop
- **Space**: O(1) — only two variables
