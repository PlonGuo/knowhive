---
title: Binary Search
category: Searching
tags: [binary-search, array, divide-and-conquer]
difficulty: easy
pack_id: leetcode-fundamentals
---

# Binary Search

## Problem

Given a sorted array of integers `nums` and a target value, return the index if the target is found. If not, return -1.

You must write an algorithm with O(log n) runtime complexity.

## Examples

- Input: `nums = [-1,0,3,5,9,12]`, `target = 9` → Output: `4`
- Input: `nums = [-1,0,3,5,9,12]`, `target = 2` → Output: `-1`

## Approach: Classic Binary Search

Maintain `left` and `right` pointers. Compare the middle element with the target and narrow the search space by half each iteration.

```python
def binary_search(nums, target):
    left, right = 0, len(nums) - 1
    while left <= right:
        mid = left + (right - left) // 2
        if nums[mid] == target:
            return mid
        elif nums[mid] < target:
            left = mid + 1
        else:
            right = mid - 1
    return -1
```

## Complexity

- **Time**: O(log n) — halve the search space each step
- **Space**: O(1) — constant extra space
