---
title: Merge Two Sorted Lists
category: Linked Lists
tags: [linked-list, recursion, two-pointers]
difficulty: easy
pack_id: leetcode-fundamentals
---

# Merge Two Sorted Lists

## Problem

Merge two sorted linked lists and return it as a sorted list. The list should be made by splicing together the nodes of the first two lists.

## Examples

- Input: `l1 = [1,2,4]`, `l2 = [1,3,4]` → Output: `[1,1,2,3,4,4]`
- Input: `l1 = []`, `l2 = []` → Output: `[]`
- Input: `l1 = []`, `l2 = [0]` → Output: `[0]`

## Approach: Iterative with Dummy Node

Use a dummy head node and a pointer to build the merged list by comparing nodes from both lists.

```python
def merge_two_lists(l1, l2):
    dummy = ListNode(0)
    current = dummy
    while l1 and l2:
        if l1.val <= l2.val:
            current.next = l1
            l1 = l1.next
        else:
            current.next = l2
            l2 = l2.next
        current = current.next
    current.next = l1 or l2
    return dummy.next
```

## Complexity

- **Time**: O(n + m) — visit each node once
- **Space**: O(1) — only pointer variables
