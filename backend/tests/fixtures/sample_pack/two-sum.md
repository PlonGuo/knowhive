---
title: Two Sum
category: Arrays
tags: [hash-map, array, brute-force]
difficulty: easy
pack_id: leetcode-fundamentals
---

# Two Sum

## Problem

Given an array of integers `nums` and an integer `target`, return indices of the two numbers such that they add up to `target`.

You may assume that each input would have exactly one solution, and you may not use the same element twice.

## Examples

- Input: `nums = [2,7,11,15]`, `target = 9` → Output: `[0,1]`
- Input: `nums = [3,2,4]`, `target = 6` → Output: `[1,2]`
- Input: `nums = [3,3]`, `target = 6` → Output: `[0,1]`

## Approach: Hash Map (O(n))

Use a hash map to store each number's index as you iterate. For each element, check if `target - nums[i]` already exists in the map.

```python
def two_sum(nums, target):
    seen = {}
    for i, num in enumerate(nums):
        complement = target - num
        if complement in seen:
            return [seen[complement], i]
        seen[num] = i
```

## Complexity

- **Time**: O(n) — single pass through the array
- **Space**: O(n) — hash map stores at most n elements
