---
title: Digit DP
category: Dynamic Programming
tags: [dynamic-programming, digit-dp, memoization, math]
difficulty: null
pack_id: leetcode-basics
---

# Digit DP

## Core Idea

- Perform dynamic programming on each digit of a number
- Used to count numbers satisfying specific conditions within a range
- Typically handles large-range number counting problems (e.g., 1 to n)

## Key Properties

1. **Digit traversal** - process from most significant to least significant digit
2. **State compression** - track leading zeros, upper bound tightness, and other constraints
3. **Memoized search** - commonly implemented with DFS + memoization

## Common Problem Types

### 1. Digit Counting

- Count occurrences of a specific digit (e.g., digit 1)
- Count numbers with digit sum in a given range
- Count numbers that don't contain certain digits

### 2. Digit Properties

- Count palindromic numbers
- Count increasing/decreasing numbers
- Count numbers whose digit product meets a condition

### 3. Range Queries

- Count of numbers in [L, R] satisfying a condition
- K-th number satisfying a condition

## Code Template

```python
def digit_dp(pos, tight, lead_zero, state):
    """
    pos: current digit position being processed
    tight: whether we are constrained by the upper bound
    lead_zero: whether there are leading zeros
    state: other state to track (e.g., digit sum, specific digit count)
    """
    # Base case: all digits processed
    if pos == len(digits):
        return check_state(state)

    # Memoization
    if not tight and not lead_zero and memo[pos][state] != -1:
        return memo[pos][state]

    limit = digits[pos] if tight else 9
    total = 0

    for digit in range(0, limit + 1):
        next_tight = tight and (digit == limit)
        next_lead_zero = lead_zero and (digit == 0)
        next_state = update_state(state, digit, lead_zero)

        total += digit_dp(pos + 1, next_tight, next_lead_zero, next_state)

    if not tight and not lead_zero:
        memo[pos][state] = total

    return total
```

## Problem Analysis

### LC 600 - Non-negative Integers without Consecutive Ones

**Key techniques**:
1. **Binary digit DP**: process binary bits instead of decimal digits
2. **Simplified state**: only need to track whether the previous bit was 1
3. **Consecutive constraint**: skip when prev == 1 and digit == 1

**Template adaptation (binary version)**:
```python
def dfs(pos, prev, limit):
    if pos == n:
        return 1

    if not limit and memo[pos][prev] != -1:
        return memo[pos][prev]

    max_digit = 1 if not limit else int(s[pos])
    total = 0

    for digit in range(max_digit + 1):
        if prev == 1 and digit == 1:
            continue  # skip consecutive 1s
        total += dfs(pos + 1, digit, limit and digit == max_digit)

    if not limit:
        memo[pos][prev] = total

    return total
```

### Comparison of Digit DP Problems

| Problem | Base | Constraint | State |
|---------|------|------------|-------|
| LC 233 | Decimal | Count digit 1 occurrences | Digit count |
| LC 2719 | Decimal | Digit sum in range | Digit sum |
| LC 600 | Binary | No consecutive 1s | Previous bit |

## Related Problems

1. LC 233 - Number of Digit One
2. LC 2719 - Count of Integers
3. LC 600 - Non-negative Integers without Consecutive Ones
4. LC 902 - Numbers At Most N Given Digit Set

## Related Topics

- Dynamic Programming - parent topic
- Memoization - implementation technique
- Math - digit analysis foundations
