---
title: Reverse Linked List
category: Linked Lists
tags: [linked-list, recursion, iterative]
difficulty: easy
pack_id: leetcode-fundamentals
---

# Reverse Linked List

## Problem

Given the head of a singly linked list, reverse the list and return the reversed list.

## Examples

- Input: `head = [1,2,3,4,5]` → Output: `[5,4,3,2,1]`
- Input: `head = [1,2]` → Output: `[2,1]`
- Input: `head = []` → Output: `[]`

## Approach: Iterative Three-Pointer

Use three pointers: `prev`, `current`, and `next`. Reverse each link as you traverse.

```python
def reverse_list(head):
    prev = None
    current = head
    while current:
        next_node = current.next
        current.next = prev
        prev = current
        current = next_node
    return prev
```

## Complexity

- **Time**: O(n) — visit each node once
- **Space**: O(1) — only pointer variables
