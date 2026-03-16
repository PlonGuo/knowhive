---
title: Interval DP
category: Dynamic Programming
tags: [dynamic-programming, interval-dp, recursion, memoization]
difficulty: null
pack_id: leetcode-basics
---

# Interval DP

## Core Idea

- Perform dynamic programming over intervals of a sequence
- Combine optimal solutions of smaller intervals to solve larger intervals
- Common in sequence splitting, merging, bracket matching problems

## Key Properties

1. **Interval definition** - dp[i][j] represents the optimal solution for interval [i, j]
2. **Split point enumeration** - try all possible split points k within the interval
3. **Increasing interval length** - compute small intervals before large ones
4. **Merge cost** - cost function for combining two sub-intervals

## Common Problem Types

### 1. Merge Problems

- Stone merging (minimum/maximum merge cost)
- Burst Balloons (LC 312)
- Polygon triangulation

### 2. Split Problems

- Matrix chain multiplication (optimal computation order)
- Palindrome partitioning (minimum cuts)
- Expression parenthesization (different computation results)

### 3. Matching Problems

- Longest palindromic subsequence
- Bracket matching (longest valid bracket subsequence)
- Edit distance variants

## Code Template

```python
def interval_dp(nums):
    n = len(nums)

    # 1. State definition
    dp = [[0] * n for _ in range(n)]

    # 2. Initialization
    for i in range(n):
        dp[i][i] = base_value  # single element initial value

    # 3. State transition (increasing interval length)
    for length in range(2, n + 1):          # interval length
        for i in range(n - length + 1):     # interval start
            j = i + length - 1              # interval end

            # 4. Enumerate split points
            for k in range(i, j):
                dp[i][j] = max(dp[i][j],
                              dp[i][k] + dp[k+1][j] + merge_cost(i, k, j))

    # 5. Return result
    return dp[0][n-1]
```

## Classic Problem Analysis

### LC 312 - Burst Balloons

**Key techniques**:
1. **Reverse thinking**: instead of bursting balloons, think of adding the last balloon to burst
2. **Open interval design**: dp[i][j] represents the optimal solution for open interval (i, j)
3. **Virtual boundaries**: add virtual balloon with value 1 at both ends

**State transition**:
```
dp[i][j] = max(dp[i][k] + dp[k][j] + nums[i] * nums[k] * nums[j])
where k is the last balloon burst in interval (i, j)
```

**Code**:
```python
# Add virtual balloons
balloons = [1] + nums + [1]
m = len(balloons)

# Interval length starts from 2 (at least one balloon)
for length in range(2, m):
    for i in range(m - length):
        j = i + length
        for k in range(i + 1, j):
            dp[i][j] = max(dp[i][j],
                          dp[i][k] + dp[k][j] + balloons[i] * balloons[k] * balloons[j])
```

### Stone Merging

**Problem**: merge adjacent stone piles; each merge costs the sum of the two piles' weights. Find the minimum total cost.

**State transition**:
```
dp[i][j] = min(dp[i][k] + dp[k+1][j] + sum[i:j+1])
where sum[i:j+1] is the total weight in the interval
```

## Solving Steps

1. **Identify interval structure**: does the problem involve interval operations on a sequence?
2. **Define state**: dp[i][j] = optimal solution for interval [i, j]
3. **Determine boundaries**: initial values for single elements or empty intervals
4. **Design transition**: how to combine smaller intervals into larger ones
5. **Determine order**: compute by increasing interval length
6. **Extract answer**: usually dp[0][n-1]

## Optimization Techniques

1. **Quadrangle inequality** - narrow the range of split point enumeration
2. **Prefix sums** - fast interval sum computation
3. **Rolling array** - space optimization when only adjacent intervals are needed
4. **Memoized search** - alternative to bottom-up, often cleaner code

## Complexity

- **Time**: O(n^3) - three nested loops (n = interval length)
- **Space**: O(n^2) - DP table
- **Optimized**: can reduce to O(n^2) with quadrangle inequality

## Advanced Problems

1. LC 1000 - Minimum Cost to Merge Stones (K-pile merging)
2. LC 1039 - Minimum Score Triangulation of Polygon
3. LC 1547 - Minimum Cost to Cut a Stick
4. LC 1770 - Maximum Score from Performing Multiplication Operations

## Related Topics

- Dynamic Programming - parent topic
- Divide and Conquer - interval DP is essentially divide-and-conquer + DP
- Memoization - top-down implementation alternative
