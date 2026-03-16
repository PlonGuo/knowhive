---
title: Longest Common Subsequence
category: Dynamic Programming
tags: [dynamic-programming, string, 2d-dp]
difficulty: medium
pack_id: leetcode-fundamentals
---

# Longest Common Subsequence

## Problem

Given two strings `text1` and `text2`, return the length of their longest common subsequence. A subsequence is a sequence that can be derived from another sequence by deleting some or no elements without changing the order.

## Examples

- Input: `text1 = "abcde"`, `text2 = "ace"` → Output: `3` (LCS is "ace")
- Input: `text1 = "abc"`, `text2 = "abc"` → Output: `3`
- Input: `text1 = "abc"`, `text2 = "def"` → Output: `0`

## Approach: 2D DP Table

Build a table where `dp[i][j]` represents the LCS length for `text1[:i]` and `text2[:j]`. If characters match, extend the diagonal. Otherwise, take the max of skipping either character.

```python
def longest_common_subsequence(text1, text2):
    m, n = len(text1), len(text2)
    dp = [[0] * (n + 1) for _ in range(m + 1)]
    for i in range(1, m + 1):
        for j in range(1, n + 1):
            if text1[i-1] == text2[j-1]:
                dp[i][j] = dp[i-1][j-1] + 1
            else:
                dp[i][j] = max(dp[i-1][j], dp[i][j-1])
    return dp[m][n]
```

## Complexity

- **Time**: O(m * n) — fill the entire table
- **Space**: O(m * n) — 2D DP table (can be optimized to O(min(m, n)))
