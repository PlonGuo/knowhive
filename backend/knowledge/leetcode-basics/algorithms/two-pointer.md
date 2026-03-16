---
title: Two Pointer Technique
category: Array Techniques
tags: [two-pointer, array, sliding-window, linked-list]
difficulty: null
pack_id: leetcode-basics
---

# Two Pointer Technique

## Core Idea

- Use two pointers to traverse an array or linked list
- Move pointers based on conditions to reduce time complexity
- Common in sorted arrays or when comparing two elements simultaneously

## Key Properties

1. **Pointer initialization** - determine starting positions
2. **Movement condition** - define when and which pointer to move
3. **Termination condition** - pointers meet or reach boundaries

## Common Types

### 1. Same-Direction Pointers

- Fast/slow pointers (cycle detection)
- Sliding window (subarray problems)

### 2. Opposite-Direction Pointers

- Two sum (sorted array)
- Three sum
- Trapping rain water

### 3. Separate Pointers

- Merge two sorted arrays
- Subsequence verification

## Code Templates

### Opposite-Direction Template

```python
left, right = 0, len(nums) - 1
while left < right:
    if condition(nums[left], nums[right]):
        # process logic
        left += 1
        right -= 1
    elif nums[left] < target:
        left += 1
    else:
        right -= 1
```

### Same-Direction (Fast/Slow) Template

```python
slow = fast = 0
while fast < len(nums):
    if condition(nums[fast]):
        nums[slow] = nums[fast]
        slow += 1
    fast += 1
```

## Complexity

- **Time**: typically O(n) - single or double pass through the array
- **Space**: O(1) - only pointer variables

## Related Topics

- Sliding Window - extension of same-direction pointers
- Binary Search - related search technique on sorted data
