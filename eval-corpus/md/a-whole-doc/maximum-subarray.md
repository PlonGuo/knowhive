---
title: Maximum Subarray
category: Dynamic Programming
tags: [dynamic-programming, array, kadane, divide-and-conquer]
difficulty: medium
pack_id: leetcode-fundamentals
---

# Maximum Subarray

## Problem

Given an integer array `nums`, find the subarray with the largest sum, and return its sum.

## Examples

- Input: `nums = [-2,1,-3,4,-1,2,1,-5,4]` → Output: `6` (subarray `[4,-1,2,1]`)
- Input: `nums = [1]` → Output: `1`
- Input: `nums = [5,4,-1,7,8]` → Output: `23`

## Approach: Kadane's Algorithm

Track the maximum sum ending at each position. If the running sum becomes negative, reset it to 0 (start a new subarray).

```python
def max_subarray(nums):
    max_sum = nums[0]
    current_sum = nums[0]
    for num in nums[1:]:
        current_sum = max(num, current_sum + num)
        max_sum = max(max_sum, current_sum)
    return max_sum
```

## Complexity

- **Time**: O(n) — single pass
- **Space**: O(1) — constant extra space
