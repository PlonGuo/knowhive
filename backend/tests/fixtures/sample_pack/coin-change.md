---
title: Coin Change
category: Dynamic Programming
tags: [dynamic-programming, bfs, greedy]
difficulty: medium
pack_id: leetcode-fundamentals
---

# Coin Change

## Problem

Given an array of coin denominations `coins` and a total `amount`, return the fewest number of coins needed to make up that amount. If it cannot be made, return -1.

## Examples

- Input: `coins = [1,5,10,25]`, `amount = 30` → Output: `2` (25 + 5)
- Input: `coins = [2]`, `amount = 3` → Output: `-1`
- Input: `coins = [1]`, `amount = 0` → Output: `0`

## Approach: Bottom-Up DP

Build a DP array where `dp[i]` is the minimum coins needed for amount `i`. For each amount, try every coin and take the minimum.

```python
def coin_change(coins, amount):
    dp = [float('inf')] * (amount + 1)
    dp[0] = 0
    for i in range(1, amount + 1):
        for coin in coins:
            if coin <= i:
                dp[i] = min(dp[i], dp[i - coin] + 1)
    return dp[amount] if dp[amount] != float('inf') else -1
```

## Complexity

- **Time**: O(amount * len(coins)) — nested loops
- **Space**: O(amount) — DP array
