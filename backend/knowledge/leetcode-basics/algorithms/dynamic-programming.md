---
title: Dynamic Programming
category: Dynamic Programming
tags: [dynamic-programming, memoization, recursion]
difficulty: null
pack_id: leetcode-basics
---

# Dynamic Programming

## Core Idea

- Break complex problems into overlapping subproblems
- Store subproblem solutions to avoid redundant computation
- Solve bottom-up (tabulation) or top-down (memoization)

## Key Properties

1. **Optimal substructure** - optimal solution contains optimal solutions to subproblems
2. **Overlapping subproblems** - same subproblems are solved repeatedly
3. **State transition equation** - defines how to derive the solution from subproblems

## Common Types

### 1. Linear DP

- Fibonacci sequence
- Climbing stairs
- Maximum subarray sum

### 2. Interval DP

- Matrix chain multiplication
- Stone merging
- Longest palindromic subsequence

### 3. Knapsack Problems

- 0/1 Knapsack
- Unbounded Knapsack
- Bounded Knapsack

### 4. Tree DP

- Binary tree maximum path sum
- House Robber III

### 5. Bitmask DP

- Traveling Salesman Problem (TSP)
- Board covering problems

## Code Template

```python
# 1. Define dp array
dp = [0] * (n + 1)

# 2. Initialize base cases
dp[0], dp[1] = base_case1, base_case2

# 3. State transition
for i in range(2, n + 1):
    dp[i] = recurrence_relation(dp[...])

# 4. Return result
return dp[n]
```

## Practice Problems

- LC 486 - Predict the Winner (Interval DP)
- LC 877 - Stone Game (Interval DP)
- LC 2719 - Count of Integers (Digit DP)
- LC 233 - Number of Digit One (Digit DP)
- LC 834 - Sum of Distances in Tree (Rerooting DP)

## Related Topics

- Interval DP - specialized DP on intervals
- Digit DP - DP on digits of a number
- Rerooting DP - tree DP with root changes
- Memoization - top-down DP implementation
