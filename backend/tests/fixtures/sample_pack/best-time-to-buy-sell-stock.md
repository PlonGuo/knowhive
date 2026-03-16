---
title: Best Time to Buy and Sell Stock
category: Arrays
tags: [array, greedy, sliding-window]
difficulty: easy
pack_id: leetcode-fundamentals
---

# Best Time to Buy and Sell Stock

## Problem

Given an array `prices` where `prices[i]` is the price of a given stock on the i-th day, find the maximum profit from a single buy-sell transaction. If no profit is possible, return 0.

## Examples

- Input: `prices = [7,1,5,3,6,4]` → Output: `5` (buy at 1, sell at 6)
- Input: `prices = [7,6,4,3,1]` → Output: `0` (no profit possible)

## Approach: Track Minimum Price

Iterate through prices, tracking the minimum price seen so far. At each step, calculate profit if selling at current price.

```python
def max_profit(prices):
    min_price = float('inf')
    max_profit = 0
    for price in prices:
        min_price = min(min_price, price)
        max_profit = max(max_profit, price - min_price)
    return max_profit
```

## Complexity

- **Time**: O(n) — single pass
- **Space**: O(1) — two variables
